import { randomUUID } from "node:crypto";

import type {
  AgentBlueprint,
  ApprovalRequest,
  AuditActor,
  AuditEvent,
  BaseRecord,
  BlueprintDependencySnapshot,
  ConnectorBinding,
  ConnectorDefinition,
  CredentialBinding,
  DeploymentRecord,
  DeploymentStatus,
  Environment,
  EvidenceBundle,
  GuardrailDefinition,
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
  sessionId: string;
  type: RunEvent["type"];
  actor?: AuditActor;
  payload?: Record<string, unknown>;
  traceCorrelation?: TraceCorrelation;
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
      payload: {
        from: deployment.status,
        to: input.targetStatus,
        reason: input.reason ?? null,
      },
    });

    return updated;
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

    const session: RunSession = {
      ...buildRecordMetadata(input.id),
      tenantId: input.tenantId,
      deploymentId: input.deploymentId,
      correlationId: input.correlationId ?? randomUUID(),
      status: "running",
      startedAt: nowIso(),
      inputSummary: input.inputSummary,
      ...(input.traceCorrelation === undefined
        ? {}
        : { traceCorrelation: input.traceCorrelation }),
    };

    await this.repositories.runSessions.save(session);
    await this.appendRunEvent({
      sessionId: session.id,
      type: "run_started",
      actor: { type: "agent", id: "cip-runtime" },
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
      payload: {
        deploymentId: deployment.id,
        correlationId: session.correlationId,
      },
    });

    return session;
  }

  async completeRunSession(input: CompleteRunSessionInput): Promise<RunSession> {
    const session = await this.ensureRunSessionExists(input.sessionId);
    if (session.status === "completed" || session.status === "failed") {
      throw new CipControlPlaneError(`session ${session.id} is already terminal`);
    }
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
      payload: { status: updatedSession.status },
    });

    await this.persistEvidenceBundle(updatedSession);

    return updatedSession;
  }

  async appendRunEvent(input: AppendRunEventInput): Promise<RunEvent> {
    const session = await this.ensureRunSessionExists(input.sessionId);
    const priorEvents = await this.repositories.runEvents.list({
      sessionId: session.id,
    });
    const event: RunEvent = {
      ...buildRecordMetadata(),
      tenantId: session.tenantId,
      deploymentId: session.deploymentId,
      sessionId: session.id,
      type: input.type,
      sequence: priorEvents.length + 1,
      occurredAt: nowIso(),
      actor: input.actor ?? { type: "agent", id: "cip-runtime" },
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
      evidenceBundle: evidenceBundle ?? null,
      reconstructedStatus,
    };
  }

  private async recordAuditEvent(input: {
    tenantId: string;
    deploymentId?: string;
    sessionId?: string;
    category: AuditEvent["category"];
    action: string;
    severity?: AuditEvent["severity"];
    actor: AuditActor;
    payload: Record<string, unknown>;
  }): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: randomUUID(),
      tenantId: input.tenantId,
      ...(input.deploymentId === undefined
        ? {}
        : { deploymentId: input.deploymentId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      category: input.category,
      action: input.action,
      severity: input.severity ?? "info",
      occurredAt: nowIso(),
      actor: input.actor,
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

  private async persistEvidenceBundle(session: RunSession): Promise<EvidenceBundle> {
    const deployment = await this.ensureDeploymentExists(session.deploymentId);
    const blueprint = await this.ensureAgentBlueprintExists(deployment.agentBlueprintId);
    const runEvents = await this.repositories.runEvents.list({
      sessionId: session.id,
    });
    const auditEvents = await this.repositories.auditEvents.list({
      sessionId: session.id,
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
      generatedAt: nowIso(),
    };

    return this.repositories.evidenceBundles.save(bundle);
  }
}
