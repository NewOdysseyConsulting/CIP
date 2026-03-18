import test from "node:test";
import assert from "node:assert/strict";

import {
  CipControlPlane,
  CipControlPlaneError,
  createCipControlPlaneAgent,
  createInMemoryCipRepositories,
} from "../src/index.js";

test("CIP control plane supports the core Workday deployment lifecycle", async () => {
  const repositories = createInMemoryCipRepositories();
  const controlPlane = new CipControlPlane(repositories);

  const tenant = await controlPlane.registerTenant({
    slug: "acme-workday-security",
    displayName: "Acme Workday Security",
    productTier: "pantheon",
    platforms: ["workday"],
    regions: ["eu-west-2"],
  });

  const connectorDefinition = await controlPlane.registerConnectorDefinition({
    key: "workday-mcp",
    platform: "workday",
    displayName: "Workday MCP Server",
    runtime: "mcp",
    authStrategy: "service-account",
    source: "first-party",
    capabilities: ["security-groups", "signon-activity", "worker-data"],
  });

  const credentialBinding = await controlPlane.createCredentialBinding({
    tenantId: tenant.id,
    name: "acme-workday-prod",
    provider: "aws-secrets-manager",
    secretRef: "arn:aws:secretsmanager:eu-west-2:123456789012:secret:workday-prod",
    scopes: ["tenant:prod", "workday:security"],
  });

  const connectorBinding = await controlPlane.createConnectorBinding({
    tenantId: tenant.id,
    connectorDefinitionId: connectorDefinition.id,
    credentialBindingId: credentialBinding.id,
    environment: "production",
    alias: "workday-prod",
    endpoint: "https://acme.workday.com/ccx/service/customreport2",
    config: { tenantAlias: "acme_prod" },
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
        expression: "isu.scope <= observed.scope",
        severity: "high",
        action: "flag",
      },
    ],
    guardrailRefs: ["pii-boundary", "sox-audit"],
  });

  const agentBlueprint = await controlPlane.registerAgentBlueprint({
    key: "security-diagnostic-agent",
    name: "Security Diagnostic Agent",
    productTier: "pantheon",
    domain: "security",
    description:
      "Natural-language troubleshooting for Workday security and access issues.",
    runtime: {
      provider: "openai-agents-sdk",
      modelProfile: "reasoning",
    },
    connectorDefinitionIds: [connectorDefinition.id],
    policyPackIds: [policyPack.id],
    handoffTargets: ["tenant-drift-detection-agent"],
  });

  const deployment = await controlPlane.deployAgent({
    tenantId: tenant.id,
    agentBlueprintId: agentBlueprint.id,
    environment: "production",
    connectorBindingIds: [connectorBinding.id],
    tags: ["workday", "security"],
  });

  const session = await controlPlane.startRunSession({
    tenantId: tenant.id,
    deploymentId: deployment.id,
    inputSummary: "Why can't Maria run the Year-End Tax Report?",
  });

  const completedSession = await controlPlane.completeRunSession({
    sessionId: session.id,
    status: "completed",
    outputSummary: "Maria is missing the report domain security group.",
  });

  assert.equal(deployment.status, "active");
  assert.equal(completedSession.status, "completed");
  assert.equal(completedSession.revision, 2);

  const auditEvents = await repositories.auditEvents.list({ sessionId: session.id });

  assert.deepEqual(
    auditEvents.map((event) => event.action),
    ["session.started", "session.completed"],
  );
});

test("deployAgent rejects deployments that do not satisfy blueprint connector requirements", async () => {
  const repositories = createInMemoryCipRepositories();
  const controlPlane = new CipControlPlane(repositories);

  const tenant = await controlPlane.registerTenant({
    slug: "acme-governance",
    displayName: "Acme Governance",
    productTier: "pantheon",
    platforms: ["workday"],
    regions: ["eu-west-2"],
  });

  const connectorDefinition = await controlPlane.registerConnectorDefinition({
    key: "workday-mcp",
    platform: "workday",
    displayName: "Workday MCP Server",
    runtime: "mcp",
    authStrategy: "service-account",
    source: "first-party",
    capabilities: ["security-groups"],
  });

  const policyPack = await controlPlane.publishPolicyPack({
    key: "security-baseline",
    name: "Security Baseline",
    domain: "security",
    version: "1.0.0",
    ownership: "shared",
    rules: [],
  });

  const blueprint = await controlPlane.registerAgentBlueprint({
    key: "tenant-drift-agent",
    name: "Tenant Drift Agent",
    productTier: "pantheon",
    domain: "security",
    description: "Detects security drift across Workday tenants.",
    runtime: {
      provider: "openai-agents-sdk",
      modelProfile: "default",
    },
    connectorDefinitionIds: [connectorDefinition.id],
    policyPackIds: [policyPack.id],
  });

  await assert.rejects(
    () =>
      controlPlane.deployAgent({
        tenantId: tenant.id,
        agentBlueprintId: blueprint.id,
        environment: "production",
        connectorBindingIds: [],
      }),
    (error: unknown) =>
      error instanceof CipControlPlaneError &&
      error.message ===
        `missing required connector bindings for blueprint ${blueprint.key}`,
  );
});

test("createCipControlPlaneAgent builds an OpenAI Agents SDK agent around CIP repositories", async () => {
  const repositories = createInMemoryCipRepositories();
  const controlPlane = new CipControlPlane(repositories);

  await controlPlane.registerTenant({
    slug: "agent-ready-tenant",
    displayName: "Agent Ready Tenant",
    productTier: "pantheon",
    platforms: ["workday"],
    regions: ["eu-west-2"],
  });

  const agent = createCipControlPlaneAgent({ repositories });

  assert.equal(agent.name, "CIP Control Plane Assistant");
  assert.equal(agent.tools.length, 3);
});
