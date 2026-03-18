import { randomUUID } from "node:crypto";

import type {
  AgentBlueprint,
  AuditActor,
  AuditEvent,
  BaseRecord,
  ConnectorBinding,
  ConnectorDefinition,
  CredentialBinding,
  DeploymentRecord,
  Environment,
  PolicyDomain,
  PolicyPack,
  PolicyRule,
  ProductTier,
  RunSession,
  RuntimeProfile,
  TenantRecord,
} from "../domain/records.js";
import type { CipRepositories } from "../repositories/ports.js";

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

export interface RegisterAgentBlueprintInput {
  id?: string;
  key: string;
  name: string;
  productTier: ProductTier;
  domain: PolicyDomain;
  description: string;
  runtime: RuntimeProfile;
  connectorDefinitionIds: string[];
  policyPackIds: string[];
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

export interface StartRunSessionInput {
  id?: string;
  tenantId: string;
  deploymentId: string;
  correlationId?: string;
  inputSummary: string;
}

export interface CompleteRunSessionInput {
  sessionId: string;
  status: Extract<RunSession["status"], "completed" | "failed" | "waiting-human">;
  outputSummary?: string;
}

export class CipControlPlane {
  constructor(private readonly repositories: CipRepositories) {}

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
    const connectorDefinition: ConnectorDefinition = {
      ...buildRecordMetadata(input.id),
      key: input.key,
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
    return policyPack;
  }

  async registerAgentBlueprint(
    input: RegisterAgentBlueprintInput,
  ): Promise<AgentBlueprint> {
    for (const connectorDefinitionId of input.connectorDefinitionIds) {
      await this.ensureConnectorDefinitionExists(connectorDefinitionId);
    }

    for (const policyPackId of input.policyPackIds) {
      await this.ensurePolicyPackExists(policyPackId);
    }

    const agentBlueprint: AgentBlueprint = {
      ...buildRecordMetadata(input.id),
      key: input.key,
      name: input.name,
      productTier: input.productTier,
      domain: input.domain,
      description: input.description,
      runtime: input.runtime,
      connectorDefinitionIds: input.connectorDefinitionIds,
      policyPackIds: input.policyPackIds,
      handoffTargets: input.handoffTargets ?? [],
      ...(input.structuredOutput === undefined
        ? {}
        : { structuredOutput: input.structuredOutput }),
      status: input.status ?? "active",
    };

    return this.repositories.agentBlueprints.save(agentBlueprint);
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
      environment: input.environment,
      connectorBindingIds: input.connectorBindingIds,
      policyPackIds,
      status: input.status ?? "active",
      deployedAt: new Date().toISOString(),
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
        environment: deployment.environment,
      },
    });

    return deployment;
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
      startedAt: new Date().toISOString(),
      inputSummary: input.inputSummary,
    };

    await this.repositories.runSessions.save(session);
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
    const updatedSession: RunSession = {
      ...touchRecord(session),
      status: input.status,
      completedAt: new Date().toISOString(),
      ...(input.outputSummary === undefined
        ? {}
        : { outputSummary: input.outputSummary }),
    };

    await this.repositories.runSessions.save(updatedSession);
    await this.recordAuditEvent({
      tenantId: updatedSession.tenantId,
      deploymentId: updatedSession.deploymentId,
      sessionId: updatedSession.id,
      category: "session",
      action: "session.completed",
      actor: { type: "agent", id: "cip-runtime" },
      payload: { status: updatedSession.status },
    });

    return updatedSession;
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
      occurredAt: new Date().toISOString(),
      actor: input.actor,
      payload: input.payload,
    };

    return this.repositories.auditEvents.append(event);
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
}
