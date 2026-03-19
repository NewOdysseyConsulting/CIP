import { randomUUID } from "node:crypto";

import type { CipRepositories } from "../repositories/ports.js";
import type { CipControlPlane } from "../services/cip-control-plane.js";
import type {
  CreateConnectorBindingInput,
  CreateCredentialBindingInput,
  DeployAgentInput,
  PublishGuardrailDefinitionInput,
  PublishPolicyPackInput,
  RegisterAgentBlueprintInput,
  RegisterConnectorDefinitionInput,
  RegisterTenantInput,
} from "../services/cip-control-plane.js";
import type {
  ApiKeyRecord,
  CipAdminTransport,
  CipApiError,
  CipAuthError,
  CipConflictError,
  CipControlPlaneTransport,
  CipEventBatch,
  CipIngestReceipt,
  CipRetryableError,
  CipTransportConfig,
  CipValidationError,
  CompleteSessionRequest,
  CreateApiKeyRequest,
  CreateSessionRequest,
  DeadLetterJobRecord,
  IngestJobRecord,
  IssuedApiKeyResponse,
  RequestApprovalRequest,
  ResolveApprovalRequestRequest,
  RequeueDeadLetterJobRequest,
  RevokeApiKeyRequest,
  RollbackDeploymentRequest,
  RotateApiKeyRequest,
  TransitionDeploymentRequest,
} from "./types.js";
import {
  CipApiError as CipApiErrorClass,
  CipAuthError as CipAuthErrorClass,
  CipConflictError as CipConflictErrorClass,
  CipRetryableError as CipRetryableErrorClass,
  CipValidationError as CipValidationErrorClass,
} from "./types.js";

const DEFAULT_RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
const DEFAULT_TIMEOUT_MS = 10_000;

const jsonHeaders = (idempotencyKey?: string): Record<string, string> => ({
  "content-type": "application/json",
  ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
});

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const buildError = (
  status: number,
  details: unknown,
): CipApiError => {
  if (status === 401 || status === 403) {
    return new CipAuthErrorClass(status, details);
  }
  if (status === 400 || status === 422) {
    return new CipValidationErrorClass(status, details);
  }
  if (status === 409) {
    return new CipConflictErrorClass(status, details);
  }
  if (DEFAULT_RETRYABLE_STATUS_CODES.includes(status)) {
    return new CipRetryableErrorClass(status, details);
  }
  return new CipApiErrorClass("control plane request failed", status, details);
};

const parseResponse = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
};

export interface LocalCipControlPlaneTransportOptions {
  controlPlane: CipControlPlane;
  repositories: CipRepositories;
}

export class LocalCipControlPlaneTransport
  implements CipControlPlaneTransport
{
  constructor(private readonly options: LocalCipControlPlaneTransportOptions) {}

  async createSession(
    input: CreateSessionRequest,
  ): Promise<Awaited<ReturnType<CipControlPlane["startRunSession"]>>> {
    return this.options.controlPlane.startRunSession(input);
  }

  async enqueueEvents(batch: CipEventBatch): Promise<CipIngestReceipt> {
    for (const event of batch.events) {
      if (event.kind === "run_event") {
        await this.options.controlPlane.appendRunEvent({
          sessionId: batch.sessionId,
          type: event.type,
          ...(event.actor === undefined ? {} : { actor: event.actor }),
          ...(event.payload === undefined ? {} : { payload: event.payload }),
          ...(event.traceCorrelation === undefined
            ? {}
            : { traceCorrelation: event.traceCorrelation }),
          ...(event.occurredAt === undefined
            ? {}
            : { occurredAt: event.occurredAt }),
        });
      } else {
        await this.options.controlPlane.appendAuditEvent({
          tenantId: batch.tenantId,
          sessionId: batch.sessionId,
          ...(event.deploymentId === undefined
            ? {}
            : { deploymentId: event.deploymentId }),
          category: event.category,
          action: event.action,
          actor: event.actor,
          payload: event.payload,
          ...(event.severity === undefined ? {} : { severity: event.severity }),
          ...(event.occurredAt === undefined
            ? {}
            : { occurredAt: event.occurredAt }),
        });
      }
    }

    return {
      ingestJobId: `local-${randomUUID()}`,
      acceptedCount: batch.events.length,
      receivedAt: new Date().toISOString(),
    };
  }

  async requestApproval(input: RequestApprovalRequest) {
    return this.options.controlPlane.requestHumanApproval(input);
  }

  async resolveApproval(input: ResolveApprovalRequestRequest) {
    return this.options.controlPlane.resolveApprovalRequest(input);
  }

  async completeSession(input: CompleteSessionRequest) {
    return this.options.controlPlane.completeRunSession(input);
  }

  async transitionDeployment(input: TransitionDeploymentRequest) {
    return this.options.controlPlane.transitionDeployment(input);
  }

  async rollbackDeployment(input: RollbackDeploymentRequest) {
    return this.options.controlPlane.rollbackDeploymentToBlueprint(input);
  }

  async getReplay(sessionId: string) {
    return this.options.controlPlane.replayRunSession(sessionId);
  }

  async getEvidenceBundle(sessionId: string) {
    return this.options.controlPlane.getEvidenceBundle(sessionId);
  }

  async getIngestJob(_jobId: string): Promise<IngestJobRecord | null> {
    return null;
  }

  async getTenant(tenantId: string) {
    return this.options.repositories.tenants.getById(tenantId);
  }

  async listDeployments(tenantId?: string) {
    return this.options.repositories.deployments.list(
      tenantId === undefined ? undefined : { tenantId },
    );
  }

  async listAuditEvents(tenantId?: string) {
    return this.options.repositories.auditEvents.list(
      tenantId === undefined ? undefined : { tenantId },
    );
  }
}

