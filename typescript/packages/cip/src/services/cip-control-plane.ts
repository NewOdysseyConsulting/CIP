import { randomUUID } from "node:crypto";

import type {
  AgentBlueprint,
  ApprovalRequest,
  AuditActor,
  AuditEvent,
  BaseRecord,
  BlueprintDependencySnapshot,
  ComplianceArtifact,
  ComplianceProfile,
  ConnectorBinding,
  ConnectorDefinition,
  CredentialBinding,
  DeploymentRecord,
  DeploymentStatus,
  DisclosureRecord,
  Environment,
  EvidenceBundle,
  GuardrailDefinition,
  HumanReviewRecord,
  PolicyDomain,
  PolicyPack,
  PolicyRule,
  ProductTier,
  RunEvent,
  RunSession,
  RunSessionStatus,
  RuntimeProfile,
  TenantRecord,
  TraceCorrelation,
} from "../domain/records.js";
import type { TelemetrySink } from "../observability/types.js";
import type { CipRepositories } from "../repositories/ports.js";
import type {
  HumanApprovalCheckpoint,
  HumanApprovalDecision,
} from "../runtime/types.js";

export class CipControlPlaneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CipControlPlaneError";
  }
}

const buildRecordMetadata = (id?: string): BaseRecord => {
  const now = new Date().toISOString();

  return {
    id: id ?? randomUUID(),
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
};

const touchRecord = <TRecord extends BaseRecord>(record: TRecord): TRecord => ({
  ...record,
  updatedAt: new Date().toISOString(),
  revision: record.revision + 1,
});

const systemActor = (id = "cip-control-plane"): AuditActor => ({
  type: "system",
  id,
});

const nowIso = (): string => new Date().toISOString();

const defaultComplianceTransparency = (): ComplianceProfile["transparency"] => ({
  required: false,
  noticeText: "",
  placement: "banner-and-first-message",
  requiresAcknowledgement: false,
});

const defaultComplianceOversight = (): ComplianceProfile["oversight"] => ({
  required: false,
  requireApprovalBeforeCompletion: false,
  minimumHumanReviewers: 0,
  stopMechanismRequired: false,
});

const defaultComplianceLogging = (): ComplianceProfile["logging"] => ({
  requireVerifiedActors: false,
  retentionDays: 30,
});

const requiredHighRiskArtifactStatuses: Record<
  ComplianceArtifact["kind"],
  ComplianceArtifact["status"]
> = {
  technical_documentation: "approved",
  fundamental_rights_impact_assessment: "approved",
  conformity_assessment: "approved",
  eu_declaration_of_conformity: "filed",
  eu_database_registration: "filed",
  post_market_monitoring_plan: "approved",
  serious_incident_record: "not_applicable",
};

const parseSemver = (value: string): [number, number, number] => {
  const [major = "1", minor = "0", patch = "0"] = value.split(".");
  return [
    Number.parseInt(major, 10) || 1,
    Number.parseInt(minor, 10) || 0,
    Number.parseInt(patch, 10) || 0,
  ];
};

const incrementPatchVersion = (value: string | undefined): string => {
  if (value === undefined) {
    return "1.0.0";
  }

  const [major, minor, patch] = parseSemver(value);
  return `${major}.${minor}.${patch + 1}`;
};

const allowedDeploymentTransitions: Record<
  DeploymentStatus,
  readonly DeploymentStatus[]
> = {
  provisioning: ["active", "failed", "retired"],
  active: ["paused", "draining", "failed", "retired"],
  paused: ["active", "failed", "retired"],
  draining: ["paused", "failed", "retired"],
  failed: ["provisioning", "retired"],
  retired: [],
};

class NoopTelemetrySink implements TelemetrySink {
  async record(): Promise<void> {}
}

export interface RegisterTenantInput {
  id?: string;
  slug: string;
  displayName: string;
  productTier: ProductTier;
  platforms: string[];
  regions: string[];
  status?: TenantRecord["status"];
}

export interface RegisterConnectorDefinitionInput {
  id?: string;
  key: string;
  version?: string;
  platform: string;
  displayName: string;
  driverKey?: string;
  driverConfig?: Record<string, unknown>;
  runtime: ConnectorDefinition["runtime"];
  authStrategy: ConnectorDefinition["authStrategy"];
  source: ConnectorDefinition["source"];
  capabilities: string[];
  metadata?: Record<string, unknown>;
  status?: ConnectorDefinition["status"];
}

export interface CreateCredentialBindingInput {
  id?: string;
  tenantId: string;
  name: string;
  provider: string;
  secretBackendKey?: string;
  secretRef: string;
  scopes: string[];
  expiresAt?: string;
  status?: CredentialBinding["status"];
}

export interface CreateConnectorBindingInput {
  id?: string;
  tenantId: string;
  connectorDefinitionId: string;
  credentialBindingId: string;
  environment: Environment;
  alias: string;
  endpoint: string;
  config?: Record<string, unknown>;
  status?: ConnectorBinding["status"];
}

export interface PublishPolicyPackInput {
  id?: string;
  key: string;
  name: string;
  domain: PolicyDomain;
  version: string;
  ownership: PolicyPack["ownership"];
  tenantId?: string;
  rules: PolicyRule[];
  guardrailRefs?: string[];
  status?: PolicyPack["status"];
}

export interface PublishGuardrailDefinitionInput {
  id?: string;
  key: GuardrailDefinition["key"];
  version?: string;
  name: string;
  description?: string;
  configuration: GuardrailDefinition["configuration"];
  status?: GuardrailDefinition["status"];
}

export interface RegisterAgentBlueprintInput {
  id?: string;
  key: string;
  version?: string;
  name: string;
  productTier: ProductTier;
  domain: PolicyDomain;
  description: string;
  runtime: RuntimeProfile;
  connectorDefinitionIds: string[];
  policyPackIds: string[];
  guardrailDefinitionIds?: string[];
  releaseState?: AgentBlueprint["releaseState"];
  supersedesBlueprintId?: string;
  handoffTargets?: string[];
  structuredOutput?: string;
  status?: AgentBlueprint["status"];
}

export interface DeployAgentInput {
  id?: string;
  tenantId: string;
  agentBlueprintId: string;
  environment: Environment;
  connectorBindingIds: string[];
  policyPackIds?: string[];
  tags?: string[];
  status?: DeploymentRecord["status"];
}

export interface TransitionDeploymentInput {
  deploymentId: string;
  targetStatus: DeploymentStatus;
  actor?: AuditActor;
  reason?: string;
}

export interface RollbackDeploymentInput {
  deploymentId: string;
  targetBlueprintId: string;
  actor?: AuditActor;
  reason?: string;
}

export interface StartRunSessionInput {
  id?: string;
  tenantId: string;
  deploymentId: string;
  correlationId?: string;
  inputSummary: string;
  traceCorrelation?: TraceCorrelation;
}

export interface CompleteRunSessionInput {
  sessionId: string;
  status: Extract<RunSession["status"], "completed" | "failed">;
  outputSummary?: string;
}

export interface AppendRunEventInput {
  id?: string;
  sessionId: string;
  type: RunEvent["type"];
  actor?: AuditActor;
  assertedActor?: AuditActor;
  actorVerification?: RunEvent["actorVerification"];
  payload?: Record<string, unknown>;
  traceCorrelation?: TraceCorrelation;
  occurredAt?: string;
}

export interface AppendAuditEventInput {
  id?: string;
  tenantId: string;
  deploymentId?: string;
  sessionId?: string;
  category: AuditEvent["category"];
  action: string;
  severity?: AuditEvent["severity"];
  actor: AuditActor;
  assertedActor?: AuditActor;
  actorVerification?: AuditEvent["actorVerification"];
  payload: Record<string, unknown>;
  occurredAt?: string;
}

export interface UpsertComplianceProfileInput {
  id?: string;
  deploymentId: string;
  regime: ComplianceProfile["regime"];
  servesEuUsers: boolean;
  intendedPurpose: string;
  riskTier: ComplianceProfile["riskTier"];
  highRiskBasis?: ComplianceProfile["highRiskBasis"];
  transparency?: Partial<ComplianceProfile["transparency"]>;
  oversight?: Partial<ComplianceProfile["oversight"]>;
  logging?: Partial<ComplianceProfile["logging"]>;
}

export interface CreateComplianceArtifactInput {
  id?: string;
  deploymentId: string;
  kind: ComplianceArtifact["kind"];
  status: ComplianceArtifact["status"];
  owner: string;
  summary: string;
  externalRef?: string;
  dueAt?: string;
  completedAt?: string;
}

export interface RecordDisclosureInput {
  id?: string;
  sessionId: string;
  disclosureVersion: string;
  surface: DisclosureRecord["surface"];
  presentedAt: string;
  acknowledgedAt?: string;
}

export interface RecordHumanReviewInput {
  id?: string;
  sessionId: string;
  reviewerId?: string;
  decision: HumanReviewRecord["decision"];
  comment?: string;
  reviewedAt: string;
  actor?: AuditActor;
}

export interface RequestHumanApprovalInput {
  sessionId: string;
  checkpoint: HumanApprovalCheckpoint;
  actor?: AuditActor;
}

export interface ResolveApprovalRequestInput extends HumanApprovalDecision {
  actor?: AuditActor;
}

export interface ReplayedRunSession {
  session: RunSession;
  runEvents: RunEvent[];
  approvalRequests: ApprovalRequest[];
  disclosureRecords: DisclosureRecord[];
  humanReviews: HumanReviewRecord[];
  complianceProfile: ComplianceProfile | null;
  complianceArtifactIds: string[];
  evidenceBundle: EvidenceBundle | null;
  reconstructedStatus: RunSessionStatus;
}

export interface CipControlPlaneOptions {
  telemetrySink?: TelemetrySink;
}

export class CipControlPlane {
  private readonly telemetrySink: TelemetrySink;

  constructor(
    private readonly repositories: CipRepositories,
    options: CipControlPlaneOptions = {},
  ) {
    this.telemetrySink = options.telemetrySink ?? new NoopTelemetrySink();
  }

  async registerTenant(input: RegisterTenantInput): Promise<TenantRecord> {
    const tenant: TenantRecord = {
      ...buildRecordMetadata(input.id),
      slug: input.slug,
      displayName: input.displayName,
      productTier: input.productTier,
      platforms: input.platforms,
      regions: input.regions,
      status: input.status ?? "active",
    };

    await this.repositories.tenants.save(tenant);
    await this.recordAuditEvent({
      tenantId: tenant.id,
      category: "tenant",
      action: "tenant.registered",
      actor: { type: "system", id: "cip-control-plane" },
      payload: { slug: tenant.slug, productTier: tenant.productTier },
    });

    return tenant;
  }

  async registerConnectorDefinition(
    input: RegisterConnectorDefinitionInput,
  ): Promise<ConnectorDefinition> {
    const existing = await this.repositories.connectorDefinitions.list({
      key: input.key,
    });
    const latestVersion = existing
      .map((record) => record.version)
      .sort()
      .at(-1);

    const connectorDefinition: ConnectorDefinition = {
      ...buildRecordMetadata(input.id),
      key: input.key,
      version: input.version ?? incrementPatchVersion(latestVersion),
      platform: input.platform,
      displayName: input.displayName,
      ...(input.driverKey === undefined ? {} : { driverKey: input.driverKey }),
      ...(input.driverConfig === undefined
        ? {}
        : { driverConfig: input.driverConfig }),
      runtime: input.runtime,
      authStrategy: input.authStrategy,
      source: input.source,
      capabilities: input.capabilities,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      status: input.status ?? "active",
    };

    return this.repositories.connectorDefinitions.save(connectorDefinition);
  }

  async createCredentialBinding(
    input: CreateCredentialBindingInput,
  ): Promise<CredentialBinding> {
    await this.ensureTenantExists(input.tenantId);

    const credentialBinding: CredentialBinding = {
      ...buildRecordMetadata(input.id),
      tenantId: input.tenantId,
      name: input.name,
      provider: input.provider,
      ...(input.secretBackendKey === undefined
        ? {}
        : { secretBackendKey: input.secretBackendKey }),
      secretRef: input.secretRef,
      scopes: input.scopes,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      status: input.status ?? "active",
    };

    await this.repositories.credentialBindings.save(credentialBinding);
    await this.recordAuditEvent({
      tenantId: input.tenantId,
      category: "security",
      action: "credential.bound",
      actor: { type: "system", id: "cip-control-plane" },
      payload: { provider: input.provider, credentialBindingId: credentialBinding.id },
    });

    return credentialBinding;
  }

  async createConnectorBinding(
    input: CreateConnectorBindingInput,
  ): Promise<ConnectorBinding> {
    await this.ensureTenantExists(input.tenantId);

    const connectorDefinition = await this.ensureConnectorDefinitionExists(
      input.connectorDefinitionId,
    );
    const credentialBinding = await this.ensureCredentialBindingExists(
      input.credentialBindingId,
    );

    if (credentialBinding.tenantId !== input.tenantId) {
      throw new CipControlPlaneError(
        "connector bindings must use credentials from the same tenant",
      );
    }

    const connectorBinding: ConnectorBinding = {
      ...buildRecordMetadata(input.id),
      tenantId: input.tenantId,
      connectorDefinitionId: input.connectorDefinitionId,
      credentialBindingId: input.credentialBindingId,
      environment: input.environment,
      alias: input.alias,
      endpoint: input.endpoint,
      config: input.config ?? {},
      status: input.status ?? "active",
    };

    await this.repositories.connectorBindings.save(connectorBinding);
    await this.recordAuditEvent({
      tenantId: input.tenantId,
      category: "connector",
      action: "connector.bound",
      actor: { type: "system", id: "cip-control-plane" },
      payload: {
        connectorBindingId: connectorBinding.id,
        connectorDefinitionKey: connectorDefinition.key,
        environment: input.environment,
      },
    });

    return connectorBinding;
  }

  async publishPolicyPack(input: PublishPolicyPackInput): Promise<PolicyPack> {
    if (input.ownership === "tenant" && input.tenantId === undefined) {
      throw new CipControlPlaneError(
        "tenant-owned policy packs require a tenantId",
      );
    }

    if (input.tenantId !== undefined) {
      await this.ensureTenantExists(input.tenantId);
    }

    const policyPack: PolicyPack = {
      ...buildRecordMetadata(input.id),
      key: input.key,
      name: input.name,
      domain: input.domain,
      version: input.version,
      ownership: input.ownership,
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
      rules: input.rules,
      guardrailRefs: input.guardrailRefs ?? [],
      status: input.status ?? "active",
    };

    await this.repositories.policyPacks.save(policyPack);
    await this.recordAuditEvent({
      tenantId: input.tenantId ?? "shared",
      category: "policy",
      action: "policy_pack.published",
      actor: systemActor(),
      payload: {
        policyPackId: policyPack.id,
        key: policyPack.key,
        version: policyPack.version,
      },
    });
    return policyPack;
  }

  async publishGuardrailDefinition(
    input: PublishGuardrailDefinitionInput,
  ): Promise<GuardrailDefinition> {
    const existing = await this.repositories.guardrailDefinitions.list({
      key: input.key,
    });
    const latestVersion = existing
      .map((record) => record.version)
      .sort()
      .at(-1);

    const definition: GuardrailDefinition = {
      ...buildRecordMetadata(input.id),
      key: input.key,
      version: input.version ?? incrementPatchVersion(latestVersion),
      name: input.name,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      configuration: input.configuration,
      status: input.status ?? "active",
    };

    await this.repositories.guardrailDefinitions.save(definition);
    await this.recordAuditEvent({
      tenantId: "shared",
      category: "policy",
      action: "guardrail_definition.published",
      actor: systemActor(),
      payload: {
        guardrailDefinitionId: definition.id,
        key: definition.key,
        version: definition.version,
      },
    });
    return definition;
  }

  async registerAgentBlueprint(
    input: RegisterAgentBlueprintInput,
  ): Promise<AgentBlueprint> {
    const connectorDefinitions = await Promise.all(
      input.connectorDefinitionIds.map((connectorDefinitionId) =>
        this.ensureConnectorDefinitionExists(connectorDefinitionId),
      ),
    );
    const policyPacks = await Promise.all(
      input.policyPackIds.map((policyPackId) =>
        this.ensurePolicyPackExists(policyPackId),
      ),
    );
    const guardrailDefinitionIds = input.guardrailDefinitionIds ?? [];
    const guardrailDefinitions = await Promise.all(
      guardrailDefinitionIds.map((guardrailDefinitionId) =>
        this.ensureGuardrailDefinitionExists(guardrailDefinitionId),
      ),
    );

    if (input.supersedesBlueprintId !== undefined) {
      await this.ensureAgentBlueprintExists(input.supersedesBlueprintId);
    }

    const existing = await this.repositories.agentBlueprints.list({
      key: input.key,
    });
    const latestVersion = existing
      .map((record) => record.version)
      .sort()
      .at(-1);

    const version = input.version ?? incrementPatchVersion(latestVersion);
    const duplicate = existing.find((record) => record.version === version);
    if (duplicate !== undefined) {
      throw new CipControlPlaneError(
        `agent blueprint ${input.key}@${version} already exists`,
      );
    }

    const dependencySnapshot: BlueprintDependencySnapshot = {
      policyPacks: policyPacks.map((policyPack) => ({
        id: policyPack.id,
        key: policyPack.key,
        version: policyPack.version,
      })),
      guardrails: guardrailDefinitions.map((definition) => ({
        id: definition.id,
        key: definition.key,
        version: definition.version,
      })),
      connectorManifests: connectorDefinitions.map((definition) => ({
        id: definition.id,
        key: definition.key,
        version: definition.version,
      })),
      runtimeAdapterVersion: input.runtime.adapterVersion ?? "unspecified",
    };

    const agentBlueprint: AgentBlueprint = {
      ...buildRecordMetadata(input.id),
      key: input.key,
      version,
      releaseState: input.releaseState ?? "released",
      ...(input.supersedesBlueprintId === undefined
        ? {}
        : { supersedesBlueprintId: input.supersedesBlueprintId }),
      dependencySnapshot,
      name: input.name,
      productTier: input.productTier,
      domain: input.domain,
      description: input.description,
      runtime: input.runtime,
      connectorDefinitionIds: input.connectorDefinitionIds,
      policyPackIds: input.policyPackIds,
      guardrailDefinitionIds,
      handoffTargets: input.handoffTargets ?? [],
      ...(input.structuredOutput === undefined
        ? {}
        : { structuredOutput: input.structuredOutput }),
      status:
        input.status ??
        ((input.releaseState ?? "released") === "released" ? "active" : "draft"),
    };

    const saved = await this.repositories.agentBlueprints.save(agentBlueprint);
    await this.recordAuditEvent({
      tenantId: "shared",
      category: "deployment",
      action: "agent_blueprint.released",
      actor: systemActor(),
      payload: {
        agentBlueprintId: saved.id,
        key: saved.key,
        version: saved.version,
        releaseState: saved.releaseState,
      },
    });
    return saved;
  }

  async deployAgent(input: DeployAgentInput): Promise<DeploymentRecord> {
    await this.ensureTenantExists(input.tenantId);
    const blueprint = await this.ensureAgentBlueprintExists(input.agentBlueprintId);

    const connectorBindings = await Promise.all(
      input.connectorBindingIds.map((connectorBindingId) =>
        this.ensureConnectorBindingExists(connectorBindingId),
      ),
    );

    for (const connectorBinding of connectorBindings) {
      if (connectorBinding.tenantId !== input.tenantId) {
        throw new CipControlPlaneError(
          "deployments may only use connector bindings from the same tenant",
        );
      }
    }

    const suppliedConnectorDefinitionIds = new Set(
      connectorBindings.map(
        (connectorBinding) => connectorBinding.connectorDefinitionId,
      ),
    );

    const missingConnectorDefinitions = blueprint.connectorDefinitionIds.filter(
      (connectorDefinitionId) =>
        !suppliedConnectorDefinitionIds.has(connectorDefinitionId),
    );

    if (missingConnectorDefinitions.length > 0) {
      throw new CipControlPlaneError(
        `missing required connector bindings for blueprint ${blueprint.key}`,
      );
    }

    const policyPackIds = input.policyPackIds ?? blueprint.policyPackIds;
    const policyPacks = await Promise.all(
      policyPackIds.map((policyPackId) => this.ensurePolicyPackExists(policyPackId)),
    );

    for (const policyPack of policyPacks) {
      if (
        policyPack.ownership === "tenant" &&
        policyPack.tenantId !== input.tenantId
      ) {
        throw new CipControlPlaneError(
          "tenant-owned policy packs must belong to the deployment tenant",
        );
      }
    }

    const deployment: DeploymentRecord = {
      ...buildRecordMetadata(input.id),
      tenantId: input.tenantId,
      agentBlueprintId: input.agentBlueprintId,
      agentBlueprintVersion: blueprint.version,
      environment: input.environment,
      connectorBindingIds: input.connectorBindingIds,
      policyPackIds,
      status: input.status ?? "provisioning",
      deployedAt: nowIso(),
      lastTransitionAt: nowIso(),
      tags: input.tags ?? [],
    };

    await this.repositories.deployments.save(deployment);
    await this.recordAuditEvent({
      tenantId: input.tenantId,
      deploymentId: deployment.id,
      category: "deployment",
      action: "deployment.created",
      actor: { type: "system", id: "cip-control-plane" },
      payload: {
        agentBlueprintId: deployment.agentBlueprintId,
        agentBlueprintVersion: deployment.agentBlueprintVersion,
        environment: deployment.environment,
        status: deployment.status,
      },
    });

    return deployment;
  }

  async transitionDeployment(
    input: TransitionDeploymentInput,
  ): Promise<DeploymentRecord> {
    const deployment = await this.ensureDeploymentExists(input.deploymentId);
    const allowed = allowedDeploymentTransitions[deployment.status];

    if (!allowed.includes(input.targetStatus)) {
      throw new CipControlPlaneError(
        `invalid deployment transition: ${deployment.status} -> ${input.targetStatus}`,
      );
    }

    if (input.targetStatus === "active") {
      await this.ensureDeploymentComplianceReady(deployment.id);
    }

    const updated: DeploymentRecord = {
      ...touchRecord(deployment),
      status: input.targetStatus,
      lastTransitionAt: nowIso(),
    };

    await this.repositories.deployments.save(updated);
    await this.recordAuditEvent({
      tenantId: updated.tenantId,
      deploymentId: updated.id,
      category: "deployment",
      action: "deployment.transitioned",
      actor: input.actor ?? systemActor(),
      actorVerification: "system",
      payload: {
        from: deployment.status,
        to: input.targetStatus,
        reason: input.reason ?? null,
      },
    });

    return updated;
  }

  async getComplianceProfile(
    deploymentId: string,
  ): Promise<ComplianceProfile | null> {
    const deployment = await this.ensureDeploymentExists(deploymentId);
    const [profile] = await this.repositories.complianceProfiles.list({
      deploymentId: deployment.id,
    });
    return profile ?? null;
  }

  async upsertComplianceProfile(
    input: UpsertComplianceProfileInput,
  ): Promise<ComplianceProfile> {
    const deployment = await this.ensureDeploymentExists(input.deploymentId);
    const [existing] = await this.repositories.complianceProfiles.list({
      deploymentId: deployment.id,
    });
    const metadata =
      existing === undefined ? buildRecordMetadata(input.id) : touchRecord(existing);
    const transparencyDefaults = defaultComplianceTransparency();
    const oversightDefaults = defaultComplianceOversight();
    const loggingDefaults = defaultComplianceLogging();
    const profile: ComplianceProfile = {
      ...metadata,
      tenantId: deployment.tenantId,
      deploymentId: deployment.id,
      regime: input.regime,
      servesEuUsers: input.servesEuUsers,
      intendedPurpose: input.intendedPurpose,
      riskTier: input.riskTier,
      ...(input.highRiskBasis === undefined
        ? {}
        : { highRiskBasis: input.highRiskBasis }),
      transparency: {
        ...(existing?.transparency ?? transparencyDefaults),
        ...(input.transparency ?? {}),
      },
      oversight: {
        ...(existing?.oversight ?? oversightDefaults),
        ...(input.oversight ?? {}),
      },
      logging: {
        ...(existing?.logging ?? loggingDefaults),
        ...(input.logging ?? {}),
      },
    };

    await this.repositories.complianceProfiles.save(profile);
    await this.recordAuditEvent({
      tenantId: deployment.tenantId,
      deploymentId: deployment.id,
      category: "deployment",
      action: "compliance_profile.upserted",
      actor: systemActor(),
      actorVerification: "system",
      payload: {
        complianceProfileId: profile.id,
        regime: profile.regime,
        riskTier: profile.riskTier,
      },
    });
    return profile;
  }

  async listComplianceArtifacts(
    deploymentId: string,
  ): Promise<ComplianceArtifact[]> {
    const deployment = await this.ensureDeploymentExists(deploymentId);
    return this.repositories.complianceArtifacts.list({
      deploymentId: deployment.id,
    });
  }

  async createComplianceArtifact(
    input: CreateComplianceArtifactInput,
  ): Promise<ComplianceArtifact> {
    const deployment = await this.ensureDeploymentExists(input.deploymentId);
    const artifact: ComplianceArtifact = {
      ...buildRecordMetadata(input.id),
      tenantId: deployment.tenantId,
      deploymentId: deployment.id,
      kind: input.kind,
      status: input.status,
      owner: input.owner,
      summary: input.summary,
      ...(input.externalRef === undefined ? {} : { externalRef: input.externalRef }),
      ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
    };

    await this.repositories.complianceArtifacts.save(artifact);
    await this.recordAuditEvent({
      tenantId: deployment.tenantId,
      deploymentId: deployment.id,
      category: "deployment",
      action: "compliance_artifact.created",
      actor: systemActor(),
      actorVerification: "system",
      payload: {
        complianceArtifactId: artifact.id,
        kind: artifact.kind,
        status: artifact.status,
      },
    });
    return artifact;
  }

  async rollbackDeploymentToBlueprint(
    input: RollbackDeploymentInput,
  ): Promise<DeploymentRecord> {
    const deployment = await this.ensureDeploymentExists(input.deploymentId);
    const blueprint = await this.ensureAgentBlueprintExists(input.targetBlueprintId);

    const updated: DeploymentRecord = {
      ...touchRecord(deployment),
      agentBlueprintId: blueprint.id,
      agentBlueprintVersion: blueprint.version,
      lastTransitionAt: nowIso(),
    };

    await this.repositories.deployments.save(updated);
    await this.recordAuditEvent({
      tenantId: updated.tenantId,
      deploymentId: updated.id,
      category: "deployment",
      action: "deployment.blueprint.rollback",
      actor: input.actor ?? systemActor(),
      actorVerification: "system",
      payload: {
        targetBlueprintId: blueprint.id,
        targetBlueprintVersion: blueprint.version,
        reason: input.reason ?? null,
      },
    });

    return updated;
  }

  async startRunSession(input: StartRunSessionInput): Promise<RunSession> {
    await this.ensureTenantExists(input.tenantId);
    const deployment = await this.ensureDeploymentExists(input.deploymentId);

    if (deployment.tenantId !== input.tenantId) {
      throw new CipControlPlaneError(
        "run sessions must reference a deployment from the same tenant",
      );
    }

    if (deployment.status !== "active") {
      throw new CipControlPlaneError(
        "run sessions can only be started against active deployments",
      );
    }

    const complianceProfile = await this.getComplianceProfile(input.deploymentId);

    const session: RunSession = {
      ...buildRecordMetadata(input.id),
      tenantId: input.tenantId,
      deploymentId: input.deploymentId,
      correlationId: input.correlationId ?? randomUUID(),
      status: "running",
      startedAt: nowIso(),
      inputSummary: input.inputSummary,
      complianceProfileSnapshot: complianceProfile,
      ...(input.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: input.traceCorrelation }),
    };

    await this.repositories.runSessions.save(session);
    await this.appendRunEvent({
      sessionId: session.id,
      type: "run_started",
      actor: { type: "agent", id: "cip-runtime" },
      actorVerification: "system",
      payload: {
        correlationId: session.correlationId,
        inputSummary: session.inputSummary,
      },
      ...(input.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: input.traceCorrelation }),
    });
    await this.recordAuditEvent({
      tenantId: input.tenantId,
      deploymentId: deployment.id,
      sessionId: session.id,
      category: "session",
      action: "session.started",
      actor: { type: "agent", id: "cip-runtime" },
      actorVerification: "system",
      payload: {
        deploymentId: deployment.id,
        correlationId: session.correlationId,
        complianceProfileId: complianceProfile?.id ?? null,
      },
    });

    return session;
  }

  async completeRunSession(input: CompleteRunSessionInput): Promise<RunSession> {
    const session = await this.ensureRunSessionExists(input.sessionId);
    if (session.status === "completed" || session.status === "failed") {
      throw new CipControlPlaneError(`session ${session.id} is already terminal`);
    }

    await this.ensureSessionCompletionRequirements(session);

    const { currentApprovalRequestId: _ignoredApprovalRequestId, ...sessionWithoutApproval } =
      touchRecord(session);
    const updatedSession: RunSession = {
      ...sessionWithoutApproval,
      status: input.status,
      completedAt: nowIso(),
      ...(input.outputSummary === undefined
        ? {}
        : { outputSummary: input.outputSummary }),
    };

    await this.repositories.runSessions.save(updatedSession);
    await this.appendRunEvent({
      sessionId: session.id,
      type: input.status === "completed" ? "run_completed" : "run_failed",
      actor: { type: "agent", id: "cip-runtime" },
      actorVerification: "system",
      payload: { outputSummary: input.outputSummary ?? null },
      ...(session.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: session.traceCorrelation }),
    });
    await this.recordAuditEvent({
      tenantId: updatedSession.tenantId,
      deploymentId: updatedSession.deploymentId,
      sessionId: updatedSession.id,
      category: "session",
      action: "session.completed",
      actor: { type: "agent", id: "cip-runtime" },
      actorVerification: "system",
      payload: { status: updatedSession.status },
    });

    await this.persistEvidenceBundle(updatedSession);

    return updatedSession;
  }

  async recordDisclosure(input: RecordDisclosureInput): Promise<DisclosureRecord> {
    const session = await this.ensureRunSessionExists(input.sessionId);
    const disclosure: DisclosureRecord = {
      ...buildRecordMetadata(input.id),
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      disclosureVersion: input.disclosureVersion,
      surface: input.surface,
      presentedAt: input.presentedAt,
      ...(input.acknowledgedAt === undefined
        ? {}
        : { acknowledgedAt: input.acknowledgedAt }),
    };

    await this.repositories.disclosureRecords.save(disclosure);
    await this.appendRunEvent({
      sessionId: session.id,
      type: "disclosure_presented",
      actor: { type: "system", id: "cip-control-plane" },
      actorVerification: "system",
      payload: {
        disclosureRecordId: disclosure.id,
        disclosureVersion: disclosure.disclosureVersion,
        surface: disclosure.surface,
      },
      occurredAt: disclosure.presentedAt,
      ...(session.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: session.traceCorrelation }),
    });
    if (disclosure.acknowledgedAt !== undefined) {
      await this.appendRunEvent({
        sessionId: session.id,
        type: "disclosure_acknowledged",
        actor: { type: "system", id: "cip-control-plane" },
        actorVerification: "system",
        payload: {
          disclosureRecordId: disclosure.id,
          disclosureVersion: disclosure.disclosureVersion,
        },
        occurredAt: disclosure.acknowledgedAt,
        ...(session.traceCorrelation === undefined
          ? {}
          : { traceCorrelation: session.traceCorrelation }),
      });
    }
    await this.recordAuditEvent({
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      category: "session",
      action: "disclosure.recorded",
      actor: systemActor(),
      actorVerification: "system",
      payload: {
        disclosureRecordId: disclosure.id,
        disclosureVersion: disclosure.disclosureVersion,
        acknowledged: disclosure.acknowledgedAt !== undefined,
      },
      occurredAt: disclosure.presentedAt,
    });
    return disclosure;
  }

  async recordHumanReview(
    input: RecordHumanReviewInput,
  ): Promise<HumanReviewRecord> {
    const session = await this.ensureRunSessionExists(input.sessionId);
    if (
      session.complianceProfileSnapshot?.logging.requireVerifiedActors === true &&
      input.actor === undefined
    ) {
      throw new CipControlPlaneError(
        `session ${session.id} requires a verified human reviewer actor`,
      );
    }
    const reviewer = input.actor ?? {
      type: "human",
      id: input.reviewerId ?? "reviewer",
    };
    const review: HumanReviewRecord = {
      ...buildRecordMetadata(input.id),
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      reviewer,
      decision: input.decision,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
      reviewedAt: input.reviewedAt,
    };

    await this.repositories.humanReviewRecords.save(review);
    await this.appendRunEvent({
      sessionId: session.id,
      type: "human_review_completed",
      actor: reviewer,
      actorVerification:
        input.actor === undefined ? "asserted" : "authenticated-operator",
      payload: {
        humanReviewId: review.id,
        decision: review.decision,
        comment: review.comment ?? null,
      },
      occurredAt: review.reviewedAt,
      ...(session.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: session.traceCorrelation }),
    });
    await this.recordAuditEvent({
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      category: "approval",
      action: "human_review.recorded",
      actor: reviewer,
      actorVerification:
        input.actor === undefined ? "asserted" : "authenticated-operator",
      payload: {
        humanReviewId: review.id,
        decision: review.decision,
      },
      occurredAt: review.reviewedAt,
    });
    return review;
  }

  async appendRunEvent(input: AppendRunEventInput): Promise<RunEvent> {
    const session = await this.ensureRunSessionExists(input.sessionId);
    if (input.id !== undefined) {
      const existing = await this.repositories.runEvents.getById(input.id);
      if (existing !== null) {
        return existing;
      }
    }
    const priorEvents = await this.repositories.runEvents.list({
      sessionId: session.id,
    });
    const event: RunEvent = {
      ...buildRecordMetadata(input.id),
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      type: input.type,
      sequence: priorEvents.length + 1,
      occurredAt: input.occurredAt ?? nowIso(),
      actor: input.actor ?? { type: "agent", id: "cip-runtime" },
      ...(input.assertedActor === undefined
        ? {}
        : { assertedActor: input.assertedActor }),
      actorVerification: input.actorVerification ?? "asserted",
      payload: input.payload ?? {},
      ...(input.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: input.traceCorrelation }),
    };

    const saved = await this.repositories.runEvents.append(event);
    await this.telemetrySink.record({
      name: `run_event.${saved.type}`,
      occurredAt: saved.occurredAt,
      attributes: {
        tenantId: saved.tenantId,
        deploymentId: saved.deploymentId,
        sessionId: saved.sessionId,
        sequence: saved.sequence,
      },
    });
    return saved;
  }

  async appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent> {
    if (input.id !== undefined) {
      const existing = await this.repositories.auditEvents.getById(input.id);
      if (existing !== null) {
        return existing;
      }
    }
    return this.recordAuditEvent({
      ...(input.id === undefined ? {} : { id: input.id }),
      tenantId: input.tenantId,
      ...(input.deploymentId === undefined
        ? {}
        : { deploymentId: input.deploymentId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      category: input.category,
      action: input.action,
      actor: input.actor,
      ...(input.assertedActor === undefined
        ? {}
        : { assertedActor: input.assertedActor }),
      actorVerification: input.actorVerification ?? "asserted",
      payload: input.payload,
      ...(input.severity === undefined ? {} : { severity: input.severity }),
      ...(input.occurredAt === undefined
        ? {}
        : { occurredAt: input.occurredAt }),
    });
  }

  async getEvidenceBundle(sessionId: string): Promise<EvidenceBundle | null> {
    const [bundle] = await this.repositories.evidenceBundles.list({ sessionId });
    return bundle ?? null;
  }

  async requestHumanApproval(
    input: RequestHumanApprovalInput,
  ): Promise<ApprovalRequest> {
    const session = await this.ensureRunSessionExists(input.sessionId);

    if (session.status !== "running") {
      throw new CipControlPlaneError(
        "human approval can only be requested for running sessions",
      );
    }

    const approvalRequest: ApprovalRequest = {
      ...buildRecordMetadata(),
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      checkpointId: input.checkpoint.checkpointId,
      reason: input.checkpoint.reason,
      requestedBy: input.actor ?? { type: "agent", id: "cip-runtime" },
      status: "pending",
      ...(input.checkpoint.expiresAt === undefined
        ? {}
        : { expiresAt: input.checkpoint.expiresAt }),
      ...(input.checkpoint.guardrailDefinitionId === undefined
        ? {}
        : { guardrailDefinitionId: input.checkpoint.guardrailDefinitionId }),
      ...(input.checkpoint.policyPackId === undefined
        ? {}
        : { policyPackId: input.checkpoint.policyPackId }),
    };

    await this.repositories.approvalRequests.save(approvalRequest);

    const updatedSession: RunSession = {
      ...touchRecord(session),
      status: "waiting-human",
      currentApprovalRequestId: approvalRequest.id,
    };
    await this.repositories.runSessions.save(updatedSession);

    await this.appendRunEvent({
      sessionId: session.id,
      type: "approval_requested",
      actor: approvalRequest.requestedBy,
      actorVerification: "authenticated-sdk",
      payload: {
        approvalRequestId: approvalRequest.id,
        checkpointId: approvalRequest.checkpointId,
        reason: approvalRequest.reason,
      },
      ...(session.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: session.traceCorrelation }),
    });
    await this.recordAuditEvent({
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      category: "approval",
      action: "approval.requested",
      actor: approvalRequest.requestedBy,
      actorVerification: "authenticated-sdk",
      payload: {
        approvalRequestId: approvalRequest.id,
        checkpointId: approvalRequest.checkpointId,
      },
    });

    return approvalRequest;
  }

  async resolveApprovalRequest(
    input: ResolveApprovalRequestInput,
  ): Promise<ApprovalRequest> {
    const approvalRequest = await this.ensureApprovalRequestExists(
      input.approvalRequestId,
    );

    if (approvalRequest.status !== "pending") {
      throw new CipControlPlaneError(
        `approval request ${approvalRequest.id} is already ${approvalRequest.status}`,
      );
    }

    const resolved: ApprovalRequest = {
      ...touchRecord(approvalRequest),
      status: input.decision,
      resolvedAt: nowIso(),
      ...(input.resolutionComment === undefined
        ? {}
        : { resolutionComment: input.resolutionComment }),
    };
    await this.repositories.approvalRequests.save(resolved);

    const session = await this.ensureRunSessionExists(approvalRequest.sessionId);
    const nextSessionStatus: RunSessionStatus =
      input.decision === "approved" ? "running" : "failed";
    const { currentApprovalRequestId: _ignoredCurrentApprovalRequestId, ...sessionWithoutApproval } =
      touchRecord(session);
    const updatedSession: RunSession = {
      ...sessionWithoutApproval,
      status: nextSessionStatus,
      ...(nextSessionStatus === "failed"
        ? { completedAt: nowIso() }
        : {}),
    };
    await this.repositories.runSessions.save(updatedSession);

    await this.appendRunEvent({
      sessionId: session.id,
      type: "approval_resolved",
      actor: input.actor ?? { type: "human", id: "operator" },
      actorVerification: "authenticated-operator",
      payload: {
        approvalRequestId: resolved.id,
        decision: resolved.status,
        resolutionComment: resolved.resolutionComment ?? null,
      },
      ...(session.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: session.traceCorrelation }),
    });

    if (input.decision !== "approved") {
      await this.appendRunEvent({
        sessionId: session.id,
        type: "run_failed",
        actor: input.actor ?? { type: "human", id: "operator" },
        actorVerification: "authenticated-operator",
        payload: {
          approvalRequestId: resolved.id,
          decision: resolved.status,
        },
        ...(session.traceCorrelation === undefined
          ? {}
          : { traceCorrelation: session.traceCorrelation }),
      });
      await this.persistEvidenceBundle(updatedSession);
    }

    await this.recordAuditEvent({
      tenantId: updatedSession.tenantId,
      deploymentId: updatedSession.deploymentId,
      sessionId: updatedSession.id,
      category: "approval",
      action: "approval.resolved",
      actor: input.actor ?? { type: "human", id: "operator" },
      actorVerification: "authenticated-operator",
      payload: {
        approvalRequestId: resolved.id,
        decision: resolved.status,
      },
    });

    return resolved;
  }

  async replayRunSession(sessionId: string): Promise<ReplayedRunSession> {
    const session = await this.ensureRunSessionExists(sessionId);
    const runEvents = await this.repositories.runEvents.list({
      sessionId,
    });
    const approvalRequests = await this.repositories.approvalRequests.list({
      sessionId,
    });
    const disclosureRecords = await this.repositories.disclosureRecords.list({
      sessionId,
    });
    const humanReviews = await this.repositories.humanReviewRecords.list({
      sessionId,
    });
    const complianceProfile = await this.getComplianceProfile(session.deploymentId);
    const complianceArtifacts = await this.repositories.complianceArtifacts.list({
      deploymentId: session.deploymentId,
    });
    const [evidenceBundle] = await this.repositories.evidenceBundles.list({
      sessionId,
    });

    let reconstructedStatus: RunSessionStatus = "queued";
    for (const event of runEvents) {
      switch (event.type) {
        case "run_started":
          reconstructedStatus = "running";
          break;
        case "approval_requested":
          reconstructedStatus = "waiting-human";
          break;
        case "approval_resolved":
          reconstructedStatus =
            event.payload["decision"] === "approved" ? "running" : "failed";
          break;
        case "run_completed":
          reconstructedStatus = "completed";
          break;
        case "run_failed":
          reconstructedStatus = "failed";
          break;
        default:
          break;
      }
    }

    return {
      session,
      runEvents,
      approvalRequests,
      disclosureRecords,
      humanReviews,
      complianceProfile,
      complianceArtifactIds: complianceArtifacts.map((artifact) => artifact.id),
      evidenceBundle: evidenceBundle ?? null,
      reconstructedStatus,
    };
  }

  private async recordAuditEvent(input: {
    id?: string;
    tenantId: string;
    deploymentId?: string;
    sessionId?: string;
    category: AuditEvent["category"];
    action: string;
    severity?: AuditEvent["severity"];
    actor: AuditActor;
    assertedActor?: AuditActor;
    actorVerification?: AuditEvent["actorVerification"];
    payload: Record<string, unknown>;
    occurredAt?: string;
  }): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: input.id ?? randomUUID(),
      tenantId: input.tenantId,
      ...(input.deploymentId === undefined
        ? {}
        : { deploymentId: input.deploymentId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      category: input.category,
      action: input.action,
      severity: input.severity ?? "info",
      occurredAt: input.occurredAt ?? nowIso(),
      actor: input.actor,
      ...(input.assertedActor === undefined
        ? {}
        : { assertedActor: input.assertedActor }),
      actorVerification: input.actorVerification ?? "asserted",
      payload: input.payload,
    };

    const saved = await this.repositories.auditEvents.append(event);
    await this.telemetrySink.record({
      name: `audit_event.${saved.action}`,
      occurredAt: saved.occurredAt,
      attributes: {
        tenantId: saved.tenantId,
        deploymentId: saved.deploymentId ?? null,
        sessionId: saved.sessionId ?? null,
        category: saved.category,
      },
    });
    return saved;
  }

  private async ensureTenantExists(tenantId: string): Promise<TenantRecord> {
    const tenant = await this.repositories.tenants.getById(tenantId);

    if (tenant === null) {
      throw new CipControlPlaneError(`unknown tenant: ${tenantId}`);
    }

    return tenant;
  }

  private async ensureConnectorDefinitionExists(
    connectorDefinitionId: string,
  ): Promise<ConnectorDefinition> {
    const connectorDefinition =
      await this.repositories.connectorDefinitions.getById(connectorDefinitionId);

    if (connectorDefinition === null) {
      throw new CipControlPlaneError(
        `unknown connector definition: ${connectorDefinitionId}`,
      );
    }

    return connectorDefinition;
  }

  private async ensureCredentialBindingExists(
    credentialBindingId: string,
  ): Promise<CredentialBinding> {
    const credentialBinding =
      await this.repositories.credentialBindings.getById(credentialBindingId);

    if (credentialBinding === null) {
      throw new CipControlPlaneError(
        `unknown credential binding: ${credentialBindingId}`,
      );
    }

    return credentialBinding;
  }

  private async ensureConnectorBindingExists(
    connectorBindingId: string,
  ): Promise<ConnectorBinding> {
    const connectorBinding =
      await this.repositories.connectorBindings.getById(connectorBindingId);

    if (connectorBinding === null) {
      throw new CipControlPlaneError(
        `unknown connector binding: ${connectorBindingId}`,
      );
    }

    return connectorBinding;
  }

  private async ensurePolicyPackExists(policyPackId: string): Promise<PolicyPack> {
    const policyPack = await this.repositories.policyPacks.getById(policyPackId);

    if (policyPack === null) {
      throw new CipControlPlaneError(`unknown policy pack: ${policyPackId}`);
    }

    return policyPack;
  }

  private async ensureGuardrailDefinitionExists(
    guardrailDefinitionId: string,
  ): Promise<GuardrailDefinition> {
    const guardrailDefinition =
      await this.repositories.guardrailDefinitions.getById(guardrailDefinitionId);

    if (guardrailDefinition === null) {
      throw new CipControlPlaneError(
        `unknown guardrail definition: ${guardrailDefinitionId}`,
      );
    }

    return guardrailDefinition;
  }

  private async ensureAgentBlueprintExists(
    agentBlueprintId: string,
  ): Promise<AgentBlueprint> {
    const agentBlueprint =
      await this.repositories.agentBlueprints.getById(agentBlueprintId);

    if (agentBlueprint === null) {
      throw new CipControlPlaneError(`unknown agent blueprint: ${agentBlueprintId}`);
    }

    return agentBlueprint;
  }

  private async ensureDeploymentExists(
    deploymentId: string,
  ): Promise<DeploymentRecord> {
    const deployment = await this.repositories.deployments.getById(deploymentId);

    if (deployment === null) {
      throw new CipControlPlaneError(`unknown deployment: ${deploymentId}`);
    }

    return deployment;
  }

  private async ensureRunSessionExists(sessionId: string): Promise<RunSession> {
    const session = await this.repositories.runSessions.getById(sessionId);

    if (session === null) {
      throw new CipControlPlaneError(`unknown run session: ${sessionId}`);
    }

    return session;
  }

  private async ensureApprovalRequestExists(
    approvalRequestId: string,
  ): Promise<ApprovalRequest> {
    const approvalRequest =
      await this.repositories.approvalRequests.getById(approvalRequestId);

    if (approvalRequest === null) {
      throw new CipControlPlaneError(
        `unknown approval request: ${approvalRequestId}`,
      );
    }

    return approvalRequest;
  }

  private async ensureDeploymentComplianceReady(
    deploymentId: string,
  ): Promise<void> {
    const profile = await this.getComplianceProfile(deploymentId);
    if (profile === null || profile.riskTier !== "high-risk") {
      return;
    }

    const artifacts = await this.repositories.complianceArtifacts.list({
      deploymentId,
    });

    for (const [kind, requiredStatus] of Object.entries(
      requiredHighRiskArtifactStatuses,
    ) as Array<[ComplianceArtifact["kind"], ComplianceArtifact["status"]]>) {
      if (kind === "serious_incident_record") {
        continue;
      }
      const matches = artifacts.some(
        (artifact) => artifact.kind === kind && artifact.status === requiredStatus,
      );
      if (!matches) {
        throw new CipControlPlaneError(
          `deployment ${deploymentId} is missing required compliance artifact ${kind}:${requiredStatus}`,
        );
      }
    }
  }

  private async ensureSessionCompletionRequirements(
    session: RunSession,
  ): Promise<void> {
    const profile = session.complianceProfileSnapshot;
    if (profile === undefined || profile === null) {
      return;
    }

    if (profile.transparency.required) {
      const disclosures = await this.repositories.disclosureRecords.list({
        sessionId: session.id,
      });
      if (disclosures.length === 0) {
        throw new CipControlPlaneError(
          `session ${session.id} requires disclosure before completion`,
        );
      }
      if (profile.transparency.requiresAcknowledgement) {
        const acknowledged = disclosures.some(
          (record) => record.acknowledgedAt !== undefined,
        );
        if (!acknowledged) {
          throw new CipControlPlaneError(
            `session ${session.id} requires disclosure acknowledgement before completion`,
          );
        }
      }
    }

    if (profile.oversight.requireApprovalBeforeCompletion) {
      const reviews = await this.repositories.humanReviewRecords.list({
        sessionId: session.id,
        decision: "approved",
      });
      if (reviews.length < profile.oversight.minimumHumanReviewers) {
        throw new CipControlPlaneError(
          `session ${session.id} requires ${profile.oversight.minimumHumanReviewers} approved human review(s) before completion`,
        );
      }
    }
  }

  private async persistEvidenceBundle(session: RunSession): Promise<EvidenceBundle> {
    const deployment = await this.ensureDeploymentExists(session.deploymentId);
    const blueprint = await this.ensureAgentBlueprintExists(deployment.agentBlueprintId);
    const runEvents = await this.repositories.runEvents.list({
      sessionId: session.id,
    });
    const auditEvents = await this.repositories.auditEvents.list({
      sessionId: session.id,
    });
    const disclosureRecords = await this.repositories.disclosureRecords.list({
      sessionId: session.id,
    });
    const humanReviews = await this.repositories.humanReviewRecords.list({
      sessionId: session.id,
    });
    const complianceArtifacts = await this.repositories.complianceArtifacts.list({
      deploymentId: session.deploymentId,
    });
    const [existing] = await this.repositories.evidenceBundles.list({
      sessionId: session.id,
    });

    const bundle: EvidenceBundle = {
      ...(existing === undefined ? buildRecordMetadata() : touchRecord(existing)),
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      agentBlueprintId: blueprint.id,
      agentBlueprintVersion: blueprint.version,
      policyPackVersions: blueprint.dependencySnapshot.policyPacks,
      guardrailVersions: blueprint.dependencySnapshot.guardrails,
      summary:
        session.outputSummary ??
        `Evidence bundle for ${blueprint.key}@${blueprint.version}`,
      runEventIds: runEvents.map((event) => event.id),
      auditEventIds: auditEvents.map((event) => event.id),
      complianceProfile: session.complianceProfileSnapshot ?? null,
      disclosureRecordIds: disclosureRecords.map((record) => record.id),
      humanReviewIds: humanReviews.map((review) => review.id),
      complianceArtifactIds: complianceArtifacts.map((artifact) => artifact.id),
      generatedAt: nowIso(),
    };

    return this.repositories.evidenceBundles.save(bundle);
  }
}
