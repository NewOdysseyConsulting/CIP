import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import {
  CipControlPlane,
  CipControlPlaneError,
  type CipEventBatch,
  type CipRepositories,
  type CompleteRunSessionInput,
  type CreateConnectorBindingInput,
  type CreateCredentialBindingInput,
  type DeployAgentInput,
  type PublishGuardrailDefinitionInput,
  type PublishPolicyPackInput,
  type RegisterAgentBlueprintInput,
  type RegisterConnectorDefinitionInput,
  type RegisterTenantInput,
  type RequestHumanApprovalInput,
  type ResolveApprovalRequestInput,
  type RollbackDeploymentInput,
  type StartRunSessionInput,
  type TransitionDeploymentInput,
} from "@new-odyssey/cip";

import {
  authenticateSdkApiKey,
  extractBearerToken,
  type OperatorClaims,
  requireOperatorScope,
  type OperatorAuthConfig,
  verifyOperatorToken,
} from "./auth.js";
import {
  cleanupRetentionRecords,
  createQueuedIngestJob,
  hashPayload,
  issueApiKey,
  requeueDeadLetterJob,
  revokeApiKey,
  rotateApiKey,
} from "./store.js";
import type {
  ApiKeyRecord,
  ApiKeyScope,
  ControlPlaneServiceStore,
  StoredHttpResponse,
} from "./types.js";
import {
  RequestValidationError,
  apiKeyPathSchema,
  approvalRequestPathSchema,
  cipEventBatchSchema,
  completeRunSessionInputSchema,
  createApiKeyInputSchema,
  createConnectorBindingInputSchema,
  createCredentialBindingInputSchema,
  deadLetterJobPathSchema,
  deployAgentInputSchema,
  deploymentPathSchema,
  ingestJobPathSchema,
  optionalTenantQuerySchema,
  parseOrThrow,
  publishGuardrailDefinitionInputSchema,
  publishPolicyPackInputSchema,
  registerAgentBlueprintInputSchema,
  registerConnectorDefinitionInputSchema,
  registerTenantInputSchema,
  requestHumanApprovalInputSchema,
  resolveApprovalRequestInputSchema,
  resourceIdPathSchema,
  revokeApiKeyInputSchema,
  rollbackDeploymentInputSchema,
  rotateApiKeyInputSchema,
  sessionPathSchema,
  startRunSessionInputSchema,
  tenantPathSchema,
  transitionDeploymentInputSchema,
} from "./validation.js";

export interface ControlPlaneApiAppOptions {
  controlPlane: CipControlPlane;
  repositories: CipRepositories;
  serviceStore: ControlPlaneServiceStore;
  operatorAuth: OperatorAuthConfig;
  readyCheck?: () => Promise<boolean>;
}

const headerValue = (
  value: string | string[] | undefined,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const requireIdempotencyKey = (headers: Record<string, unknown>): string => {
  const value = headerValue(headers["idempotency-key"] as string | string[] | undefined);
  if (value === undefined || value.trim() === "") {
    throw new Error("Idempotency-Key header is required");
  }
  return value;
};

const sendStoredResponse = async (
  response: StoredHttpResponse,
  reply: FastifyReply,
): Promise<void> => {
  await reply.code(response.status).send(response.body);
};

const routeKey = (method: string, path: string): string => `${method} ${path}`;

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const waitForCompletedIdempotency = async (
  store: ControlPlaneServiceStore,
  route: string,
  idempotencyKey: string,
): Promise<StoredHttpResponse | null> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const record = await store.idempotency.get(route, idempotencyKey);
    if (record?.status === "completed" && record.response !== undefined) {
      return record.response;
    }
    await sleep(25);
  }

  return null;
};

