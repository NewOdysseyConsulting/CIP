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
} from "../../domain/records.js";
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
} from "../filters.js";
import type {
  AuditEventRepository,
  CipRepositories,
  MutableRepository,
  RunEventRepository,
} from "../ports.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const matchesOptional = <T>(value: T, expected: T | undefined): boolean =>
  expected === undefined || value === expected;

const matchesIncluded = (
  values: string[],
  expected: string | undefined,
): boolean => expected === undefined || values.includes(expected);

class InMemoryMutableRepository<TRecord extends { id: string }, TFilter = undefined>
  implements MutableRepository<TRecord, TFilter>
{
  private readonly records = new Map<string, TRecord>();

  constructor(
    private readonly matches: (record: TRecord, filter: TFilter) => boolean,
  ) {}

  async getById(id: string): Promise<TRecord | null> {
    const record = this.records.get(id);
    return record ? clone(record) : null;
  }

  async list(filter?: TFilter): Promise<TRecord[]> {
    const values = Array.from(this.records.values());
    const filtered =
      filter === undefined
        ? values
        : values.filter((record) => this.matches(record, filter));

    return filtered.map((record) => clone(record));
  }

  async save(record: TRecord): Promise<TRecord> {
    const persisted = clone(record);
    this.records.set(record.id, persisted);
    return clone(persisted);
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}

class InMemoryAuditEventRepository implements AuditEventRepository {
  private readonly events = new Map<string, AuditEvent>();

  async append(event: AuditEvent): Promise<AuditEvent> {
    const persisted = clone(event);
    this.events.set(event.id, persisted);
    return clone(persisted);
  }

  async getById(id: string): Promise<AuditEvent | null> {
    const event = this.events.get(id);
    return event ? clone(event) : null;
  }

  async list(filter?: AuditEventFilter): Promise<AuditEvent[]> {
    const events = Array.from(this.events.values());
    const filtered =
      filter === undefined
        ? events
        : events.filter((event) => {
            return (
              matchesOptional(event.tenantId, filter.tenantId) &&
              matchesOptional(event.deploymentId, filter.deploymentId) &&
              matchesOptional(event.sessionId, filter.sessionId) &&
              matchesOptional(event.category, filter.category) &&
              matchesOptional(event.severity, filter.severity) &&
              matchesOptional(event.action, filter.action)
            );
          });

    return filtered
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .map((event) => clone(event));
  }
}

class InMemoryRunEventRepository implements RunEventRepository {
  private readonly events = new Map<string, RunEvent>();

  async append(event: RunEvent): Promise<RunEvent> {
    const persisted = clone(event);
    this.events.set(event.id, persisted);
    return clone(persisted);
  }

  async getById(id: string): Promise<RunEvent | null> {
    const event = this.events.get(id);
    return event ? clone(event) : null;
  }

  async list(filter?: RunEventFilter): Promise<RunEvent[]> {
    const events = Array.from(this.events.values());
    const filtered =
      filter === undefined
        ? events
        : events.filter((event) => {
            return (
              matchesOptional(event.tenantId, filter.tenantId) &&
              matchesOptional(event.deploymentId, filter.deploymentId) &&
              matchesOptional(event.sessionId, filter.sessionId) &&
              matchesOptional(event.type, filter.type)
            );
          });

    return filtered
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => clone(event));
  }
}

const tenantMatches = (record: TenantRecord, filter: TenantFilter): boolean =>
  matchesOptional(record.status, filter.status) &&
  matchesOptional(record.productTier, filter.productTier) &&
  matchesIncluded(record.platforms, filter.platform);

const connectorDefinitionMatches = (
  record: ConnectorDefinition,
  filter: ConnectorDefinitionFilter,
): boolean =>
  matchesOptional(record.key, filter.key) &&
  matchesOptional(record.version, filter.version) &&
  matchesOptional(record.platform, filter.platform) &&
  matchesOptional(record.runtime, filter.runtime) &&
  matchesOptional(record.status, filter.status) &&
  matchesIncluded(record.capabilities, filter.capability);

const credentialBindingMatches = (
  record: CredentialBinding,
  filter: CredentialBindingFilter,
): boolean =>
  matchesOptional(record.tenantId, filter.tenantId) &&
  matchesOptional(record.provider, filter.provider) &&
  matchesOptional(record.status, filter.status);

const connectorBindingMatches = (
  record: ConnectorBinding,
  filter: ConnectorBindingFilter,
): boolean =>
  matchesOptional(record.tenantId, filter.tenantId) &&
  matchesOptional(record.connectorDefinitionId, filter.connectorDefinitionId) &&
  matchesOptional(record.credentialBindingId, filter.credentialBindingId) &&
  matchesOptional(record.environment, filter.environment) &&
  matchesOptional(record.status, filter.status);

