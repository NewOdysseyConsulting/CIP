export type IsoTimestamp = string;

export type ProductTier = "pegasus" | "pantheon" | "phoenix";
export type Environment = "development" | "test" | "sandbox" | "production";
export type PolicyDomain =
  | "platform"
  | "security"
  | "expense"
  | "recruitment"
  | "onboarding";
export type PolicyOperator =
  | "eq"
  | "neq"
  | "in"
  | "contains"
  | "exists"
  | "regex"
  | "gt"
  | "gte"
  | "lt"
  | "lte";
export type PolicyRuleAction = "allow" | "flag" | "block" | "escalate";
export type Severity = "info" | "warn" | "high" | "critical";
export type ReleaseState = "draft" | "released" | "deprecated";
export type DeploymentStatus =
  | "provisioning"
  | "active"
  | "paused"
  | "draining"
  | "failed"
  | "retired";
export type RunSessionStatus =
  | "queued"
  | "running"
  | "waiting-human"
  | "completed"
  | "failed";
export type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";
export type RunEventType =
  | "run_started"
  | "tool_called"
  | "tool_completed"
  | "handoff_started"
  | "handoff_completed"
  | "guardrail_triggered"
  | "policy_decided"
  | "approval_requested"
  | "approval_resolved"
  | "run_completed"
  | "run_failed";
export type GuardrailKey =
  | "tenant_boundary"
  | "pii_boundary"
  | "least_privilege"
  | "manual_review_required"
  | "data_residency"
  | string;

export interface BaseRecord {
  id: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  revision: number;
}

export interface TraceCorrelation {
  provider: "openai" | "custom";
  traceId?: string;
  spanId?: string;
  conversationId?: string;
  responseId?: string;
}

export interface TenantRecord extends BaseRecord {
  slug: string;
  displayName: string;
  productTier: ProductTier;
  platforms: string[];
  regions: string[];
  status: "active" | "suspended" | "retired";
}

export interface ConnectorDefinition extends BaseRecord {
  key: string;
  version: string;
  platform: string;
  displayName: string;
  runtime: "mcp" | "native" | "http";
  authStrategy: "oauth2" | "api-key" | "service-account" | "custom";
  source: "first-party" | "partner" | "community";
  capabilities: string[];
  status: "draft" | "active" | "deprecated";
  metadata?: Record<string, unknown>;
}

export interface CredentialBinding extends BaseRecord {
  tenantId: string;
  name: string;
  provider: string;
  secretRef: string;
  scopes: string[];
  expiresAt?: IsoTimestamp;
  rotatedAt?: IsoTimestamp;
  status: "active" | "rotated" | "revoked";
}

export interface ConnectorBinding extends BaseRecord {
  tenantId: string;
  connectorDefinitionId: string;
  credentialBindingId: string;
  environment: Environment;
  alias: string;
  endpoint: string;
  config: Record<string, unknown>;
  status: "active" | "disabled";
}

export interface PolicyCondition {
  path: string;
  operator: PolicyOperator;
  value?: unknown;
}

export interface PolicyClause {
  id: string;
  name: string;
  match: "all" | "any";
  conditions: PolicyCondition[];
}

export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  expression?: string;
  clauses?: PolicyClause[];
  severity: Severity;
  action: PolicyRuleAction;
}

export interface PolicyPack extends BaseRecord {
  key: string;
  name: string;
  domain: PolicyDomain;
  version: string;
  ownership: "shared" | "tenant";
  tenantId?: string;
  rules: PolicyRule[];
  guardrailRefs: string[];
  status: "draft" | "active" | "retired";
}

export interface RuntimeProfile {
  provider: "openai-agents-sdk" | "anthropic" | "custom";
  modelProfile: "default" | "reasoning" | "fast";
  adapterVersion?: string;
}

export interface DependencyVersionReference {
  id: string;
  key: string;
  version: string;
}

export interface BlueprintDependencySnapshot {
  policyPacks: DependencyVersionReference[];
  guardrails: DependencyVersionReference[];
  connectorManifests: DependencyVersionReference[];
  runtimeAdapterVersion: string;
}

export interface AgentBlueprint extends BaseRecord {
  key: string;
  version: string;
  releaseState: ReleaseState;
  supersedesBlueprintId?: string;
  dependencySnapshot: BlueprintDependencySnapshot;
  name: string;
  productTier: ProductTier;
  domain: PolicyDomain;
  description: string;
  runtime: RuntimeProfile;
  connectorDefinitionIds: string[];
  policyPackIds: string[];
  guardrailDefinitionIds: string[];
  handoffTargets: string[];
  structuredOutput?: string;
  status: "draft" | "active" | "deprecated";
}

export interface DeploymentRecord extends BaseRecord {
  tenantId: string;
  agentBlueprintId: string;
  agentBlueprintVersion: string;
  environment: Environment;
  connectorBindingIds: string[];
  policyPackIds: string[];
  status: DeploymentStatus;
  deployedAt?: IsoTimestamp;
  lastTransitionAt: IsoTimestamp;
  tags: string[];
}

export interface RunSession extends BaseRecord {
  tenantId: string;
  deploymentId: string;
  correlationId: string;
  status: RunSessionStatus;
  startedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
  inputSummary: string;
  outputSummary?: string;
  currentApprovalRequestId?: string;
  traceCorrelation?: TraceCorrelation;
}

export interface AuditActor {
  type: "agent" | "human" | "system";
  id: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  deploymentId?: string;
  sessionId?: string;
  category:
    | "tenant"
    | "connector"
    | "policy"
    | "deployment"
    | "session"
    | "security"
    | "approval"
    | "runtime";
  action: string;
  severity: "info" | "warn" | "error" | "critical";
  occurredAt: IsoTimestamp;
  actor: AuditActor;
  payload: Record<string, unknown>;
}

export interface GuardrailDefinition extends BaseRecord {
  key: GuardrailKey;
  version: string;
  name: string;
  description?: string;
  configuration: Record<string, unknown>;
  status: "draft" | "active" | "retired";
}

export interface ApprovalRequest extends BaseRecord {
  tenantId: string;
  deploymentId: string;
  sessionId: string;
  checkpointId: string;
  reason: string;
  requestedBy: AuditActor;
  status: ApprovalRequestStatus;
  expiresAt?: IsoTimestamp;
  resolvedAt?: IsoTimestamp;
  resolutionComment?: string;
  guardrailDefinitionId?: string;
  policyPackId?: string;
}

export interface RunEvent extends BaseRecord {
  tenantId: string;
  deploymentId: string;
  sessionId: string;
  type: RunEventType;
  sequence: number;
  occurredAt: IsoTimestamp;
  actor: AuditActor;
  payload: Record<string, unknown>;
  traceCorrelation?: TraceCorrelation;
}

export interface EvidenceBundle extends BaseRecord {
  tenantId: string;
  deploymentId: string;
  sessionId: string;
  agentBlueprintId: string;
  agentBlueprintVersion: string;
  policyPackVersions: DependencyVersionReference[];
  guardrailVersions: DependencyVersionReference[];
  summary: string;
  runEventIds: string[];
  auditEventIds: string[];
  generatedAt: IsoTimestamp;
}

export interface ConnectorRateBucket extends BaseRecord {
  provider: string;
  externalSystemTenant: string;
  environment: Environment;
  apiFamily: string;
  maxRequestsPerSecond: number;
  availableTokens: number;
  lastRefillAt: IsoTimestamp;
  queueDepth: number;
  status: "active" | "disabled";
}