const withIdempotency = async (
  store: ControlPlaneServiceStore,
  route: string,
  idempotencyKey: string,
  requestBody: unknown,
  execute: () => Promise<StoredHttpResponse>,
): Promise<StoredHttpResponse> => {
  const requestHash = hashPayload(requestBody);
  const executeReserved = async (): Promise<StoredHttpResponse> => {
    try {
      const response = await execute();
      await store.idempotency.complete(route, idempotencyKey, response);
      return response;
    } catch (error) {
      await store.idempotency.abandon(route, idempotencyKey);
      throw error;
    }
  };

  const claimOrReplay = async (): Promise<StoredHttpResponse | "pending"> => {
    const reservation = await store.idempotency.reserve({
      routeKey: route,
      idempotencyKey,
      requestHash,
    });

    if (reservation.state === "conflict") {
      throw new Error("Idempotency-Key was reused with a different request body");
    }

    if (reservation.state === "completed") {
      if (reservation.record.response === undefined) {
        throw new Error("completed idempotent response is missing persisted data");
      }
      return reservation.record.response;
    }

    if (reservation.state === "pending") {
      return "pending";
    }

    return executeReserved();
  };

  const initialResult = await claimOrReplay();
  if (initialResult !== "pending") {
    return initialResult;
  }

  const response = await waitForCompletedIdempotency(
    store,
    route,
    idempotencyKey,
  );
  if (response !== null) {
    return response;
  }

  const reacquiredResult = await claimOrReplay();
  if (reacquiredResult !== "pending") {
    return reacquiredResult;
  }

  throw new Error("Idempotent request is already in progress");
};

const assertTenantMatch = (expectedTenantId: string, actualTenantId: string): void => {
  if (expectedTenantId !== actualTenantId) {
    throw new Error("request tenant does not match the authenticated API key");
  }
};

const findSessionForTenant = async (
  repositories: CipRepositories,
  sessionId: string,
  tenantId: string,
) => {
  const session = await repositories.runSessions.getById(sessionId);
  if (session === null) {
    throw new Error(`unknown session ${sessionId}`);
  }
  assertTenantMatch(tenantId, session.tenantId);
  return session;
};

const findDeployment = async (
  repositories: CipRepositories,
  deploymentId: string,
) => {
  const deployment = await repositories.deployments.getById(deploymentId);
  if (deployment === null) {
    throw new Error(`unknown deployment ${deploymentId}`);
  }
  return deployment;
};

const findApprovalRequest = async (
  repositories: CipRepositories,
  approvalRequestId: string,
) => {
  const approvalRequest = await repositories.approvalRequests.getById(
    approvalRequestId,
  );
  if (approvalRequest === null) {
    throw new Error(`unknown approval request ${approvalRequestId}`);
  }
  return approvalRequest;
};

const authenticateSdk = async (
  serviceStore: ControlPlaneServiceStore,
  authorizationHeader: string | undefined,
  requiredScope: ApiKeyScope,
) => {
  const record = await authenticateSdkApiKey(
    serviceStore,
    authorizationHeader,
    requiredScope,
  );
  if (record === null) {
    throw new Error("unauthorized");
  }
  return record;
};

const authenticateOperator = async (
  authorizationHeader: string | undefined,
  operatorAuth: OperatorAuthConfig,
) => {
  const claims = await verifyOperatorToken(authorizationHeader, operatorAuth);
  if (claims === null) {
    throw new Error("unauthorized");
  }
  return claims;
};

const authenticateSdkOrOperator = async (
  options: ControlPlaneApiAppOptions,
  authorizationHeader: string | undefined,
): Promise<
  | { mode: "sdk"; apiKey: ApiKeyRecord }
  | { mode: "operator"; claims: OperatorClaims }
> => {
  const token = extractBearerToken(authorizationHeader);
  if (token === null) {
    throw new Error("unauthorized");
  }
  const sdk = await authenticateSdkApiKey(
    options.serviceStore,
    authorizationHeader,
    "sessions:read",
  );
  if (sdk !== null) {
    return { mode: "sdk", apiKey: sdk };
  }
  const claims = await authenticateOperator(authorizationHeader, options.operatorAuth);
  return { mode: "operator", claims };
};

