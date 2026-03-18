import type {
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
  domain?: PolicyPack["domain"];
  productTier?: ProductTier;
  status?: "draft" | "active" | "deprecated";
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
  category?: "tenant" | "connector" | "policy" | "deployment" | "session" | "security";
  severity?: "info" | "warn" | "error" | "critical";
  action?: string;
}
