import assert from "node:assert/strict";
import test from "node:test";

import {
  AwsSecretsManagerSecretBackend,
  CipControlPlane,
  CipControlPlaneError,
  CipAdminClient,
  CipAuthError,
  DeterministicPolicyEvaluator,
  EnvironmentSecretResolver,
  HttpCipAdminTransport,
  HttpJsonConnectorBackend,
  InMemoryTelemetrySink,
  OpenAIAgentsRuntimeAdapter,
  RepositoryConnectorQuotaCoordinator,
  SecretBackendRegistry,
  StubVaultResolver,
  ConnectorBackendRegistry,
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

test("compliance profiles gate high-risk activation and disclosure requirements", async () => {
  const fixture = await createWorkdaySecurityFixture();

  await fixture.controlPlane.transitionDeployment({
    deploymentId: fixture.deployment.id,
    targetStatus: "paused",
  });

  await fixture.controlPlane.upsertComplianceProfile({
    deploymentId: fixture.deployment.id,
    regime: "eu-ai-act",
    servesEuUsers: true,
    intendedPurpose: "Employment screening assistant",
    riskTier: "high-risk",
    transparency: {
      required: true,
      noticeText: "You are interacting with an AI assistant.",
      placement: "banner-and-first-message",
      requiresAcknowledgement: true,
    },
    oversight: {
      required: true,
      requireApprovalBeforeCompletion: true,
      minimumHumanReviewers: 1,
      stopMechanismRequired: true,
    },
    logging: {
      requireVerifiedActors: true,
      retentionDays: 180,
    },
  });

  await assert.rejects(
    fixture.controlPlane.transitionDeployment({
      deploymentId: fixture.deployment.id,
      targetStatus: "active",
    }),
    /missing required compliance artifact/,
  );

  for (const [kind, status] of [
    ["technical_documentation", "approved"],
    ["fundamental_rights_impact_assessment", "approved"],
    ["conformity_assessment", "approved"],
    ["eu_declaration_of_conformity", "filed"],
    ["eu_database_registration", "filed"],
    ["post_market_monitoring_plan", "approved"],
  ] as const) {
    await fixture.controlPlane.createComplianceArtifact({
      deploymentId: fixture.deployment.id,
      kind,
      status,
      owner: "legal",
      summary: `${kind} ready`,
    });
  }

  const reactivated = await fixture.controlPlane.transitionDeployment({
    deploymentId: fixture.deployment.id,
    targetStatus: "active",
  });
  assert.equal(reactivated.status, "active");

  const session = await fixture.controlPlane.startRunSession({
    tenantId: fixture.tenant.id,
    deploymentId: fixture.deployment.id,
    inputSummary: "Should we advance this candidate?",
  });

  await assert.rejects(
    fixture.controlPlane.completeRunSession({
      sessionId: session.id,
      status: "completed",
      outputSummary: "Advance candidate.",
    }),
    /requires disclosure before completion/,
  );

  await fixture.controlPlane.recordDisclosure({
    sessionId: session.id,
    disclosureVersion: "v1",
    surface: "banner_and_first_message",
    presentedAt: new Date().toISOString(),
    acknowledgedAt: new Date().toISOString(),
  });

  await assert.rejects(
    fixture.controlPlane.completeRunSession({
      sessionId: session.id,
      status: "completed",
      outputSummary: "Advance candidate.",
    }),
    /approved human review/,
  );

  await assert.rejects(
    fixture.controlPlane.recordHumanReview({
      sessionId: session.id,
      decision: "approved",
      reviewedAt: new Date().toISOString(),
      reviewerId: "spoofed-reviewer",
    }),
    /verified human reviewer actor/,
  );

  await fixture.controlPlane.recordHumanReview({
    sessionId: session.id,
    decision: "approved",
    reviewedAt: new Date().toISOString(),
    actor: { type: "human", id: "operator-1" },
  });

  const completed = await fixture.controlPlane.completeRunSession({
    sessionId: session.id,
    status: "completed",
    outputSummary: "Advance candidate.",
  });
  const evidence = await fixture.controlPlane.getEvidenceBundle(session.id);

  assert.equal(completed.status, "completed");
  assert.equal(evidence?.disclosureRecordIds.length, 1);
  assert.equal(evidence?.humanReviewIds.length, 1);
  assert.equal(evidence?.complianceArtifactIds.length, 6);
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

test("HTTP admin transport and extension backends work through the public SDK surface", async () => {
  const transport = new HttpCipAdminTransport({
    baseUrl: "https://cip.example.com",
    operatorToken: "operator-token",
    fetchImpl: async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString(),
      );
      if (url.pathname === "/v1/admin/tenants" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            id: "tenant-1",
            slug: "bootstrap-acme",
            displayName: "Bootstrap Acme",
            productTier: "pantheon",
            platforms: ["workday"],
            regions: ["eu-west-2"],
            status: "active",
            createdAt: "2026-03-19T09:00:00.000Z",
            updatedAt: "2026-03-19T09:00:00.000Z",
            revision: 1,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.pathname === "/v1/admin/dead-letter-jobs" && init?.method === undefined) {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const adminClient = new CipAdminClient(transport);

  const createdTenant = await adminClient.createTenant({
    slug: "bootstrap-acme",
    displayName: "Bootstrap Acme",
    productTier: "pantheon",
    platforms: ["workday"],
    regions: ["eu-west-2"],
  });
  const deadLetterJobs = await adminClient.listDeadLetterJobs();

  assert.equal(createdTenant.slug, "bootstrap-acme");
  assert.equal(deadLetterJobs.length, 0);
  await assert.rejects(
    () => adminClient.listTenants(),
    (error: unknown) => error instanceof CipAuthError,
  );

  const repositories = createInMemoryCipRepositories();
  const quotaCoordinator = new RepositoryConnectorQuotaCoordinator(
    repositories.connectorRateBuckets,
  );
  const connectorBackend = new HttpJsonConnectorBackend(async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString(),
    );
    if (url.pathname === "/health") {
      return new Response("", { status: 200 });
    }
    return new Response(JSON.stringify({ userId: "123", enabled: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const connectorRegistry = new ConnectorBackendRegistry([connectorBackend]);
  assert.equal(connectorRegistry.get("http-json"), connectorBackend);

  const manifest = {
    key: "generic-http",
    version: "1.0.0",
    platform: "custom",
    description: "Generic HTTP JSON connector",
    tools: [],
    rateLimitPolicy: { maxRequestsPerSecond: 5 },
  };
  const healthcheck = await connectorBackend.healthcheck(manifest, {
    tenantId: "tenant-1",
    externalSystemTenant: "external-tenant-1",
    environment: "production",
    quotaCoordinator,
    endpoint: "https://connector.example.com/health",
  });
  const invocation = await connectorBackend.invoke(
    manifest,
    {
      toolName: "get_user",
      method: "GET",
      path: "/users/{userId}",
      inputSchema: {},
      outputSchema: {},
    },
    {
      tenantId: "tenant-1",
      externalSystemTenant: "external-tenant-1",
      environment: "production",
      quotaCoordinator,
      endpoint: "https://connector.example.com",
      headers: { authorization: "Bearer test" },
    },
    { userId: "123" },
  );

  assert.equal(healthcheck.status, "ready");
  assert.equal(invocation.status, "ok");
  assert.equal(
    (invocation.data as { response: { enabled: boolean } }).response.enabled,
    true,
  );

  let awsRequests = 0;
  const awsBackend = new AwsSecretsManagerSecretBackend({
    client: {
      send: async () => {
        awsRequests += 1;
        return {
          SecretString: "resolved-aws-secret",
          ARN: "arn:aws:secretsmanager:eu-west-2:123456789012:secret:cip",
          VersionId: "1",
        };
      },
    } as never,
    cacheTtlMs: 60_000,
  });
  const secretRegistry = new SecretBackendRegistry([awsBackend]);

  const firstSecret = await secretRegistry.resolve(
    "aws-secrets-manager",
    {
      provider: "aws-secrets-manager",
      ref: "cip/bootstrap",
    },
    {
      accessPolicy: {
        allowedProviders: ["aws-secrets-manager"],
        requiredScopes: [],
      },
    },
  );
  const secondSecret = await secretRegistry.resolve(
    "aws-secrets-manager",
    {
      provider: "aws-secrets-manager",
      ref: "cip/bootstrap",
    },
  );

  assert.equal(firstSecret.value, "resolved-aws-secret");
  assert.equal(secondSecret.value, "resolved-aws-secret");
  assert.equal(awsRequests, 1);
});
