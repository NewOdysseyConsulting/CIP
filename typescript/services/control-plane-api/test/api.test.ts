import assert from "node:assert/strict";
import test from "node:test";

import {
  CipControlPlane,
  InMemoryTelemetrySink,
  createDefaultGuardrailCatalog,
  createInMemoryCipRepositories,
  dynamics365ConnectorManifest,
  workdayConnectorManifest,
} from "@new-odyssey/cip";

import { createControlPlaneApiApp } from "../src/app.js";
import { signOperatorToken } from "../src/auth.js";
import {
  createInMemoryControlPlaneServiceStore,
  issueApiKey,
} from "../src/store.js";
import { processNextIngestJob } from "../src/worker.js";

const operatorAuth = {
  sharedSecret: "test-operator-secret",
  issuer: "cip-tests",
  audience: "cip-operators",
} as const;

const parseJson = <T>(payload: string): T => JSON.parse(payload) as T;

const buildFixture = async () => {
  const repositories = createInMemoryCipRepositories();
  const telemetry = new InMemoryTelemetrySink();
  const controlPlane = new CipControlPlane(repositories, {
    telemetrySink: telemetry,
  });
  const serviceStore = createInMemoryControlPlaneServiceStore();
  const app = createControlPlaneApiApp({
    controlPlane,
    repositories,
    serviceStore,
    operatorAuth,
  });

  const tenant = await controlPlane.registerTenant({
    slug: "acme-sdk-control-plane",
    displayName: "Acme SDK Control Plane",
    productTier: "pantheon",
    platforms: ["workday"],
    regions: ["eu-west-2"],
  });

  const workdayConnector = await controlPlane.registerConnectorDefinition({
    key: workdayConnectorManifest.key,
    version: workdayConnectorManifest.version,
    platform: workdayConnectorManifest.platform,
    displayName: "Workday MCP Server",
    runtime: "mcp",
    authStrategy: "service-account",
    source: "first-party",
    capabilities: workdayConnectorManifest.tools.map((tool) => tool.name),
  });

  await controlPlane.registerConnectorDefinition({
    key: dynamics365ConnectorManifest.key,
    version: dynamics365ConnectorManifest.version,
    platform: dynamics365ConnectorManifest.platform,
    displayName: "Dynamics 365 MCP Server",
    runtime: "mcp",
    authStrategy: "oauth2",
    source: "partner",
    capabilities: dynamics365ConnectorManifest.tools.map((tool) => tool.name),
  });

  const credentialBinding = await controlPlane.createCredentialBinding({
    tenantId: tenant.id,
    name: "acme-workday-prod",
    provider: "aws-secrets-manager",
    secretRef: "arn:aws:secretsmanager:eu-west-2:123456789012:secret:cip",
    scopes: ["tenant:prod", "workday:security"],
  });

  const connectorBinding = await controlPlane.createConnectorBinding({
    tenantId: tenant.id,
    connectorDefinitionId: workdayConnector.id,
    credentialBindingId: credentialBinding.id,
    environment: "production",
    alias: "workday-prod",
    endpoint: "https://acme.workday.com",
    config: { tenantAlias: "acme" },
  });

  const [guardrailTemplate] = createDefaultGuardrailCatalog();
  assert.ok(guardrailTemplate);
  const guardrail = await controlPlane.publishGuardrailDefinition({
    key: guardrailTemplate.key,
    version: guardrailTemplate.version,
    name: guardrailTemplate.name,
    configuration: guardrailTemplate.configuration,
  });

  const policyPack = await controlPlane.publishPolicyPack({
    key: "workday-security-baseline",
    name: "Workday Security Baseline",
    domain: "security",
    version: "1.0.0",
    ownership: "shared",
    rules: [
      {
        id: "least-privilege",
        name: "Least Privilege",
        severity: "high",
        action: "flag",
        clauses: [
          {
            id: "scope-delta",
            name: "scope-delta",
            match: "all",
            conditions: [
              {
                path: "permissions.delta",
                operator: "gt",
                value: 0,
              },
            ],
          },
        ],
      },
    ],
    guardrailRefs: [guardrail.id],
  });

  const blueprint = await controlPlane.registerAgentBlueprint({
    key: "security-diagnostic-agent",
    version: "1.0.0",
    name: "Security Diagnostic Agent",
    productTier: "pantheon",
    domain: "security",
    description: "Remote API test blueprint.",
    runtime: {
      provider: "openai-agents-sdk",
      modelProfile: "reasoning",
      adapterVersion: "0.7.2",
    },
    connectorDefinitionIds: [workdayConnector.id],
    policyPackIds: [policyPack.id],
    guardrailDefinitionIds: [guardrail.id],
  });

  const deployment = await controlPlane.deployAgent({
    tenantId: tenant.id,
    agentBlueprintId: blueprint.id,
    environment: "production",
    connectorBindingIds: [connectorBinding.id],
    tags: ["sdk", "control-plane"],
  });

  const activeDeployment = await controlPlane.transitionDeployment({
    deploymentId: deployment.id,
    targetStatus: "active",
  });

  const issuedApiKey = await issueApiKey(serviceStore, {
    tenantId: tenant.id,
    name: "SDK test key",
    scopes: ["sessions:read", "sessions:write", "approvals:write"],
  });

  const operatorToken = await signOperatorToken(
    { sub: "operator-1", scope: "control-plane:admin" },
    operatorAuth,
  );

  return {
    app,
    controlPlane,
    repositories,
    serviceStore,
    tenant,
    deployment: activeDeployment,
    apiKeyRecord: issuedApiKey.record,
    apiKey: issuedApiKey.plainTextKey,
    operatorToken,
  };
};

