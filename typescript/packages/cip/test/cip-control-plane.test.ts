import assert from "node:assert/strict";
import test from "node:test";

import {
  CipControlPlane,
  CipControlPlaneError,
  DeterministicPolicyEvaluator,
  EnvironmentSecretResolver,
  InMemoryTelemetrySink,
  OpenAIAgentsRuntimeAdapter,
  RepositoryConnectorQuotaCoordinator,
  StubVaultResolver,
  createAdminApiHandlers,
  createCipControlPlaneAgent,
  createDefaultGuardrailCatalog,
  createInMemoryCipRepositories,
  dynamics365ConnectorManifest,
  workdayConnectorManifest,
  workdayConnectorStub,
} from "../src/index.js";

const createWorkdaySecurityFixture = async () => {
  const repositories = createInMemoryCipRepositories();
  const telemetry = new InMemoryTelemetrySink();
  const controlPlane = new CipControlPlane(repositories, {
    telemetrySink: telemetry,
  });

  const tenant = await controlPlane.registerTenant({
    slug: "acme-workday-security",
    displayName: "Acme Workday Security",
    productTier: "pantheon",
    platforms: ["workday"],
    regions: ["eu-west-2"],
  });

  const workdayConnector = await controlPlane.registerConnectorDefinition({
    key: workdayConnectorManifest.key,
    version: workdayConnectorManifest.version,
    platform: workdayConnectorManifest.platform,
    displayName: "Workday MCP Server",
    runtime: "mcp",
    authStrategy: "service-account",
    source: "first-party",
    capabilities: workdayConnectorManifest.tools.map((tool) => tool.name),
  });

  const dynamicsConnector = await controlPlane.registerConnectorDefinition({
    key: dynamics365ConnectorManifest.key,
    version: dynamics365ConnectorManifest.version,
    platform: dynamics365ConnectorManifest.platform,
    displayName: "Dynamics 365 MCP Server",
    runtime: "mcp",
    authStrategy: "oauth2",
    source: "partner",
    capabilities: dynamics365ConnectorManifest.tools.map((tool) => tool.name),
  });

  const credentialBinding = await controlPlane.createCredentialBinding({
    tenantId: tenant.id,
    name: "acme-workday-prod",
    provider: "aws-secrets-manager",
    secretRef:
      "arn:aws:secretsmanager:eu-west-2:123456789012:secret:workday-prod",
    scopes: ["tenant:prod", "workday:security"],
  });

  const connectorBinding = await controlPlane.createConnectorBinding({
    tenantId: tenant.id,
    connectorDefinitionId: workdayConnector.id,
    credentialBindingId: credentialBinding.id,
    environment: "production",
    alias: "workday-prod",
    endpoint: "https://acme.workday.com/ccx/service/customreport2",
    config: { tenantAlias: "acme_prod" },
  });

  const [defaultGuardrail] = createDefaultGuardrailCatalog();
  assert.ok(defaultGuardrail);
  const guardrail = await controlPlane.publishGuardrailDefinition({
    key: defaultGuardrail.key,
    version: defaultGuardrail.version,
    name: defaultGuardrail.name,
    configuration: defaultGuardrail.configuration,
  });

  const policyPack = await controlPlane.publishPolicyPack({
    key: "workday-security-baseline",
    name: "Workday Security Baseline",
    domain: "security",
    version: "1.0.0",
    ownership: "shared",
    rules: [
      {
        id: "least-privilege",
        name: "Least Privilege",
        clauses: [
          {
            id: "scope-delta",
            name: "scope-delta",
            match: "all",
            conditions: [
              {
                path: "permissions.delta",
                operator: "gt",
                value: 0,
              },
            ],
          },
        ],
        severity: "high",
        action: "flag",
      },
    ],
    guardrailRefs: [guardrail.id],
  });

  const blueprintV1 = await controlPlane.registerAgentBlueprint({
    key: "security-diagnostic-agent",
    version: "1.0.0",
    name: "Security Diagnostic Agent",
    productTier: "pantheon",
    domain: "security",
    description:
      "Natural-language troubleshooting for Workday security and access issues.",
    runtime: {
      provider: "openai-agents-sdk",
      modelProfile: "reasoning",
      adapterVersion: "0.7.2",
    },
    connectorDefinitionIds: [workdayConnector.id],
    policyPackIds: [policyPack.id],
    guardrailDefinitionIds: [guardrail.id],
    handoffTargets: ["tenant-drift-detection-agent"],
  });

  const deployment = await controlPlane.deployAgent({
    tenantId: tenant.id,
    agentBlueprintId: blueprintV1.id,
    environment: "production",
    connectorBindingIds: [connectorBinding.id],
    tags: ["workday", "security"],
  });

  const activeDeployment = await controlPlane.transitionDeployment({
    deploymentId: deployment.id,
    targetStatus: "active",
  });

  return {
    repositories,
    telemetry,
    controlPlane,
    tenant,
    workdayConnector,
    dynamicsConnector,
    credentialBinding,
    connectorBinding,
    guardrail,
    policyPack,
    blueprintV1,
    deployment: activeDeployment,
  };
};