const policyPackMatches = (
  record: PolicyPack,
  filter: PolicyPackFilter,
): boolean =>
  matchesOptional(record.domain, filter.domain) &&
  matchesOptional(record.ownership, filter.ownership) &&
  matchesOptional(record.tenantId, filter.tenantId) &&
  matchesOptional(record.status, filter.status);

const agentBlueprintMatches = (
  record: AgentBlueprint,
  filter: AgentBlueprintFilter,
): boolean =>
  matchesOptional(record.key, filter.key) &&
  matchesOptional(record.version, filter.version) &&
  matchesOptional(record.domain, filter.domain) &&
  matchesOptional(record.productTier, filter.productTier) &&
  matchesOptional(record.status, filter.status) &&
  matchesOptional(record.releaseState, filter.releaseState);

const deploymentMatches = (
  record: DeploymentRecord,
  filter: DeploymentFilter,
): boolean =>
  matchesOptional(record.tenantId, filter.tenantId) &&
  matchesOptional(record.agentBlueprintId, filter.agentBlueprintId) &&
  matchesOptional(record.environment, filter.environment) &&
  matchesOptional(record.status, filter.status);

const runSessionMatches = (
  record: RunSession,
  filter: RunSessionFilter,
): boolean =>
  matchesOptional(record.tenantId, filter.tenantId) &&
  matchesOptional(record.deploymentId, filter.deploymentId) &&
  matchesOptional(record.status, filter.status);

const guardrailDefinitionMatches = (
  record: GuardrailDefinition,
  filter: GuardrailDefinitionFilter,
): boolean =>
  matchesOptional(record.key, filter.key) &&
  matchesOptional(record.version, filter.version) &&
  matchesOptional(record.status, filter.status);

const approvalRequestMatches = (
  record: ApprovalRequest,
  filter: ApprovalRequestFilter,
): boolean =>
  matchesOptional(record.tenantId, filter.tenantId) &&
  matchesOptional(record.deploymentId, filter.deploymentId) &&
  matchesOptional(record.sessionId, filter.sessionId) &&
  matchesOptional(record.status, filter.status);

const evidenceBundleMatches = (
  record: EvidenceBundle,
  filter: EvidenceBundleFilter,
): boolean =>
  matchesOptional(record.tenantId, filter.tenantId) &&
  matchesOptional(record.deploymentId, filter.deploymentId) &&
  matchesOptional(record.sessionId, filter.sessionId);

const connectorRateBucketMatches = (
  record: ConnectorRateBucket,
  filter: ConnectorRateBucketFilter,
): boolean =>
  matchesOptional(record.provider, filter.provider) &&
  matchesOptional(record.externalSystemTenant, filter.externalSystemTenant) &&
  matchesOptional(record.environment, filter.environment) &&
  matchesOptional(record.apiFamily, filter.apiFamily);

export const createInMemoryCipRepositories = (): CipRepositories => ({
  tenants: new InMemoryMutableRepository<TenantRecord, TenantFilter>(tenantMatches),
  connectorDefinitions: new InMemoryMutableRepository<
    ConnectorDefinition,
    ConnectorDefinitionFilter
  >(connectorDefinitionMatches),
  credentialBindings: new InMemoryMutableRepository<
    CredentialBinding,
    CredentialBindingFilter
  >(credentialBindingMatches),
  connectorBindings: new InMemoryMutableRepository<
    ConnectorBinding,
    ConnectorBindingFilter
  >(connectorBindingMatches),
  policyPacks: new InMemoryMutableRepository<PolicyPack, PolicyPackFilter>(
    policyPackMatches,
  ),
  guardrailDefinitions: new InMemoryMutableRepository<
    GuardrailDefinition,
    GuardrailDefinitionFilter
  >(guardrailDefinitionMatches),
  agentBlueprints: new InMemoryMutableRepository<
    AgentBlueprint,
    AgentBlueprintFilter
  >(agentBlueprintMatches),
  deployments: new InMemoryMutableRepository<
    DeploymentRecord,
    DeploymentFilter
  >(deploymentMatches),
  runSessions: new InMemoryMutableRepository<RunSession, RunSessionFilter>(
    runSessionMatches,
  ),
  approvalRequests: new InMemoryMutableRepository<
    ApprovalRequest,
    ApprovalRequestFilter
  >(approvalRequestMatches),
  evidenceBundles: new InMemoryMutableRepository<
    EvidenceBundle,
    EvidenceBundleFilter
  >(evidenceBundleMatches),
  connectorRateBuckets: new InMemoryMutableRepository<
    ConnectorRateBucket,
    ConnectorRateBucketFilter
  >(connectorRateBucketMatches),
  auditEvents: new InMemoryAuditEventRepository(),
  runEvents: new InMemoryRunEventRepository(),
});