test("control-plane API supports remote tracked sessions and queued event ingestion", async () => {
  const fixture = await buildFixture();

  const createResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-create-1",
    },
    payload: {
      tenantId: fixture.tenant.id,
      deploymentId: fixture.deployment.id,
      inputSummary: "Why can't Maria run the Year-End Tax Report?",
    },
  });
  assert.equal(createResponse.statusCode, 200);
  const session = parseJson<{ id: string } & Record<string, unknown>>(createResponse.body);

  const enqueueResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}/events:enqueue`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-events-1",
    },
    payload: {
      tenantId: fixture.tenant.id,
      sessionId: session.id,
      events: [
        {
          kind: "run_event",
          type: "tool_called",
          actor: { type: "human", id: "spoofed-operator" },
          payload: { tool: "list_security_groups" },
        },
      ],
    },
  });
  assert.equal(enqueueResponse.statusCode, 202);

  const processed = await processNextIngestJob({
    controlPlane: fixture.controlPlane,
    serviceStore: fixture.serviceStore,
  });
  assert.equal(processed?.outcome, "processed");

  const completeResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}:complete`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-complete-1",
    },
    payload: {
      sessionId: session.id,
      status: "completed",
      outputSummary: "Maria is missing the report domain security group.",
    },
  });
  assert.equal(completeResponse.statusCode, 200);

  const replayResponse = await fixture.app.inject({
    method: "GET",
    url: `/v1/sessions/${session.id}/replay`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
    },
  });
  assert.equal(replayResponse.statusCode, 200);
  const replay = parseJson<{
    runEvents: Array<{
      type: string;
      actor: { id: string; type: string };
      payload: Record<string, unknown>;
    }>;
    reconstructedStatus: string;
  }>(replayResponse.body);
  assert.deepEqual(
    replay.runEvents.map((event) => event.type),
    ["run_started", "tool_called", "run_completed"],
  );
  assert.equal(replay.runEvents[1]?.actor.id, `api-key:${fixture.apiKeyRecord.id}`);
  assert.deepEqual(replay.runEvents[1]?.payload._reportedActor, {
    type: "human",
    id: "spoofed-operator",
  });
  assert.equal(replay.reconstructedStatus, "completed");

  const evidenceResponse = await fixture.app.inject({
    method: "GET",
    url: `/v1/evidence-bundles/${session.id}`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
    },
  });
  assert.equal(evidenceResponse.statusCode, 200);
  const evidence = parseJson<{ agentBlueprintVersion: string }>(evidenceResponse.body);
  assert.equal(evidence.agentBlueprintVersion, "1.0.0");

  await fixture.app.close();
});