const sdkActorFor = (apiKey: ApiKeyRecord) => ({
  type: "agent" as const,
  id: `api-key:${apiKey.id}`,
});

const mergeReportedActor = (
  payload: Record<string, unknown> | undefined,
  reportedActor: unknown,
): Record<string, unknown> =>
  reportedActor === undefined
    ? payload ?? {}
    : {
        ...(payload ?? {}),
        _reportedActor: reportedActor,
      };

const normalizeBatchActors = (
  batch: CipEventBatch,
  apiKey: ApiKeyRecord,
): CipEventBatch => {
  const actor = sdkActorFor(apiKey);
  return {
    tenantId: batch.tenantId,
    sessionId: batch.sessionId,
    events: batch.events.map((event) => ({
      ...event,
      actor,
      payload: mergeReportedActor(event.payload, event.actor),
    })),
  };
};

const sendError = async (
  error: unknown,
  reply: import("fastify").FastifyReply,
): Promise<void> => {
  if (error instanceof CipControlPlaneError) {
    await reply.code(400).send({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message === "unauthorized") {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }
  if (error instanceof RequestValidationError) {
    await reply.code(400).send({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message.includes("required scope")) {
    await reply.code(403).send({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message.includes("Idempotency-Key")) {
    await reply.code(400).send({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message.includes("already in progress")) {
    await reply.code(409).send({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message.includes("unknown")) {
    await reply.code(404).send({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message.includes("tenant")) {
    await reply.code(403).send({ error: error.message });
    return;
  }
  await reply.code(500).send({
    error: error instanceof Error ? error.message : "unexpected server error",
  });
};

const listSingleTenantIfScoped = async (
  repositories: CipRepositories,
  tenantId?: string,
) => {
  if (tenantId === undefined) {
    return repositories.tenants.list();
  }
  const tenant = await repositories.tenants.getById(tenantId);
  return tenant === null ? [] : [tenant];
};

export const createControlPlaneApiApp = (
  options: ControlPlaneApiAppOptions,
): FastifyInstance => {
  const app = Fastify();

  app.addHook("onResponse", async (request, reply) => {
    console.info(
      JSON.stringify({
        message: "request.complete",
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        traceparent: request.headers.traceparent,
      }),
    );
  });

  app.get("/healthz", async (_request, reply) => {
    await reply.code(200).send({ status: "ok" });
  });

  app.get("/readyz", async (_request, reply) => {
    const ready = (await options.readyCheck?.()) ?? true;
    await reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "not-ready",
    });
  });

  app.get("/metrics", async (_request, reply) => {
    const jobs = await options.serviceStore.ingestJobs.list();
    const deadLetterJobs = await options.serviceStore.deadLetterJobs.list();
    const queued = jobs.filter((job) => job.status === "queued").length;
    const processing = jobs.filter((job) => job.status === "processing").length;
    const deadLetter = deadLetterJobs.length;
    const oldestQueued = jobs
      .filter((job) => job.status === "queued")
      .map((job) => Date.now() - new Date(job.createdAt).getTime())
      .sort((left, right) => right - left)[0] ?? 0;

    reply.header("content-type", "text/plain; version=0.0.4");
    await reply.send(
      [
        "# TYPE cip_ingest_jobs_queued gauge",
        `cip_ingest_jobs_queued ${queued}`,
        "# TYPE cip_ingest_jobs_processing gauge",
        `cip_ingest_jobs_processing ${processing}`,
        "# TYPE cip_dead_letter_jobs gauge",
        `cip_dead_letter_jobs ${deadLetter}`,
        "# TYPE cip_ingest_oldest_queued_age_ms gauge",
        `cip_ingest_oldest_queued_age_ms ${oldestQueued}`,
      ].join("\n"),
    );
  });

  app.post("/v1/sessions", async (request, reply) => {
    try {
      const apiKey = await authenticateSdk(
        options.serviceStore,
        headerValue(request.headers.authorization),
        "sessions:write",
      );
      const body = parseOrThrow(
        startRunSessionInputSchema,
        request.body,
        "session request",
      ) as StartRunSessionInput;
      assertTenantMatch(apiKey.tenantId, body.tenantId);

      const idempotencyKey = requireIdempotencyKey(
        request.headers as Record<string, unknown>,
      );
      const response = await withIdempotency(
        options.serviceStore,
        routeKey("POST", "/v1/sessions"),
        idempotencyKey,
        body,
        async () => ({
          status: 200,
          body: await options.controlPlane.startRunSession(body),
        }),
      );
      await sendStoredResponse(response, reply);
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.post(
    "/v1/sessions/:sessionId(^[^:]+)/events::enqueue",
    async (request, reply) => {
      try {
        const apiKey = await authenticateSdk(
          options.serviceStore,
          headerValue(request.headers.authorization),
          "sessions:write",
        );
        const params = parseOrThrow(sessionPathSchema, request.params, "session path");
        const body = parseOrThrow(
          cipEventBatchSchema,
          request.body,
          "event batch",
        ) as CipEventBatch;
        if (body.sessionId !== params.sessionId) {
          throw new Error("request session does not match the route parameter");
        }
        assertTenantMatch(apiKey.tenantId, body.tenantId);
        await findSessionForTenant(options.repositories, body.sessionId, apiKey.tenantId);
        const normalizedBatch = normalizeBatchActors(body, apiKey);

        const idempotencyKey = requireIdempotencyKey(
          request.headers as Record<string, unknown>,
        );
        const response = await withIdempotency(
          options.serviceStore,
          routeKey("POST", "/v1/sessions/:sessionId/events:enqueue"),
          idempotencyKey,
          normalizedBatch,
          async () => {
            const job = createQueuedIngestJob(
              normalizedBatch.tenantId,
              normalizedBatch.sessionId,
              normalizedBatch,
              idempotencyKey,
            );
            await options.serviceStore.ingestJobs.enqueue(job);
            return {
              status: 202,
              body: {
                ingestJobId: job.id,
                acceptedCount: normalizedBatch.events.length,
                receivedAt: job.createdAt,
              },
            };
          },
        );
        await sendStoredResponse(response, reply);
      } catch (error) {
        await sendError(error, reply);
      }
    },
  );

  app.get("/v1/ingest-jobs/:jobId", async (request, reply) => {
    try {
      const params = parseOrThrow(ingestJobPathSchema, request.params, "ingest job path");
      const auth = await authenticateSdkOrOperator(
        options,
        headerValue(request.headers.authorization),
      );
      const job = await options.serviceStore.ingestJobs.getById(params.jobId);
      if (job === null) {
        throw new Error(`unknown ingest job ${params.jobId}`);
      }
      if (auth.mode === "sdk") {
        assertTenantMatch(auth.apiKey.tenantId, job.tenantId);
      } else {
        requireOperatorScope(auth.claims, "ingest:read", job.tenantId);
      }
      await reply.code(200).send(job);
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.post("/v1/sessions/:sessionId/approval-requests", async (request, reply) => {
    try {
      const apiKey = await authenticateSdk(
        options.serviceStore,
        headerValue(request.headers.authorization),
        "approvals:write",
      );
      const params = parseOrThrow(sessionPathSchema, request.params, "session path");
      await findSessionForTenant(options.repositories, params.sessionId, apiKey.tenantId);
      const body = parseOrThrow(
        requestHumanApprovalInputSchema,
        request.body,
        "approval request",
      ) as RequestHumanApprovalInput;
      if (body.sessionId !== params.sessionId) {
        throw new Error("request session does not match the route parameter");
      }
      await reply.code(200).send(
        await options.controlPlane.requestHumanApproval({
          ...body,
          actor: sdkActorFor(apiKey),
        }),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.post("/v1/sessions/:sessionId(^[^:]+)::complete", async (request, reply) => {
    try {
      const apiKey = await authenticateSdk(
        options.serviceStore,
        headerValue(request.headers.authorization),
        "sessions:write",
      );
      const params = parseOrThrow(sessionPathSchema, request.params, "session path");
      await findSessionForTenant(options.repositories, params.sessionId, apiKey.tenantId);
      const body = parseOrThrow(
        completeRunSessionInputSchema,
        request.body,
        "complete session request",
      ) as CompleteRunSessionInput;
      if (body.sessionId !== params.sessionId) {
        throw new Error("request session does not match the route parameter");
      }
      const idempotencyKey = requireIdempotencyKey(
        request.headers as Record<string, unknown>,
      );
      const response = await withIdempotency(
        options.serviceStore,
        routeKey("POST", "/v1/sessions/:sessionId:complete"),
        idempotencyKey,
        body,
        async () => ({
          status: 200,
          body: await options.controlPlane.completeRunSession(body),
        }),
      );
      await sendStoredResponse(response, reply);
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/sessions/:sessionId/replay", async (request, reply) => {
    try {
      const apiKey = await authenticateSdk(
        options.serviceStore,
        headerValue(request.headers.authorization),
        "sessions:read",
      );
      const params = parseOrThrow(sessionPathSchema, request.params, "session path");
      await findSessionForTenant(options.repositories, params.sessionId, apiKey.tenantId);
      await reply.code(200).send(
        await options.controlPlane.replayRunSession(params.sessionId),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/evidence-bundles/:sessionId", async (request, reply) => {
    try {
      const apiKey = await authenticateSdk(
        options.serviceStore,
        headerValue(request.headers.authorization),
        "sessions:read",
      );
      const params = parseOrThrow(sessionPathSchema, request.params, "session path");
      await findSessionForTenant(options.repositories, params.sessionId, apiKey.tenantId);
      await reply.code(200).send(
        await options.controlPlane.getEvidenceBundle(params.sessionId),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.post("/v1/approval-requests/:approvalRequestId(^[^:]+)::resolve", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      const params = parseOrThrow(
        approvalRequestPathSchema,
        request.params,
        "approval request path",
      );
      const approvalRequest = await findApprovalRequest(
        options.repositories,
        params.approvalRequestId,
      );
      requireOperatorScope(claims, "approvals:resolve", approvalRequest.tenantId);
      const body = parseOrThrow(
        resolveApprovalRequestInputSchema,
        request.body,
        "approval resolution request",
      ) as ResolveApprovalRequestInput;
      if (body.approvalRequestId !== params.approvalRequestId) {
        throw new Error("request approval id does not match the route parameter");
      }
      await reply.code(200).send(
        await options.controlPlane.resolveApprovalRequest({
          ...body,
          actor: {
            type: "human",
            id: claims.sub,
          },
        }),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.post("/v1/deployments/:deploymentId(^[^:]+)::transition", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      const params = parseOrThrow(deploymentPathSchema, request.params, "deployment path");
      const deployment = await findDeployment(options.repositories, params.deploymentId);
      requireOperatorScope(claims, "deployments:write", deployment.tenantId);
      const body = parseOrThrow(
        transitionDeploymentInputSchema,
        request.body,
        "deployment transition request",
      ) as TransitionDeploymentInput;
      if (body.deploymentId !== params.deploymentId) {
        throw new Error("request deployment id does not match the route parameter");
      }
      await reply.code(200).send(
        await options.controlPlane.transitionDeployment({
          ...body,
          actor: { type: "human", id: claims.sub },
        }),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.post("/v1/deployments/:deploymentId(^[^:]+)::rollback", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      const params = parseOrThrow(deploymentPathSchema, request.params, "deployment path");
      const deployment = await findDeployment(options.repositories, params.deploymentId);
      requireOperatorScope(claims, "deployments:write", deployment.tenantId);
      const body = parseOrThrow(
        rollbackDeploymentInputSchema,
        request.body,
        "deployment rollback request",
      ) as RollbackDeploymentInput;
      if (body.deploymentId !== params.deploymentId) {
        throw new Error("request deployment id does not match the route parameter");
      }
      await reply.code(200).send(
        await options.controlPlane.rollbackDeploymentToBlueprint({
          ...body,
          actor: { type: "human", id: claims.sub },
        }),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/deployments", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      const query = parseOrThrow(optionalTenantQuerySchema, request.query, "deployment query");
      const tenantId = query.tenantId ?? claims.tenantId;
      requireOperatorScope(claims, "deployments:read", tenantId);
      await reply.code(200).send(
        await options.repositories.deployments.list(
          tenantId === undefined ? undefined : { tenantId },
        ),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/tenants/:tenantId", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      const params = parseOrThrow(tenantPathSchema, request.params, "tenant path");
      requireOperatorScope(claims, "tenants:read", params.tenantId);
      await reply.code(200).send(
        await options.repositories.tenants.getById(params.tenantId),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/audit-events", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      const query = parseOrThrow(optionalTenantQuerySchema, request.query, "audit query");
      const tenantId = query.tenantId ?? claims.tenantId;
      requireOperatorScope(claims, "audit:read", tenantId);
      await reply.code(200).send(
        await options.repositories.auditEvents.list(
          tenantId === undefined ? undefined : { tenantId },
        ),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/tenants", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      requireOperatorScope(claims, "tenants:read", claims.tenantId);
      await reply.code(200).send(
        await listSingleTenantIfScoped(options.repositories, claims.tenantId),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.post("/v1/admin/tenants", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      const body = parseOrThrow(registerTenantInputSchema, request.body, "tenant create") as RegisterTenantInput;
      requireOperatorScope(claims, "tenants:write");
      await reply.code(200).send(await options.controlPlane.registerTenant(body));
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/tenants/:tenantId", async (request, reply) => {
    try {
      const claims = await authenticateOperator(
        headerValue(request.headers.authorization),
        options.operatorAuth,
      );
      const params = parseOrThrow(tenantPathSchema, request.params, "tenant path");
      requireOperatorScope(claims, "tenants:read", params.tenantId);
      await reply.code(200).send(await options.repositories.tenants.getById(params.tenantId));
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/connector-definitions", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "connectors:read");
      await reply.code(200).send(await options.repositories.connectorDefinitions.list());
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/connector-definitions", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "connectors:write");
      const body = parseOrThrow(registerConnectorDefinitionInputSchema, request.body, "connector definition create") as RegisterConnectorDefinitionInput;
      await reply.code(200).send(await options.controlPlane.registerConnectorDefinition(body));
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.get("/v1/admin/connector-definitions/:id", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "connectors:read");
      const params = parseOrThrow(resourceIdPathSchema, request.params, "resource path");
      await reply.code(200).send(await options.repositories.connectorDefinitions.getById(params.id));
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/credential-bindings", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const query = parseOrThrow(optionalTenantQuerySchema, request.query, "credential binding query");
      const tenantId = query.tenantId ?? claims.tenantId;
      requireOperatorScope(claims, "credentials:read", tenantId);
      await reply.code(200).send(
        await options.repositories.credentialBindings.list(
          tenantId === undefined ? undefined : { tenantId },
        ),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/credential-bindings", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const body = parseOrThrow(createCredentialBindingInputSchema, request.body, "credential binding create") as CreateCredentialBindingInput;
      requireOperatorScope(claims, "credentials:write", body.tenantId);
      await reply.code(200).send(await options.controlPlane.createCredentialBinding(body));
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.get("/v1/admin/credential-bindings/:id", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const params = parseOrThrow(resourceIdPathSchema, request.params, "resource path");
      const record = await options.repositories.credentialBindings.getById(params.id);
      if (record !== null) {
        requireOperatorScope(claims, "credentials:read", record.tenantId);
      }
      await reply.code(200).send(record);
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/connector-bindings", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const query = parseOrThrow(optionalTenantQuerySchema, request.query, "connector binding query");
      const tenantId = query.tenantId ?? claims.tenantId;
      requireOperatorScope(claims, "connectors:read", tenantId);
      await reply.code(200).send(
        await options.repositories.connectorBindings.list(
          tenantId === undefined ? undefined : { tenantId },
        ),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/connector-bindings", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const body = parseOrThrow(createConnectorBindingInputSchema, request.body, "connector binding create") as CreateConnectorBindingInput;
      requireOperatorScope(claims, "connectors:write", body.tenantId);
      await reply.code(200).send(await options.controlPlane.createConnectorBinding(body));
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.get("/v1/admin/connector-bindings/:id", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const params = parseOrThrow(resourceIdPathSchema, request.params, "resource path");
      const record = await options.repositories.connectorBindings.getById(params.id);
      if (record !== null) {
        requireOperatorScope(claims, "connectors:read", record.tenantId);
      }
      await reply.code(200).send(record);
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/policy-packs", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const query = parseOrThrow(optionalTenantQuerySchema, request.query, "policy pack query");
      const tenantId = query.tenantId ?? claims.tenantId;
      requireOperatorScope(claims, "policies:read", tenantId);
      await reply.code(200).send(
        await options.repositories.policyPacks.list(
          tenantId === undefined ? undefined : { tenantId },
        ),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/policy-packs", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const body = parseOrThrow(publishPolicyPackInputSchema, request.body, "policy pack publish") as PublishPolicyPackInput;
      requireOperatorScope(claims, "policies:write", body.tenantId);
      await reply.code(200).send(await options.controlPlane.publishPolicyPack(body));
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.get("/v1/admin/policy-packs/:id", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const params = parseOrThrow(resourceIdPathSchema, request.params, "resource path");
      const record = await options.repositories.policyPacks.getById(params.id);
      requireOperatorScope(claims, "policies:read", record?.tenantId);
      await reply.code(200).send(record);
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/guardrail-definitions", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "policies:read");
      await reply.code(200).send(await options.repositories.guardrailDefinitions.list());
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/guardrail-definitions", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "policies:write");
      const body = parseOrThrow(publishGuardrailDefinitionInputSchema, request.body, "guardrail publish") as PublishGuardrailDefinitionInput;
      await reply.code(200).send(await options.controlPlane.publishGuardrailDefinition(body));
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.get("/v1/admin/guardrail-definitions/:id", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "policies:read");
      const params = parseOrThrow(resourceIdPathSchema, request.params, "resource path");
      await reply.code(200).send(await options.repositories.guardrailDefinitions.getById(params.id));
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/agent-blueprints", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "blueprints:read");
      await reply.code(200).send(await options.repositories.agentBlueprints.list());
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/agent-blueprints", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "blueprints:write");
      const body = parseOrThrow(registerAgentBlueprintInputSchema, request.body, "agent blueprint create") as RegisterAgentBlueprintInput;
      await reply.code(200).send(await options.controlPlane.registerAgentBlueprint(body));
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.get("/v1/admin/agent-blueprints/:id", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "blueprints:read");
      const params = parseOrThrow(resourceIdPathSchema, request.params, "resource path");
      await reply.code(200).send(await options.repositories.agentBlueprints.getById(params.id));
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/deployments", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const query = parseOrThrow(optionalTenantQuerySchema, request.query, "deployment query");
      const tenantId = query.tenantId ?? claims.tenantId;
      requireOperatorScope(claims, "deployments:read", tenantId);
      await reply.code(200).send(
        await options.repositories.deployments.list(
          tenantId === undefined ? undefined : { tenantId },
        ),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/deployments", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const body = parseOrThrow(deployAgentInputSchema, request.body, "deployment create") as DeployAgentInput;
      requireOperatorScope(claims, "deployments:write", body.tenantId);
      await reply.code(200).send(await options.controlPlane.deployAgent(body));
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.get("/v1/admin/deployments/:id", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const params = parseOrThrow(resourceIdPathSchema, request.params, "resource path");
      const record = await options.repositories.deployments.getById(params.id);
      if (record !== null) {
        requireOperatorScope(claims, "deployments:read", record.tenantId);
      }
      await reply.code(200).send(record);
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/api-keys", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const query = parseOrThrow(optionalTenantQuerySchema, request.query, "api key query");
      const tenantId = query.tenantId ?? claims.tenantId;
      requireOperatorScope(claims, "api-keys:read", tenantId);
      await reply.code(200).send(await options.serviceStore.apiKeys.list(tenantId));
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/api-keys", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const body = parseOrThrow(createApiKeyInputSchema, request.body, "api key create");
      requireOperatorScope(claims, "api-keys:write", body.tenantId);
      await reply.code(200).send(
        await issueApiKey(options.serviceStore, {
          tenantId: body.tenantId,
          name: body.name,
          scopes: body.scopes,
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
        }),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.get("/v1/admin/api-keys/:apiKeyId", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const params = parseOrThrow(apiKeyPathSchema, request.params, "api key path");
      const record = await options.serviceStore.apiKeys.getById(params.apiKeyId);
      if (record !== null) {
        requireOperatorScope(claims, "api-keys:read", record.tenantId);
      }
      await reply.code(200).send(record);
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/api-keys/:apiKeyId(^[^:]+)::rotate", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const params = parseOrThrow(apiKeyPathSchema, request.params, "api key path");
      const body = parseOrThrow(rotateApiKeyInputSchema, request.body, "api key rotate");
      if (body.apiKeyId !== params.apiKeyId) {
        throw new Error("request api key id does not match the route parameter");
      }
      const existing = await options.serviceStore.apiKeys.getById(params.apiKeyId);
      requireOperatorScope(claims, "api-keys:write", existing?.tenantId);
      await reply.code(200).send(
        await rotateApiKey(options.serviceStore, {
          apiKeyId: body.apiKeyId,
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.scopes === undefined ? {} : { scopes: body.scopes }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
        }),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/api-keys/:apiKeyId(^[^:]+)::revoke", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const params = parseOrThrow(apiKeyPathSchema, request.params, "api key path");
      const body = parseOrThrow(revokeApiKeyInputSchema, request.body, "api key revoke");
      if (body.apiKeyId !== params.apiKeyId) {
        throw new Error("request api key id does not match the route parameter");
      }
      const existing = await options.serviceStore.apiKeys.getById(params.apiKeyId);
      requireOperatorScope(claims, "api-keys:write", existing?.tenantId);
      await reply.code(200).send(
        await revokeApiKey(options.serviceStore, {
          apiKeyId: body.apiKeyId,
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        }),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.get("/v1/admin/dead-letter-jobs", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "ingest:read", claims.tenantId);
      const jobs = await options.serviceStore.deadLetterJobs.list();
      await reply.code(200).send(
        claims.tenantId === undefined
          ? jobs
          : jobs.filter((job) => job.tenantId === claims.tenantId),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });
  app.post("/v1/admin/dead-letter-jobs/:deadLetterJobId(^[^:]+)::requeue", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      const params = parseOrThrow(deadLetterJobPathSchema, request.params, "dead letter path");
      const record = await options.serviceStore.deadLetterJobs.getById(params.deadLetterJobId);
      requireOperatorScope(claims, "ingest:write", record?.tenantId);
      await reply.code(200).send(
        await requeueDeadLetterJob(options.serviceStore, params.deadLetterJobId),
      );
    } catch (error) {
      await sendError(error, reply);
    }
  });

  app.post("/v1/admin/retention/cleanup", async (request, reply) => {
    try {
      const claims = await authenticateOperator(headerValue(request.headers.authorization), options.operatorAuth);
      requireOperatorScope(claims, "control-plane:admin");
      const body = request.body as { cutoff?: string } | undefined;
      const cutoff = body?.cutoff ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await reply.code(200).send(await cleanupRetentionRecords(options.serviceStore, cutoff));
    } catch (error) {
      await sendError(error, reply);
    }
  });

  return app;
};
