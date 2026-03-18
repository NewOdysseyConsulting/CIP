export type IsoTimestamp = string;

export type ProductTier = "pegasus" | "pantheon" | "phoenix";
export type Environment = "development" | "test" | "sandbox" | "production";
export type PolicyDomain =
  | "platform"
  | "security"
  | "expense"
  | "recruitment"
  | "onboarding";

export interface BaseRecord {
  id: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  revision: number;
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

export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  expression: string;
  severity: "info" | "warn" | "high" | "critical";
  action: "allow" | "flag" | "block" | "escalate";
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
}

export interface AgentBlueprint extends BaseRecord {
  key: string;
  name: string;
  productTier: ProductTier;
  domain: PolicyDomain;
  description: string;
  runtime: RuntimeProfile;
  connectorDefinitionIds: string[];
  policyPackIds: string[];
  handoffTargets: string[];
  structuredOutput?: string;
  status: "draft" | "active" | "deprecated";
}

export interface DeploymentRecord extends BaseRecord {
  tenantId: string;
  agentBlueprintId: string;
  environment: Environment;
  connectorBindingIds: string[];
  policyPackIds: string[];
  status: "provisioning" | "active" | "paused" | "failed" | "retired";
  deployedAt?: IsoTimestamp;
  tags: string[];
}

export interface RunSession extends BaseRecord {
  tenantId: string;
  deploymentId: string;
  correlationId: string;
  status: "queued" | "running" | "waiting-human" | "completed" | "failed";
  startedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
  inputSummary: string;
  outputSummary?: string;
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
  category: "tenant" | "connector" | "policy" | "deployment" | "session" | "security";
  action: string;
  severity: "info" | "warn" | "error" | "critical";
  occurredAt: IsoTimestamp;
  actor: AuditActor;
  payload: Record<string, unknown>;
}