test("control-plane API enforces idempotency and tenant-scoped SDK auth", async () => {
  const fixture = await buildFixture();

  const payload = {
    tenantId: fixture.tenant.id,
    deploymentId: fixture.deployment.id,
    inputSummary: "Run a deterministic replay.",
  };

  const first = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "idempotent-session-1",
    },
    payload,
  });
  const second = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "idempotent-session-1",
    },
    payload,
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(
    parseJson<{ id: string }>(first.body).id,
    parseJson<{ id: string }>(second.body).id,
  );

  const wrongTenant = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "wrong-tenant-1",
    },
    payload: {
      ...payload,
      tenantId: "tenant-other",
    },
  });

  assert.equal(wrongTenant.statusCode, 403);
  await fixture.app.close();
});

test("operator routes require operator auth and allow deployment state transitions", async () => {
  const fixture = await buildFixture();

  const unauthorized = await fixture.app.inject({
    method: "GET",
    url: "/v1/deployments",
  });
  assert.equal(unauthorized.statusCode, 401);

  const deployments = await fixture.app.inject({
    method: "GET",
    url: `/v1/deployments?tenantId=${fixture.tenant.id}`,
    headers: {
      authorization: `Bearer ${fixture.operatorToken}`,
    },
  });
  assert.equal(deployments.statusCode, 200);
  assert.equal(parseJson<Array<{ id: string }>>(deployments.body).length, 1);

  const paused = await fixture.app.inject({
    method: "POST",
    url: `/v1/deployments/${fixture.deployment.id}:transition`,
    headers: {
      authorization: `Bearer ${fixture.operatorToken}`,
    },
    payload: {
      deploymentId: fixture.deployment.id,
      targetStatus: "paused",
    },
  });
  assert.equal(paused.statusCode, 200);
  assert.equal(parseJson<{ status: string }>(paused.body).status, "paused");

  await fixture.app.close();
});

test("operator scopes and tenant restrictions are enforced", async () => {
  const fixture = await buildFixture();
  const scopedToken = await signOperatorToken(
    {
      sub: "operator-tenant",
      scope: "deployments:read",
      tenantId: fixture.tenant.id,
    },
    operatorAuth,
  );

  const deployments = await fixture.app.inject({
    method: "GET",
    url: "/v1/deployments",
    headers: {
      authorization: `Bearer ${scopedToken}`,
    },
  });
  assert.equal(deployments.statusCode, 200);
  assert.equal(parseJson<Array<{ id: string }>>(deployments.body).length, 1);

  const deniedWrite = await fixture.app.inject({
    method: "POST",
    url: `/v1/deployments/${fixture.deployment.id}:transition`,
    headers: {
      authorization: `Bearer ${scopedToken}`,
    },
    payload: {
      deploymentId: fixture.deployment.id,
      targetStatus: "paused",
    },
  });
  assert.equal(deniedWrite.statusCode, 403);

  const deniedTenant = await fixture.app.inject({
    method: "GET",
    url: "/v1/tenants/tenant-other",
    headers: {
      authorization: `Bearer ${scopedToken}`,
    },
  });
  assert.equal(deniedTenant.statusCode, 403);

  await fixture.app.close();
});

test("invalid request payloads are rejected with 400", async () => {
  const fixture = await buildFixture();

  const invalidSession = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "invalid-session-1",
    },
    payload: {
      deploymentId: fixture.deployment.id,
      inputSummary: "missing tenant id",
    },
  });
  assert.equal(invalidSession.statusCode, 400);

  const session = await fixture.controlPlane.startRunSession({
    tenantId: fixture.tenant.id,
    deploymentId: fixture.deployment.id,
    inputSummary: "validation test session",
  });

  const invalidBatch = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}/events:enqueue`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "invalid-batch-1",
    },
    payload: {
      tenantId: fixture.tenant.id,
      sessionId: session.id,
      events: [],
    },
  });
  assert.equal(invalidBatch.statusCode, 400);

  await fixture.app.close();
});