test("CIP control plane persists immutable blueprint versions and evidence bundles", async () => {
  const fixture = await createWorkdaySecurityFixture();

  const session = await fixture.controlPlane.startRunSession({
    tenantId: fixture.tenant.id,
    deploymentId: fixture.deployment.id,
    inputSummary: "Why can't Maria run the Year-End Tax Report?",
    traceCorrelation: {
      provider: "openai",
      traceId: "trace-123",
      spanId: "span-123",
    },
  });

  await fixture.controlPlane.appendRunEvent({
    sessionId: session.id,
    type: "tool_called",
    payload: { tool: "list_security_groups" },
  });

  const completedSession = await fixture.controlPlane.completeRunSession({
    sessionId: session.id,
    status: "completed",
    outputSummary: "Maria is missing the report domain security group.",
  });

  const replay = await fixture.controlPlane.replayRunSession(session.id);
  const auditEvents = await fixture.repositories.auditEvents.list({
    sessionId: session.id,
  });

  assert.equal(fixture.deployment.status, "active");
  assert.equal(completedSession.status, "completed");
  assert.equal(fixture.blueprintV1.dependencySnapshot.policyPacks[0]?.version, "1.0.0");
  assert.deepEqual(
    replay.runEvents.map((event) => event.type),
    ["run_started", "tool_called", "run_completed"],
  );
  assert.equal(replay.reconstructedStatus, "completed");
  assert.equal(replay.evidenceBundle?.agentBlueprintVersion, "1.0.0");
  assert.deepEqual(
    auditEvents.map((event) => event.action),
    ["session.started", "session.completed"],
  );
  assert.ok(
    fixture.telemetry.events.some((event) => event.name === "run_event.run_completed"),
  );
});

test("deployment transitions enforce the state machine and support blueprint rollback", async () => {
  const fixture = await createWorkdaySecurityFixture();

  const blueprintV2 = await fixture.controlPlane.registerAgentBlueprint({
    key: "security-diagnostic-agent",
    version: "1.1.0",
    name: "Security Diagnostic Agent",
    productTier: "pantheon",
    domain: "security",
    description: "Updated release for deployment rollback tests.",
    runtime: {
      provider: "openai-agents-sdk",
      modelProfile: "reasoning",
      adapterVersion: "0.7.2",
    },
    connectorDefinitionIds: [fixture.workdayConnector.id],
    policyPackIds: [fixture.policyPack.id],
    guardrailDefinitionIds: [fixture.guardrail.id],
    supersedesBlueprintId: fixture.blueprintV1.id,
  });

  const redeployed = await fixture.controlPlane.rollbackDeploymentToBlueprint({
    deploymentId: fixture.deployment.id,
    targetBlueprintId: blueprintV2.id,
  });

  const paused = await fixture.controlPlane.transitionDeployment({
    deploymentId: redeployed.id,
    targetStatus: "paused",
  });

  const resumed = await fixture.controlPlane.transitionDeployment({
    deploymentId: paused.id,
    targetStatus: "active",
  });

  const rolledBack = await fixture.controlPlane.rollbackDeploymentToBlueprint({
    deploymentId: resumed.id,
    targetBlueprintId: fixture.blueprintV1.id,
  });

  assert.equal(redeployed.agentBlueprintVersion, "1.1.0");
  assert.equal(rolledBack.agentBlueprintVersion, "1.0.0");

  await assert.rejects(
    () =>
      fixture.controlPlane.transitionDeployment({
        deploymentId: resumed.id,
        targetStatus: "provisioning",
      }),
    (error: unknown) =>
      error instanceof CipControlPlaneError &&
      error.message === "invalid deployment transition: active -> provisioning",
  );
});