export interface HttpCipControlPlaneTransportOptions extends CipTransportConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

class BaseHttpTransport {
  protected readonly fetchImpl: typeof fetch;
  protected readonly timeoutMs: number;
  protected readonly defaultHeaders: Record<string, string>;
  protected readonly retryableStatusCodes: number[];
  protected readonly maxAttempts: number;

  constructor(protected readonly options: HttpCipControlPlaneTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.retryableStatusCodes =
      options.retryPolicy?.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES;
    this.maxAttempts = options.retryPolicy?.maxAttempts ?? 1;
  }

  protected buildUrl(path: string): string {
    return new URL(path, this.options.baseUrl).toString();
  }

  protected buildHeaders(
    authMode: "sdk" | "operator",
    idempotencyKey?: string,
  ): Record<string, string> {
    const authorization =
      authMode === "sdk"
        ? this.options.apiKey === undefined
          ? undefined
          : `Bearer ${this.options.apiKey}`
        : this.options.operatorToken === undefined
          ? undefined
          : `Bearer ${this.options.operatorToken}`;

    return {
      ...this.defaultHeaders,
      ...jsonHeaders(idempotencyKey),
      ...(authorization === undefined ? {} : { authorization }),
    };
  }

  protected async requestJson<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      const response = await this.fetchImpl(this.buildUrl(path), {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) {
        return (await parseResponse(response)) as T;
      }
      const details = await parseResponse(response);
      const error = buildError(response.status, details);
      const isRetryable =
        error instanceof CipRetryableErrorClass &&
        attempt + 1 < this.maxAttempts &&
        this.retryableStatusCodes.includes(response.status);
      if (!isRetryable) {
        throw error;
      }
      attempt += 1;
      await sleep(Math.min(1_000, 100 * 2 ** attempt));
    }
  }
}

