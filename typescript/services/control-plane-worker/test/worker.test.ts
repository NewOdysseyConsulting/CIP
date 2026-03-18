import assert from "node:assert/strict";
import test from "node:test";

import {
  CipControlPlane,
  createDefaultGuardrailCatalog,
  createInMemoryCipRepositories,
  workdayConnectorManifest,
} from "@new-odyssey/cip";
import {
  createInMemoryControlPlaneServiceStore,
  createQueuedIngestJob,
  processNextIngestJob,
} from "@new-odyssey/cip-control-plane-api";

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const buildWorkerFixture = async () => {
  const repositories = createInMemoryCipRepositories();
  const controlPlane = new CipControlPlane(repositories);
  const serviceStore = createInMemoryControlPlaneServiceStore();

  const tenant = await controlPlane.registerTenant({
    slug: "worker-fixture",
    displayName: "Worker Fixture",
    productTier: "pantheon",
    platforms: ["workday"],
    regions: ["eu-west-2"],
  });

  const connector = await controlPlane.registerConnectorDefinition({
    key: workdayConnectorManifest.key,
    version: workdayConnectorManifest.version,
    platform: workdayConnectorManifest.platform,
    displayName: "Workday MCP Server",
    runtime: "mcp",
    authStrategy: "service-account",
    source: "first-party",
    capabilities: workdayConnectorManifest.tools.map((tool) => tool.name),
  });

  const credential = await controlPlane.createCredentialBinding({
    tenantId: tenant.id,
    name: "workday-prod",
    provider: "aws-secrets-manager",
    secretRef: "arn:aws:secretsmanager:eu-west-2:123:secret:worker",
    scopes: ["tenant:prod"],
  });

  const binding = await controlPlane.createConnectorBinding({
    tenantId: tenant.id,
    connectorDefinitionId: connector.id,
    credentialBindingId: credential.id,
    environment: "production",
    alias: "workday-prod",
    endpoint: "https://example.workday.com",
  });

  const [guardrailTemplate] = createDefaultGuardrailCatalog();
  assert.ok(guardrailTemplate);
  const guardrail = await controlPlane.publishGuardrailDefinition({
    key: guardrailTemplate.key,
    version: guardrailTemplate.version,
    name: guardrailTemplate.name,
    configuration: guardrailTemplate.configuration,
  });

  const policy = await controlPlane.publishPolicyPack({
    key: "worker-policy",
    name: "Worker Policy",
    domain: "security",
    version: "1.0.0",
    ownership: "shared",
    rules: [],
    guardrailRefs: [guardrail.id],
  });

  const blueprint = await controlPlane.registerAgentBlueprint({
    key: "worker-blueprint",
    version: "1.0.0",
    name: "Worker Blueprint",
    productTier: "pantheon",
    domain: "security",
    description: "Worker queue test.",
    runtime: {
      provider: "openai-agents-sdk",
      modelProfile: "fast",
    },
    connectorDefinitionIds: [connector.id],
    policyPackIds: [policy.id],
    guardrailDefinitionIds: [guardrail.id],
  });

  const deployment = await controlPlane.deployAgent({
    tenantId: tenant.id,
    agentBlueprintId: blueprint.id,
    environment: "production",
    connectorBindingIds: [binding.id],
  });
  const activeDeployment = await controlPlane.transitionDeployment({
    deploymentId: deployment.id,
    targetStatus: "active",
  });

  const session = await controlPlane.startRunSession({
    tenantId: tenant.id,
    deploymentId: activeDeployment.id,
    inputSummary: "Process a queued event",
  });

  return { controlPlane, serviceStore, tenant, session };
};

test("worker processes queued ingest jobs into run events", async () => {
  const fixture = await buildWorkerFixture();
  const job = createQueuedIngestJob(fixture.tenant.id, fixture.session.id, {
    tenantId: fixture.tenant.id,
    sessionId: fixture.session.id,
    events: [
      {
        kind: "run_event",
        type: "tool_called",
        actor: { type: "agent", id: "worker" },
        payload: { tool: "list_security_groups" },
      },
    ],
  });
  await fixture.serviceStore.ingestJobs.enqueue(job);

  const processed = await processNextIngestJob({
    controlPlane: fixture.controlPlane,
    serviceStore: fixture.serviceStore,
  });

  assert.equal(processed?.outcome, "processed");
  const replay = await fixture.controlPlane.replayRunSession(fixture.session.id);
  assert.deepEqual(
    replay.runEvents.map((event) => event.type),
    ["run_started", "tool_called"],
  );
});

test("worker retries do not duplicate already persisted events", async () => {
  const fixture = await buildWorkerFixture();
  const originalAppendRunEvent = fixture.controlPlane.appendRunEvent.bind(
    fixture.controlPlane,
  );
  let shouldFailSecondEvent = true;

  fixture.controlPlane.appendRunEvent = (async (input) => {
    if (input.type === "tool_completed" && shouldFailSecondEvent) {
      shouldFailSecondEvent = false;
      throw new Error("simulated mid-batch failure");
    }
    return originalAppendRunEvent(input);
  }) as typeof fixture.controlPlane.appendRunEvent;

  const job = createQueuedIngestJob(fixture.tenant.id, fixture.session.id, {
    tenantId: fixture.tenant.id,
    sessionId: fixture.session.id,
    events: [
      {
        kind: "run_event",
        type: "tool_called",
        actor: { type: "agent", id: "worker" },
        payload: { tool: "list_security_groups" },
      },
      {
        kind: "run_event",
        type: "tool_completed",
        actor: { type: "agent", id: "worker" },
        payload: { tool: "list_security_groups" },
      },
    ],
  });
  await fixture.serviceStore.ingestJobs.enqueue(job);

  const firstAttempt = await processNextIngestJob({
    controlPlane: fixture.controlPlane,
    serviceStore: fixture.serviceStore,
    maxAttempts: 3,
  });
  assert.equal(firstAttempt?.outcome, "retried");

  await sleep(2100);

  const secondAttempt = await processNextIngestJob({
    controlPlane: fixture.controlPlane,
    serviceStore: fixture.serviceStore,
    maxAttempts: 3,
  });
  assert.equal(secondAttempt?.outcome, "processed");

  const replay = await fixture.controlPlane.replayRunSession(fixture.session.id);
  assert.deepEqual(
    replay.runEvents.map((event) => event.type),
    ["run_started", "tool_called", "tool_completed"],
  );
});