test("human approval requests pause runs and rejected approvals fail the session", async () => {
  const fixture = await createWorkdaySecurityFixture();

  const session = await fixture.controlPlane.startRunSession({
    tenantId: fixture.tenant.id,
    deploymentId: fixture.deployment.id,
    inputSummary: "Approve cross-tenant access evidence export.",
  });

  const approvalRequest = await fixture.controlPlane.requestHumanApproval({
    sessionId: session.id,
    checkpoint: {
      checkpointId: "export-evidence",
      reason: "Evidence export crosses a compliance boundary.",
      guardrailDefinitionId: fixture.guardrail.id,
      policyPackId: fixture.policyPack.id,
    },
  });

  const resolved = await fixture.controlPlane.resolveApprovalRequest({
    approvalRequestId: approvalRequest.id,
    decision: "rejected",
    resolutionComment: "Operator rejected export until manual review completes.",
  });

  const replay = await fixture.controlPlane.replayRunSession(session.id);

  assert.equal(resolved.status, "rejected");
  assert.equal(replay.session.status, "failed");
  assert.deepEqual(
    replay.runEvents.map((event) => event.type),
    [
      "run_started",
      "approval_requested",
      "approval_resolved",
      "run_failed",
    ],
  );
  assert.equal(replay.evidenceBundle?.guardrailVersions[0]?.version, "1.0.0");
});

test("policy evaluation, admin stubs, secrets, and runtime adapters behave deterministically", async () => {
  const fixture = await createWorkdaySecurityFixture();
  const evaluator = new DeterministicPolicyEvaluator();
  const handlers = createAdminApiHandlers(
    fixture.controlPlane,
    fixture.repositories,
    evaluator,
  );
  const runtime = new OpenAIAgentsRuntimeAdapter();

  process.env.CIP_LOCAL_SECRET = "super-secret-value";
  const envResolver = new EnvironmentSecretResolver();
  const stubResolver = new StubVaultResolver({
    "aws:test/secret": "stubbed-secret",
  });

  const evaluation = evaluator.evaluate(
    fixture.policyPack,
    {
      tenantId: fixture.tenant.id,
      deploymentId: fixture.deployment.id,
      facts: {
        permissions: { delta: 2 },
        tenant: { allowed: true },
      },
    },
    [fixture.guardrail],
  );

  const healthcheck = await handlers.postConnectorHealthcheck("workday");
  const policyResult = await handlers.evaluatePolicy(fixture.policyPack.id, {
    tenantId: fixture.tenant.id,
    facts: {
      permissions: { delta: 2 },
      tenant: { allowed: true },
    },
  });

  const runResult = await runtime.run({
    agent: {
      name: "Phase 1 Runtime",
      instructions: "Operate safely.",
      runtimeProfile: {
        provider: "openai-agents-sdk",
        modelProfile: "default",
      },
      tools: [],
      guardrails: [],
    },
    input: "Export evidence bundle",
    session: runtime.createSessionHandle("session-1", {
      responseId: "resp_123",
    }),
    approvalCheckpoints: [
      runtime.createApprovalCheckpoint({
        checkpointId: "manual-review",
        reason: "Human approval is required.",
      }),
    ],
  });

  const envSecret = await envResolver.resolve(
    { provider: "env", ref: "cip_local_secret" },
    { allowedProviders: ["env"], requiredScopes: [] },
  );
  const stubSecret = await stubResolver.resolve({
    provider: "aws",
    ref: "test/secret",
  });

  assert.equal(evaluation.action, "flag");
  assert.equal(evaluation.triggeredGuardrailIds[0], fixture.guardrail.id);
  assert.equal(healthcheck.status, 200);
  assert.equal(policyResult.status, 200);
  assert.equal(runResult.status, "waiting-human");
  assert.equal(envSecret.value, "super-secret-value");
  assert.equal(stubSecret.value, "stubbed-secret");
  assert.equal(fixture.credentialBinding.secretRef.includes("secret"), true);
});

test("connector stubs coordinate shared tenant quotas and assistant tools remain available", async () => {
  const repositories = createInMemoryCipRepositories();
  const quotaCoordinator = new RepositoryConnectorQuotaCoordinator(
    repositories.connectorRateBuckets,
  );

  const results = await Promise.all(
    Array.from({ length: 11 }, () =>
      workdayConnectorStub.listSecurityGroups({
        tenantId: "tenant-1",
        externalSystemTenant: "workday-acme-prod",
        environment: "production",
        quotaCoordinator,
      }),
    ),
  );

  assert.equal(results.filter((result) => result.quota.granted).length, 10);
  assert.equal(results.filter((result) => !result.quota.granted).length, 1);

  const agent = createCipControlPlaneAgent({ repositories });
  assert.equal(agent.name, "CIP Control Plane Assistant");
  assert.equal(agent.tools.length, 3);
});
