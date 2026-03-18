import type {
  AgentBlueprint,
  ApprovalRequest,
  AuditEvent,
  ConnectorBinding,
  ConnectorDefinition,
  ConnectorRateBucket,
  CredentialBinding,
  DeploymentRecord,
  EvidenceBundle,
  GuardrailDefinition,
  PolicyPack,
  RunEvent,
  RunSession,
  TenantRecord,
} from "../domain/records.js";
import type {
  AgentBlueprintFilter,
  ApprovalRequestFilter,
  AuditEventFilter,
  ConnectorBindingFilter,
  ConnectorDefinitionFilter,
  ConnectorRateBucketFilter,
  CredentialBindingFilter,
  DeploymentFilter,
  EvidenceBundleFilter,
  GuardrailDefinitionFilter,
  PolicyPackFilter,
  RunEventFilter,
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

export interface RunEventRepository {
  append(event: RunEvent): Promise<RunEvent>;
  getById(id: string): Promise<RunEvent | null>;
  list(filter?: RunEventFilter): Promise<RunEvent[]>;
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
  guardrailDefinitions: MutableRepository<
    GuardrailDefinition,
    GuardrailDefinitionFilter
  >;
  agentBlueprints: MutableRepository<AgentBlueprint, AgentBlueprintFilter>;
  deployments: MutableRepository<DeploymentRecord, DeploymentFilter>;
  runSessions: MutableRepository<RunSession, RunSessionFilter>;
  approvalRequests: MutableRepository<ApprovalRequest, ApprovalRequestFilter>;
  evidenceBundles: MutableRepository<EvidenceBundle, EvidenceBundleFilter>;
  connectorRateBuckets: MutableRepository<
    ConnectorRateBucket,
    ConnectorRateBucketFilter
  >;
  auditEvents: AuditEventRepository;
  runEvents: RunEventRepository;
}
