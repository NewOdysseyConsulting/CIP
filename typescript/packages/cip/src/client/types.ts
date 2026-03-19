import type {
  ApprovalRequest,
  AuditActor,
  AuditEvent,
  ConnectorBinding,
  ConnectorDefinition,
  DeploymentRecord,
  EvidenceBundle,
  GuardrailDefinition,
  PolicyPack,
  RunEvent,
  RunSession,
  TenantRecord,
  TraceCorrelation,
  AgentBlueprint,
  CredentialBinding,
} from "../domain/records.js";
import type {
  AppendAuditEventInput,
  CompleteRunSessionInput,
  CreateConnectorBindingInput,
  CreateCredentialBindingInput,
  DeployAgentInput,
  PublishGuardrailDefinitionInput,
  PublishPolicyPackInput,
  ReplayedRunSession,
  ResolveApprovalRequestInput,
  RegisterAgentBlueprintInput,
  RegisterConnectorDefinitionInput,
  RegisterTenantInput,
  RollbackDeploymentInput,
  StartRunSessionInput,
  TransitionDeploymentInput,
} from "../services/cip-control-plane.js";
import type { HumanApprovalCheckpoint } from "../runtime/types.js";

export type ApiKeyScope =
  | "sessions:read"
  | "sessions:write"
  | "approvals:write"
  | "approvals:resolve"
  | "deployments:read"
  | "deployments:write"
  | "tenants:read"
  | "audit:read";

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  rotatedFromApiKeyId?: string;
  description?: string;
}

export interface IngestJobRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  jobType: "event_batch";
  payload: CipEventBatch;
  status: "queued" | "processing" | "completed" | "failed" | "dead_letter";
  attemptCount: number;
  availableAt: string;
  lastError?: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeadLetterJobRecord {
  id: string;
  originalJobId: string;
  tenantId: string;
  sessionId: string;
  jobType: "event_batch";
  payload: CipEventBatch;
  lastError: string;
  createdAt: string;
}

export interface CipRunEventEnvelope {
  kind: "run_event";
  type: RunEvent["type"];
  actor?: AuditActor;
  payload?: Record<string, unknown>;
  traceCorrelation?: TraceCorrelation;
  occurredAt?: string;
}

export interface CipAuditEventEnvelope {
  kind: "audit_event";
  category: AuditEvent["category"];
  action: string;
  severity?: AuditEvent["severity"];
  actor: AuditActor;
  payload: Record<string, unknown>;
  deploymentId?: string;
  occurredAt?: string;
}

export type CipIngestEvent = CipRunEventEnvelope | CipAuditEventEnvelope;

export interface CipEventBatch {
  tenantId: string;
  sessionId: string;
  events: CipIngestEvent[];
}

export interface CipIngestReceipt {
  ingestJobId: string;
  acceptedCount: number;
  receivedAt: string;
}

export interface CipTransportRetryPolicy {
  maxAttempts: number;
  retryableStatusCodes: number[];
}

export interface CipTransportConfig {
  baseUrl?: string;
  apiKey?: string;
  operatorToken?: string;
  timeoutMs?: number;
  retryPolicy?: CipTransportRetryPolicy;
  defaultHeaders?: Record<string, string>;
}

export class CipApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CipApiError";
  }
}

export class CipAuthError extends CipApiError {
  constructor(status: number, details?: unknown) {
    super("authentication failed", status, details);
    this.name = "CipAuthError";
  }
}

export class CipValidationError extends CipApiError {
  constructor(status: number, details?: unknown) {
    super("request validation failed", status, details);
    this.name = "CipValidationError";
  }
}

export class CipConflictError extends CipApiError {
  constructor(status: number, details?: unknown) {
    super("request conflict", status, details);
    this.name = "CipConflictError";
  }
}

export class CipRetryableError extends CipApiError {
  constructor(status: number, details?: unknown) {
    super("retryable control plane error", status, details);
    this.name = "CipRetryableError";
  }
}

export interface CreateSessionRequest extends StartRunSessionInput {}

export interface CompleteSessionRequest extends CompleteRunSessionInput {}

export interface RequestApprovalRequest {
  sessionId: string;
  checkpoint: HumanApprovalCheckpoint;
  actor?: AuditActor;
}

export interface ResolveApprovalRequestRequest extends ResolveApprovalRequestInput {}

export interface TransitionDeploymentRequest extends TransitionDeploymentInput {}

export interface RollbackDeploymentRequest extends RollbackDeploymentInput {}

