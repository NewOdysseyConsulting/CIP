import type {
  AgentBlueprint,
  ApprovalRequest,
  AuditEvent,
  ConnectorRateBucket,
  EvidenceBundle,
  GuardrailDefinition,
  PolicyDomain,
  RunEvent,
  ConnectorBinding,
  ConnectorDefinition,
  CredentialBinding,
  DeploymentRecord,
  PolicyPack,
  ProductTier,
  RunSession,
  TenantRecord,
} from "../domain/records.js";

export interface TenantFilter {
  status?: TenantRecord["status"];
  productTier?: ProductTier;
  platform?: string;
}

export interface ConnectorDefinitionFilter {
  key?: string;
  version?: string;
  platform?: string;
  runtime?: ConnectorDefinition["runtime"];
  capability?: string;
  status?: ConnectorDefinition["status"];
}

export interface CredentialBindingFilter {
  tenantId?: string;
  provider?: string;
  status?: CredentialBinding["status"];
}

export interface ConnectorBindingFilter {
  tenantId?: string;
  connectorDefinitionId?: string;
  credentialBindingId?: string;
  environment?: ConnectorBinding["environment"];
  status?: ConnectorBinding["status"];
}

export interface PolicyPackFilter {
  domain?: PolicyPack["domain"];
  ownership?: PolicyPack["ownership"];
  tenantId?: string;
  status?: PolicyPack["status"];
}

export interface AgentBlueprintFilter {
  key?: string;
  version?: string;
  domain?: PolicyDomain;
  productTier?: ProductTier;
  status?: "draft" | "active" | "deprecated";
  releaseState?: AgentBlueprint["releaseState"];
}

export interface DeploymentFilter {
  tenantId?: string;
  agentBlueprintId?: string;
  environment?: DeploymentRecord["environment"];
  status?: DeploymentRecord["status"];
}

export interface RunSessionFilter {
  tenantId?: string;
  deploymentId?: string;
  status?: RunSession["status"];
}

export interface AuditEventFilter {
  tenantId?: string;
  deploymentId?: string;
  sessionId?: string;
  category?: AuditEvent["category"];
  severity?: "info" | "warn" | "error" | "critical";
  action?: string;
}

export interface GuardrailDefinitionFilter {
  key?: GuardrailDefinition["key"];
  version?: string;
  status?: GuardrailDefinition["status"];
}

export interface ApprovalRequestFilter {
  tenantId?: string;
  deploymentId?: string;
  sessionId?: string;
  status?: ApprovalRequest["status"];
}

export interface RunEventFilter {
  tenantId?: string;
  deploymentId?: string;
  sessionId?: string;
  type?: RunEvent["type"];
}

export interface EvidenceBundleFilter {
  tenantId?: string;
  deploymentId?: string;
  sessionId?: string;
}

export interface ConnectorRateBucketFilter {
  provider?: string;
  externalSystemTenant?: string;
  environment?: ConnectorRateBucket["environment"];
  apiFamily?: string;
}
