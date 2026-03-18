import type {
  AgentBlueprint,
  AuditEvent,
  ConnectorBinding,
  ConnectorDefinition,
  CredentialBinding,
  DeploymentRecord,
  PolicyPack,
  RunSession,
  TenantRecord,
} from "../domain/records.js";
import type {
  AgentBlueprintFilter,
  AuditEventFilter,
  ConnectorBindingFilter,
  ConnectorDefinitionFilter,
  CredentialBindingFilter,
  DeploymentFilter,
  PolicyPackFilter,
  RunSessionFilter,
  TenantFilter,
} from "./filters.js";

export interface MutableRepository<TRecord, TFilter = undefined> {
  getById(id: string): Promise<TRecord | null>;
  list(filter?: TFilter): Promise<TRecord[]>;
  save(record: TRecord): Promise<TRecord>;
  delete(id: string): Promise<void>;
}

export interface AuditEventRepository {
  append(event: AuditEvent): Promise<AuditEvent>;
  getById(id: string): Promise<AuditEvent | null>;
  list(filter?: AuditEventFilter): Promise<AuditEvent[]>;
}

export interface CipRepositories {
  tenants: MutableRepository<TenantRecord, TenantFilter>;
  connectorDefinitions: MutableRepository<
    ConnectorDefinition,
    ConnectorDefinitionFilter
  >;
  credentialBindings: MutableRepository<
    CredentialBinding,
    CredentialBindingFilter
  >;
  connectorBindings: MutableRepository<ConnectorBinding, ConnectorBindingFilter>;
  policyPacks: MutableRepository<PolicyPack, PolicyPackFilter>;
  agentBlueprints: MutableRepository<AgentBlueprint, AgentBlueprintFilter>;
  deployments: MutableRepository<DeploymentRecord, DeploymentFilter>;
  runSessions: MutableRepository<RunSession, RunSessionFilter>;
  auditEvents: AuditEventRepository;
}