export interface CipControlPlaneTransport {
  createSession(input: CreateSessionRequest, idempotencyKey?: string): Promise<RunSession>;
  enqueueEvents(
    batch: CipEventBatch,
    idempotencyKey?: string,
  ): Promise<CipIngestReceipt>;
  requestApproval(input: RequestApprovalRequest): Promise<ApprovalRequest>;
  resolveApproval(
    input: ResolveApprovalRequestRequest,
  ): Promise<ApprovalRequest>;
  completeSession(
    input: CompleteSessionRequest,
    idempotencyKey?: string,
  ): Promise<RunSession>;
  transitionDeployment(
    input: TransitionDeploymentRequest,
  ): Promise<DeploymentRecord>;
  rollbackDeployment(
    input: RollbackDeploymentRequest,
  ): Promise<DeploymentRecord>;
  getReplay(sessionId: string): Promise<ReplayedRunSession>;
  getEvidenceBundle(sessionId: string): Promise<EvidenceBundle | null>;
  getIngestJob(jobId: string): Promise<IngestJobRecord | null>;
  getTenant(tenantId: string): Promise<TenantRecord | null>;
  listDeployments(tenantId?: string): Promise<DeploymentRecord[]>;
  listAuditEvents(tenantId?: string): Promise<AuditEvent[]>;
}

export interface CreateApiKeyRequest {
  tenantId: string;
  name: string;
  scopes: ApiKeyScope[];
  description?: string;
  expiresAt?: string;
}

export interface IssuedApiKeyResponse {
  record: ApiKeyRecord;
  plainTextKey: string;
}

export interface RotateApiKeyRequest {
  apiKeyId: string;
  name?: string;
  scopes?: ApiKeyScope[];
  description?: string;
  expiresAt?: string;
}

export interface RevokeApiKeyRequest {
  apiKeyId: string;
  reason?: string;
}

export interface RequeueDeadLetterJobRequest {
  deadLetterJobId: string;
}

export interface CipAdminTransport {
  createTenant(input: RegisterTenantInput): Promise<TenantRecord>;
  listTenants(): Promise<TenantRecord[]>;
  getTenant(tenantId: string): Promise<TenantRecord | null>;
  createConnectorDefinition(
    input: RegisterConnectorDefinitionInput,
  ): Promise<ConnectorDefinition>;
  listConnectorDefinitions(): Promise<ConnectorDefinition[]>;
  getConnectorDefinition(id: string): Promise<ConnectorDefinition | null>;
  createCredentialBinding(
    input: CreateCredentialBindingInput,
  ): Promise<CredentialBinding>;
  listCredentialBindings(tenantId?: string): Promise<CredentialBinding[]>;
  getCredentialBinding(id: string): Promise<CredentialBinding | null>;
  createConnectorBinding(
    input: CreateConnectorBindingInput,
  ): Promise<ConnectorBinding>;
  listConnectorBindings(tenantId?: string): Promise<ConnectorBinding[]>;
  getConnectorBinding(id: string): Promise<ConnectorBinding | null>;
  publishPolicyPack(input: PublishPolicyPackInput): Promise<PolicyPack>;
  listPolicyPacks(tenantId?: string): Promise<PolicyPack[]>;
  getPolicyPack(id: string): Promise<PolicyPack | null>;
  publishGuardrailDefinition(
    input: PublishGuardrailDefinitionInput,
  ): Promise<GuardrailDefinition>;
  listGuardrailDefinitions(): Promise<GuardrailDefinition[]>;
  getGuardrailDefinition(id: string): Promise<GuardrailDefinition | null>;
  registerAgentBlueprint(
    input: RegisterAgentBlueprintInput,
  ): Promise<AgentBlueprint>;
  listAgentBlueprints(): Promise<AgentBlueprint[]>;
  getAgentBlueprint(id: string): Promise<AgentBlueprint | null>;
  createDeployment(input: DeployAgentInput): Promise<DeploymentRecord>;
  listDeployments(tenantId?: string): Promise<DeploymentRecord[]>;
  getDeployment(id: string): Promise<DeploymentRecord | null>;
  issueApiKey(input: CreateApiKeyRequest): Promise<IssuedApiKeyResponse>;
  listApiKeys(tenantId?: string): Promise<ApiKeyRecord[]>;
  getApiKey(id: string): Promise<ApiKeyRecord | null>;
  rotateApiKey(input: RotateApiKeyRequest): Promise<IssuedApiKeyResponse>;
  revokeApiKey(input: RevokeApiKeyRequest): Promise<ApiKeyRecord>;
  getIngestJob(jobId: string): Promise<IngestJobRecord | null>;
  listDeadLetterJobs(): Promise<DeadLetterJobRecord[]>;
  requeueDeadLetterJob(
    input: RequeueDeadLetterJobRequest,
  ): Promise<IngestJobRecord | null>;
}