export class HttpCipControlPlaneTransport
  extends BaseHttpTransport
  implements CipControlPlaneTransport
{
  async createSession(
    input: CreateSessionRequest,
    idempotencyKey?: string,
  ): Promise<Awaited<ReturnType<CipControlPlaneTransport["createSession"]>>> {
    return this.requestJson(
      "/v1/sessions",
      {
        method: "POST",
        headers: this.buildHeaders("sdk", idempotencyKey),
        body: JSON.stringify(input),
      },
    );
  }

  async enqueueEvents(batch: CipEventBatch, idempotencyKey?: string) {
    return this.requestJson<CipIngestReceipt>(
      `/v1/sessions/${batch.sessionId}/events:enqueue`,
      {
        method: "POST",
        headers: this.buildHeaders("sdk", idempotencyKey),
        body: JSON.stringify(batch),
      },
    );
  }

  async requestApproval(input: RequestApprovalRequest) {
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["requestApproval"]>>>(
      `/v1/sessions/${input.sessionId}/approval-requests`,
      {
        method: "POST",
        headers: this.buildHeaders("sdk"),
        body: JSON.stringify(input),
      },
    );
  }

  async resolveApproval(input: ResolveApprovalRequestRequest) {
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["resolveApproval"]>>>(
      `/v1/approval-requests/${input.approvalRequestId}:resolve`,
      {
        method: "POST",
        headers: this.buildHeaders("operator"),
        body: JSON.stringify(input),
      },
    );
  }

  async completeSession(
    input: CompleteSessionRequest,
    idempotencyKey?: string,
  ): Promise<Awaited<ReturnType<CipControlPlaneTransport["completeSession"]>>> {
    return this.requestJson(
      `/v1/sessions/${input.sessionId}:complete`,
      {
        method: "POST",
        headers: this.buildHeaders("sdk", idempotencyKey),
        body: JSON.stringify(input),
      },
    );
  }

  async transitionDeployment(input: TransitionDeploymentRequest) {
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["transitionDeployment"]>>>(
      `/v1/deployments/${input.deploymentId}:transition`,
      {
        method: "POST",
        headers: this.buildHeaders("operator"),
        body: JSON.stringify(input),
      },
    );
  }

  async rollbackDeployment(input: RollbackDeploymentRequest) {
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["rollbackDeployment"]>>>(
      `/v1/deployments/${input.deploymentId}:rollback`,
      {
        method: "POST",
        headers: this.buildHeaders("operator"),
        body: JSON.stringify(input),
      },
    );
  }

  async getReplay(sessionId: string) {
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["getReplay"]>>>(`/v1/sessions/${sessionId}/replay`, {
      headers: this.buildHeaders("sdk"),
    });
  }

  async getEvidenceBundle(sessionId: string) {
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["getEvidenceBundle"]>>>(`/v1/evidence-bundles/${sessionId}`, {
      headers: this.buildHeaders("sdk"),
    });
  }

  async getIngestJob(jobId: string) {
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["getIngestJob"]>>>(`/v1/ingest-jobs/${jobId}`, {
      headers: this.buildHeaders("sdk"),
    });
  }

  async getTenant(tenantId: string) {
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["getTenant"]>>>(`/v1/tenants/${tenantId}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async listDeployments(tenantId?: string) {
    const url = new URL("/v1/deployments", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["listDeployments"]>>>(url.pathname + url.search, {
      headers: this.buildHeaders("operator"),
    });
  }

  async listAuditEvents(tenantId?: string) {
    const url = new URL("/v1/audit-events", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }
    return this.requestJson<Awaited<ReturnType<CipControlPlaneTransport["listAuditEvents"]>>>(url.pathname + url.search, {
      headers: this.buildHeaders("operator"),
    });
  }
}

export class HttpCipAdminTransport
  extends BaseHttpTransport
  implements CipAdminTransport
{
  async createTenant(input: RegisterTenantInput) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["createTenant"]>>>("/v1/admin/tenants", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listTenants() {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listTenants"]>>>("/v1/admin/tenants", {
      headers: this.buildHeaders("operator"),
    });
  }

  async getTenant(tenantId: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getTenant"]>>>(`/v1/admin/tenants/${tenantId}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async createConnectorDefinition(input: RegisterConnectorDefinitionInput) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["createConnectorDefinition"]>>>("/v1/admin/connector-definitions", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listConnectorDefinitions() {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listConnectorDefinitions"]>>>("/v1/admin/connector-definitions", {
      headers: this.buildHeaders("operator"),
    });
  }

  async getConnectorDefinition(id: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getConnectorDefinition"]>>>(`/v1/admin/connector-definitions/${id}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async createCredentialBinding(input: CreateCredentialBindingInput) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["createCredentialBinding"]>>>("/v1/admin/credential-bindings", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listCredentialBindings(tenantId?: string) {
    const url = new URL("/v1/admin/credential-bindings", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listCredentialBindings"]>>>(url.pathname + url.search, {
      headers: this.buildHeaders("operator"),
    });
  }

  async getCredentialBinding(id: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getCredentialBinding"]>>>(`/v1/admin/credential-bindings/${id}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async createConnectorBinding(input: CreateConnectorBindingInput) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["createConnectorBinding"]>>>("/v1/admin/connector-bindings", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listConnectorBindings(tenantId?: string) {
    const url = new URL("/v1/admin/connector-bindings", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listConnectorBindings"]>>>(url.pathname + url.search, {
      headers: this.buildHeaders("operator"),
    });
  }

  async getConnectorBinding(id: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getConnectorBinding"]>>>(`/v1/admin/connector-bindings/${id}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async publishPolicyPack(input: PublishPolicyPackInput) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["publishPolicyPack"]>>>("/v1/admin/policy-packs", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listPolicyPacks(tenantId?: string) {
    const url = new URL("/v1/admin/policy-packs", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listPolicyPacks"]>>>(url.pathname + url.search, {
      headers: this.buildHeaders("operator"),
    });
  }

  async getPolicyPack(id: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getPolicyPack"]>>>(`/v1/admin/policy-packs/${id}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async publishGuardrailDefinition(input: PublishGuardrailDefinitionInput) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["publishGuardrailDefinition"]>>>("/v1/admin/guardrail-definitions", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listGuardrailDefinitions() {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listGuardrailDefinitions"]>>>("/v1/admin/guardrail-definitions", {
      headers: this.buildHeaders("operator"),
    });
  }

  async getGuardrailDefinition(id: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getGuardrailDefinition"]>>>(`/v1/admin/guardrail-definitions/${id}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async registerAgentBlueprint(input: RegisterAgentBlueprintInput) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["registerAgentBlueprint"]>>>("/v1/admin/agent-blueprints", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listAgentBlueprints() {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listAgentBlueprints"]>>>("/v1/admin/agent-blueprints", {
      headers: this.buildHeaders("operator"),
    });
  }

  async getAgentBlueprint(id: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getAgentBlueprint"]>>>(`/v1/admin/agent-blueprints/${id}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async createDeployment(input: DeployAgentInput) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["createDeployment"]>>>("/v1/admin/deployments", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listDeployments(tenantId?: string) {
    const url = new URL("/v1/admin/deployments", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listDeployments"]>>>(url.pathname + url.search, {
      headers: this.buildHeaders("operator"),
    });
  }

  async getDeployment(id: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getDeployment"]>>>(`/v1/admin/deployments/${id}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async issueApiKey(input: CreateApiKeyRequest): Promise<IssuedApiKeyResponse> {
    return this.requestJson("/v1/admin/api-keys", {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async listApiKeys(tenantId?: string) {
    const url = new URL("/v1/admin/api-keys", this.options.baseUrl);
    if (tenantId !== undefined) {
      url.searchParams.set("tenantId", tenantId);
    }
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listApiKeys"]>>>(url.pathname + url.search, {
      headers: this.buildHeaders("operator"),
    });
  }

  async getApiKey(id: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getApiKey"]>>>(`/v1/admin/api-keys/${id}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async rotateApiKey(input: RotateApiKeyRequest): Promise<IssuedApiKeyResponse> {
    return this.requestJson(`/v1/admin/api-keys/${input.apiKeyId}:rotate`, {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async revokeApiKey(input: RevokeApiKeyRequest): Promise<ApiKeyRecord> {
    return this.requestJson(`/v1/admin/api-keys/${input.apiKeyId}:revoke`, {
      method: "POST",
      headers: this.buildHeaders("operator"),
      body: JSON.stringify(input),
    });
  }

  async getIngestJob(jobId: string) {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["getIngestJob"]>>>(`/v1/ingest-jobs/${jobId}`, {
      headers: this.buildHeaders("operator"),
    });
  }

  async listDeadLetterJobs(): Promise<DeadLetterJobRecord[]> {
    return this.requestJson<Awaited<ReturnType<CipAdminTransport["listDeadLetterJobs"]>>>("/v1/admin/dead-letter-jobs", {
      headers: this.buildHeaders("operator"),
    });
  }

  async requeueDeadLetterJob(
    input: RequeueDeadLetterJobRequest,
  ): Promise<IngestJobRecord | null> {
    return this.requestJson(
      `/v1/admin/dead-letter-jobs/${input.deadLetterJobId}:requeue`,
      {
        method: "POST",
        headers: this.buildHeaders("operator"),
        body: JSON.stringify(input),
      },
    );
  }
}
