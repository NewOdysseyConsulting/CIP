import type {
  AgentBlueprint,
  ApprovalRequest,
  AuditEvent,
  ComplianceArtifact,
  ComplianceProfile,
  ConnectorBinding,
  ConnectorDefinition,
  ConnectorRateBucket,
  CredentialBinding,
  DisclosureRecord,
  DeploymentRecord,
  EvidenceBundle,
  GuardrailDefinition,
  HumanReviewRecord,
  PolicyPack,
  RunEvent,
  RunSession,
  TenantRecord,
} from "../domain/records.js";
import type {
  AgentBlueprintFilter,
  ApprovalRequestFilter,
  AuditEventFilter,
  ComplianceArtifactFilter,
  ComplianceProfileFilter,
  ConnectorBindingFilter,
  ConnectorDefinitionFilter,
  ConnectorRateBucketFilter,
  CredentialBindingFilter,
  DisclosureRecordFilter,
  DeploymentFilter,
  EvidenceBundleFilter,
  GuardrailDefinitionFilter,
  HumanReviewRecordFilter,
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
  complianceProfiles: MutableRepository<
    ComplianceProfile,
    ComplianceProfileFilter
  >;
  complianceArtifacts: MutableRepository<
    ComplianceArtifact,
    ComplianceArtifactFilter
  >;
  runSessions: MutableRepository<RunSession, RunSessionFilter>;
  approvalRequests: MutableRepository<ApprovalRequest, ApprovalRequestFilter>;
  disclosureRecords: MutableRepository<
    DisclosureRecord,
    DisclosureRecordFilter
  >;
  humanReviewRecords: MutableRepository<
    HumanReviewRecord,
    HumanReviewRecordFilter
  >;
  evidenceBundles: MutableRepository<EvidenceBundle, EvidenceBundleFilter>;
  connectorRateBuckets: MutableRepository<
    ConnectorRateBucket,
    ConnectorRateBucketFilter
  >;
  auditEvents: AuditEventRepository;
  runEvents: RunEventRepository;
}
