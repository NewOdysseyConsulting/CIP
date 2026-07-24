import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

import {
  CipControlPlane,
  InMemoryTelemetrySink,
  createInMemoryCipRepositories,
  dynamics365ConnectorManifest,
  workdayConnectorManifest,
} from "@new-odyssey/cip";
import { createDefaultGuardrailCatalog } from "@new-odyssey/remus";

import { createControlPlaneApiApp } from "../src/app.js";
import { signOperatorToken } from "../src/auth.js";
import {
  createQueuedIngestJob,
  createInMemoryControlPlaneServiceStore,
  issueApiKey,
} from "../src/store.js";
import { processNextIngestJob } from "../src/worker.js";

const operatorAuth = {
  sharedSecret: "test-operator-secret",
  issuer: "cip-tests",
  audience: "cip-operators",
} as const;

const parseJson = <T>(payload: string): T => JSON.parse(payload) as T;

const buildFixture = async () => {
  const repositories = createInMemoryCipRepositories();
  const telemetry = new InMemoryTelemetrySink();
  const controlPlane = new CipControlPlane(repositories, {
    telemetrySink: telemetry,
  });
  const serviceStore = createInMemoryControlPlaneServiceStore();
  const app = createControlPlaneApiApp({
    controlPlane,
    repositories,
    serviceStore,
    operatorAuth,
  });

  const tenant = await controlPlane.registerTenant({
    slug: "acme-sdk-control-plane",
    displayName: "Acme SDK Control Plane",
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

  await controlPlane.registerConnectorDefinition({
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
    secretRef: "arn:aws:secretsmanager:eu-west-2:123456789012:secret:cip",
    scopes: ["tenant:prod", "workday:security"],
  });

  const connectorBinding = await controlPlane.createConnectorBinding({
    tenantId: tenant.id,
    connectorDefinitionId: workdayConnector.id,
    credentialBindingId: credentialBinding.id,
    environment: "production",
    alias: "workday-prod",
    endpoint: "https://acme.workday.com",
    config: { tenantAlias: "acme" },
  });

  const [guardrailTemplate] = createDefaultGuardrailCatalog();
  assert.ok(guardrailTemplate);
  const guardrail = await controlPlane.publishGuardrailDefinition({
    key: guardrailTemplate.key,
    version: guardrailTemplate.version,
    name: guardrailTemplate.name,
    configuration: guardrailTemplate.configuration,
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
        severity: "high",
        action: "flag",
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
      },
    ],
    guardrailRefs: [guardrail.id],
  });

  const blueprint = await controlPlane.registerAgentBlueprint({
    key: "security-diagnostic-agent",
    version: "1.0.0",
    name: "Security Diagnostic Agent",
    productTier: "pantheon",
    domain: "security",
    description: "Remote API test blueprint.",
    runtime: {
      provider: "openai-agents-sdk",
      modelProfile: "reasoning",
      adapterVersion: "0.7.2",
    },
    connectorDefinitionIds: [workdayConnector.id],
    policyPackIds: [policyPack.id],
    guardrailDefinitionIds: [guardrail.id],
  });

  const deployment = await controlPlane.deployAgent({
    tenantId: tenant.id,
    agentBlueprintId: blueprint.id,
    environment: "production",
    connectorBindingIds: [connectorBinding.id],
    tags: ["sdk", "control-plane"],
  });

  const activeDeployment = await controlPlane.transitionDeployment({
    deploymentId: deployment.id,
    targetStatus: "active",
  });

  const issuedApiKey = await issueApiKey(serviceStore, {
    tenantId: tenant.id,
    name: "SDK test key",
    scopes: ["sessions:read", "sessions:write", "approvals:write"],
  });

  const operatorToken = await signOperatorToken(
    { sub: "operator-1", scope: "control-plane:admin" },
    operatorAuth,
  );

  return {
    app,
    controlPlane,
    repositories,
    serviceStore,
    tenant,
    deployment: activeDeployment,
    apiKeyRecord: issuedApiKey.record,
    apiKey: issuedApiKey.plainTextKey,
    operatorToken,
  };
};

const buildEmptyFixture = async () => {
  const repositories = createInMemoryCipRepositories();
  const telemetry = new InMemoryTelemetrySink();
  const controlPlane = new CipControlPlane(repositories, {
    telemetrySink: telemetry,
  });
  const serviceStore = createInMemoryControlPlaneServiceStore();
  const app = createControlPlaneApiApp({
    controlPlane,
    repositories,
    serviceStore,
    operatorAuth,
  });

  const operatorToken = await signOperatorToken(
    { sub: "operator-bootstrap", scope: "control-plane:admin" },
    operatorAuth,
  );

  return {
    app,
    controlPlane,
    repositories,
    serviceStore,
    operatorToken,
  };
};

test("control-plane API supports remote tracked sessions and queued event ingestion", async () => {
  const fixture = await buildFixture();

  const createResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-create-1",
    },
    payload: {
      tenantId: fixture.tenant.id,
      deploymentId: fixture.deployment.id,
      inputSummary: "Why can't Maria run the Year-End Tax Report?",
    },
  });
  assert.equal(createResponse.statusCode, 200);
  const session = parseJson<{ id: string } & Record<string, unknown>>(createResponse.body);

  const enqueueResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}/events:enqueue`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-events-1",
    },
    payload: {
      tenantId: fixture.tenant.id,
      sessionId: session.id,
      events: [
        {
          kind: "run_event",
          type: "tool_called",
          actor: { type: "human", id: "spoofed-operator" },
          payload: { tool: "list_security_groups" },
        },
      ],
    },
  });
  assert.equal(enqueueResponse.statusCode, 202);

  const processed = await processNextIngestJob({
    controlPlane: fixture.controlPlane,
    serviceStore: fixture.serviceStore,
  });
  assert.equal(processed?.outcome, "processed");

  const completeResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}:complete`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-complete-1",
    },
    payload: {
      sessionId: session.id,
      status: "completed",
      outputSummary: "Maria is missing the report domain security group.",
    },
  });
  assert.equal(completeResponse.statusCode, 200);

  const replayResponse = await fixture.app.inject({
    method: "GET",
    url: `/v1/sessions/${session.id}/replay`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
    },
  });
  assert.equal(replayResponse.statusCode, 200);
  const replay = parseJson<{
    runEvents: Array<{
      type: string;
      actor: { id: string; type: string };
      assertedActor?: { id: string; type: string };
      actorVerification: string;
      payload: Record<string, unknown>;
    }>;
    reconstructedStatus: string;
  }>(replayResponse.body);
  assert.deepEqual(
    replay.runEvents.map((event) => event.type),
    ["run_started", "tool_called", "run_completed"],
  );
  assert.equal(replay.runEvents[1]?.actor.id, `api-key:${fixture.apiKeyRecord.id}`);
  assert.deepEqual(replay.runEvents[1]?.assertedActor, {
    type: "human",
    id: "spoofed-operator",
  });
  assert.equal(replay.runEvents[1]?.actorVerification, "authenticated-sdk");
  assert.equal(replay.reconstructedStatus, "completed");

  const evidenceResponse = await fixture.app.inject({
    method: "GET",
    url: `/v1/evidence-bundles/${session.id}`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
    },
  });
  assert.equal(evidenceResponse.statusCode, 200);
  const evidence = parseJson<{ agentBlueprintVersion: string }>(evidenceResponse.body);
  assert.equal(evidence.agentBlueprintVersion, "1.0.0");

  await fixture.app.close();
});

test("compliance profile and disclosure routes enforce completion requirements", async () => {
  const fixture = await buildFixture();

  const profileResponse = await fixture.app.inject({
    method: "PUT",
    url: `/v1/admin/deployments/${fixture.deployment.id}/compliance-profile`,
    headers: {
      authorization: `Bearer ${fixture.operatorToken}`,
    },
    payload: {
      deploymentId: fixture.deployment.id,
      regime: "eu-ai-act",
      servesEuUsers: true,
      intendedPurpose: "Customer support chatbot",
      riskTier: "limited",
      transparency: {
        required: true,
        noticeText: "You are interacting with an AI assistant.",
        placement: "banner-and-first-message",
        requiresAcknowledgement: false,
      },
      oversight: {
        required: false,
        requireApprovalBeforeCompletion: false,
        minimumHumanReviewers: 0,
        stopMechanismRequired: false,
      },
      logging: {
        requireVerifiedActors: true,
        retentionDays: 90,
      },
    },
  });
  assert.equal(profileResponse.statusCode, 200);

  const createResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-create-compliance-1",
    },
    payload: {
      tenantId: fixture.tenant.id,
      deploymentId: fixture.deployment.id,
      inputSummary: "Help me reset my password.",
    },
  });
  assert.equal(createResponse.statusCode, 200);
  const session = parseJson<{ id: string }>(createResponse.body);

  const preDisclosureComplete = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}:complete`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-complete-compliance-1",
    },
    payload: {
      sessionId: session.id,
      status: "completed",
      outputSummary: "Reset your password from the profile page.",
    },
  });
  assert.equal(preDisclosureComplete.statusCode, 400);

  const runtimeProfileResponse = await fixture.app.inject({
    method: "GET",
    url: `/v1/deployments/${fixture.deployment.id}/compliance-profile`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
    },
  });
  assert.equal(runtimeProfileResponse.statusCode, 200);

  const disclosureResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}:record-disclosure`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
    },
    payload: {
      sessionId: session.id,
      disclosureVersion: "v1",
      surface: "banner_and_first_message",
      presentedAt: new Date().toISOString(),
    },
  });
  assert.equal(disclosureResponse.statusCode, 200);

  const completeResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}:complete`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "session-complete-compliance-2",
    },
    payload: {
      sessionId: session.id,
      status: "completed",
      outputSummary: "Reset your password from the profile page.",
    },
  });
  assert.equal(completeResponse.statusCode, 200);

  await fixture.app.close();
});

test("control-plane API enforces idempotency and tenant-scoped SDK auth", async () => {
  const fixture = await buildFixture();

  const payload = {
    tenantId: fixture.tenant.id,
    deploymentId: fixture.deployment.id,
    inputSummary: "Run a deterministic replay.",
  };

  const first = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "idempotent-session-1",
    },
    payload,
  });
  const second = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "idempotent-session-1",
    },
    payload,
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(
    parseJson<{ id: string }>(first.body).id,
    parseJson<{ id: string }>(second.body).id,
  );

  const wrongTenant = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "wrong-tenant-1",
    },
    payload: {
      ...payload,
      tenantId: "tenant-other",
    },
  });

  assert.equal(wrongTenant.statusCode, 403);
  await fixture.app.close();
});

test("operator routes require operator auth and allow deployment state transitions", async () => {
  const fixture = await buildFixture();

  const unauthorized = await fixture.app.inject({
    method: "GET",
    url: "/v1/deployments",
  });
  assert.equal(unauthorized.statusCode, 401);

  const deployments = await fixture.app.inject({
    method: "GET",
    url: `/v1/deployments?tenantId=${fixture.tenant.id}`,
    headers: {
      authorization: `Bearer ${fixture.operatorToken}`,
    },
  });
  assert.equal(deployments.statusCode, 200);
  assert.equal(parseJson<Array<{ id: string }>>(deployments.body).length, 1);

  const paused = await fixture.app.inject({
    method: "POST",
    url: `/v1/deployments/${fixture.deployment.id}:transition`,
    headers: {
      authorization: `Bearer ${fixture.operatorToken}`,
    },
    payload: {
      deploymentId: fixture.deployment.id,
      targetStatus: "paused",
    },
  });
  assert.equal(paused.statusCode, 200);
  assert.equal(parseJson<{ status: string }>(paused.body).status, "paused");

  await fixture.app.close();
});

test("operator scopes and tenant restrictions are enforced", async () => {
  const fixture = await buildFixture();
  const scopedToken = await signOperatorToken(
    {
      sub: "operator-tenant",
      scope: "deployments:read",
      tenantId: fixture.tenant.id,
    },
    operatorAuth,
  );

  const deployments = await fixture.app.inject({
    method: "GET",
    url: "/v1/deployments",
    headers: {
      authorization: `Bearer ${scopedToken}`,
    },
  });
  assert.equal(deployments.statusCode, 200);
  assert.equal(parseJson<Array<{ id: string }>>(deployments.body).length, 1);

  const deniedWrite = await fixture.app.inject({
    method: "POST",
    url: `/v1/deployments/${fixture.deployment.id}:transition`,
    headers: {
      authorization: `Bearer ${scopedToken}`,
    },
    payload: {
      deploymentId: fixture.deployment.id,
      targetStatus: "paused",
    },
  });
  assert.equal(deniedWrite.statusCode, 403);

  const deniedTenant = await fixture.app.inject({
    method: "GET",
    url: "/v1/tenants/tenant-other",
    headers: {
      authorization: `Bearer ${scopedToken}`,
    },
  });
  assert.equal(deniedTenant.statusCode, 403);

  await fixture.app.close();
});

test("invalid request payloads are rejected with 400", async () => {
  const fixture = await buildFixture();

  const invalidSession = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "invalid-session-1",
    },
    payload: {
      deploymentId: fixture.deployment.id,
      inputSummary: "missing tenant id",
    },
  });
  assert.equal(invalidSession.statusCode, 400);

  const session = await fixture.controlPlane.startRunSession({
    tenantId: fixture.tenant.id,
    deploymentId: fixture.deployment.id,
    inputSummary: "validation test session",
  });

  const invalidBatch = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}/events:enqueue`,
    headers: {
      authorization: `Bearer ${fixture.apiKey}`,
      "Idempotency-Key": "invalid-batch-1",
    },
    payload: {
      tenantId: fixture.tenant.id,
      sessionId: session.id,
      events: [],
    },
  });
  assert.equal(invalidBatch.statusCode, 400);

  await fixture.app.close();
});

test("admin bootstrap APIs create managed resources, issue keys, and requeue dead-letter jobs", async () => {
  const fixture = await buildEmptyFixture();
  const headers = {
    authorization: `Bearer ${fixture.operatorToken}`,
  };

  const tenantResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/tenants",
    headers,
    payload: {
      slug: "bootstrap-acme",
      displayName: "Bootstrap Acme",
      productTier: "pantheon",
      platforms: ["workday"],
      regions: ["eu-west-2"],
    },
  });
  assert.equal(tenantResponse.statusCode, 200);
  const tenant = parseJson<{ id: string } & Record<string, unknown>>(tenantResponse.body);

  const connectorDefinitionResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/connector-definitions",
    headers,
    payload: {
      key: workdayConnectorManifest.key,
      version: workdayConnectorManifest.version,
      platform: workdayConnectorManifest.platform,
      displayName: "Workday MCP Server",
      driverKey: "http-json",
      runtime: "mcp",
      authStrategy: "service-account",
      source: "first-party",
      capabilities: workdayConnectorManifest.tools.map((tool) => tool.name),
    },
  });
  assert.equal(connectorDefinitionResponse.statusCode, 200);
  const connectorDefinition = parseJson<{ id: string }>(connectorDefinitionResponse.body);

  const credentialResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/credential-bindings",
    headers,
    payload: {
      tenantId: tenant.id,
      name: "bootstrap-workday-prod",
      provider: "aws-secrets-manager",
      secretBackendKey: "aws-secrets-manager",
      secretRef: "arn:aws:secretsmanager:eu-west-2:123456789012:secret:bootstrap",
      scopes: ["tenant:prod"],
    },
  });
  assert.equal(credentialResponse.statusCode, 200);
  const credential = parseJson<{ id: string }>(credentialResponse.body);

  const connectorBindingResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/connector-bindings",
    headers,
    payload: {
      tenantId: tenant.id,
      connectorDefinitionId: connectorDefinition.id,
      credentialBindingId: credential.id,
      environment: "production",
      alias: "workday-prod",
      endpoint: "https://acme.workday.com",
      config: { tenantAlias: "bootstrap" },
    },
  });
  assert.equal(connectorBindingResponse.statusCode, 200);
  const connectorBinding = parseJson<{ id: string }>(connectorBindingResponse.body);

  const [guardrailTemplate] = createDefaultGuardrailCatalog();
  assert.ok(guardrailTemplate);
  const guardrailResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/guardrail-definitions",
    headers,
    payload: {
      key: guardrailTemplate.key,
      version: guardrailTemplate.version,
      name: guardrailTemplate.name,
      configuration: guardrailTemplate.configuration,
    },
  });
  assert.equal(guardrailResponse.statusCode, 200);
  const guardrail = parseJson<{ id: string }>(guardrailResponse.body);

  const policyResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/policy-packs",
    headers,
    payload: {
      key: "bootstrap-policy",
      name: "Bootstrap Policy",
      domain: "security",
      version: "1.0.0",
      ownership: "shared",
      rules: [
        {
          id: "least-privilege",
          name: "Least Privilege",
          severity: "high",
          action: "flag",
          clauses: [
            {
              id: "scope-delta",
              name: "scope-delta",
              match: "all",
              conditions: [{ path: "permissions.delta", operator: "gt", value: 0 }],
            },
          ],
        },
      ],
      guardrailRefs: [guardrail.id],
    },
  });
  assert.equal(policyResponse.statusCode, 200);
  const policyPack = parseJson<{ id: string }>(policyResponse.body);

  const blueprintResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/agent-blueprints",
    headers,
    payload: {
      key: "bootstrap-agent",
      version: "1.0.0",
      name: "Bootstrap Agent",
      productTier: "pantheon",
      domain: "security",
      description: "Bootstrap flow test agent.",
      runtime: {
        provider: "openai-agents-sdk",
        modelProfile: "reasoning",
      },
      connectorDefinitionIds: [connectorDefinition.id],
      policyPackIds: [policyPack.id],
      guardrailDefinitionIds: [guardrail.id],
    },
  });
  assert.equal(blueprintResponse.statusCode, 200);
  const blueprint = parseJson<{ id: string }>(blueprintResponse.body);

  const deploymentResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/deployments",
    headers,
    payload: {
      tenantId: tenant.id,
      agentBlueprintId: blueprint.id,
      environment: "production",
      connectorBindingIds: [connectorBinding.id],
      tags: ["bootstrap"],
    },
  });
  assert.equal(deploymentResponse.statusCode, 200);
  const deployment = parseJson<{ id: string }>(deploymentResponse.body);

  const activeDeploymentResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/deployments/${deployment.id}:transition`,
    headers,
    payload: {
      deploymentId: deployment.id,
      targetStatus: "active",
    },
  });
  assert.equal(activeDeploymentResponse.statusCode, 200);
  const activeDeployment = parseJson<{ id: string } & Record<string, unknown>>(activeDeploymentResponse.body);

  const apiKeyResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/api-keys",
    headers,
    payload: {
      tenantId: tenant.id,
      name: "bootstrap sdk key",
      scopes: ["sessions:read", "sessions:write", "approvals:write"],
      description: "bootstrap test key",
    },
  });
  assert.equal(apiKeyResponse.statusCode, 200);
  const issuedApiKey = parseJson<{
    record: { id: string; status: string };
    plainTextKey: string;
  }>(apiKeyResponse.body);

  const sessionResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      authorization: `Bearer ${issuedApiKey.plainTextKey}`,
      "Idempotency-Key": "bootstrap-session-create",
    },
    payload: {
      tenantId: tenant.id,
      deploymentId: activeDeployment.id,
      inputSummary: "Bootstrap runtime session.",
    },
  });
  assert.equal(sessionResponse.statusCode, 200);
  const session = parseJson<{ id: string }>(sessionResponse.body);

  const enqueueResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}/events:enqueue`,
    headers: {
      authorization: `Bearer ${issuedApiKey.plainTextKey}`,
      "Idempotency-Key": "bootstrap-session-events",
    },
    payload: {
      tenantId: tenant.id,
      sessionId: session.id,
      events: [
        {
          kind: "run_event",
          type: "tool_called",
          payload: { tool: "list_security_groups" },
        },
      ],
    },
  });
  assert.equal(enqueueResponse.statusCode, 202);
  const ingestReceipt = parseJson<{ ingestJobId: string }>(enqueueResponse.body);

  const sdkJobView = await fixture.app.inject({
    method: "GET",
    url: `/v1/ingest-jobs/${ingestReceipt.ingestJobId}`,
    headers: {
      authorization: `Bearer ${issuedApiKey.plainTextKey}`,
    },
  });
  assert.equal(sdkJobView.statusCode, 200);
  assert.equal(parseJson<{ id: string }>(sdkJobView.body).id, ingestReceipt.ingestJobId);

  const operatorJobView = await fixture.app.inject({
    method: "GET",
    url: `/v1/ingest-jobs/${ingestReceipt.ingestJobId}`,
    headers,
  });
  assert.equal(operatorJobView.statusCode, 200);

  const rotatedResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/admin/api-keys/${issuedApiKey.record.id}:rotate`,
    headers,
    payload: {
      apiKeyId: issuedApiKey.record.id,
      name: "rotated bootstrap key",
    },
  });
  assert.equal(rotatedResponse.statusCode, 200);
  const rotated = parseJson<{
    record: { id: string; rotatedFromApiKeyId?: string };
    plainTextKey: string;
  }>(rotatedResponse.body);
  assert.equal(rotated.record.rotatedFromApiKeyId, issuedApiKey.record.id);

  const revokedOldKey = await fixture.app.inject({
    method: "GET",
    url: `/v1/admin/api-keys/${issuedApiKey.record.id}`,
    headers,
  });
  assert.equal(revokedOldKey.statusCode, 200);
  assert.equal(parseJson<{ status: string }>(revokedOldKey.body).status, "revoked");

  const deadLetterSeed = createQueuedIngestJob(tenant.id, session.id, {
    tenantId: tenant.id,
    sessionId: session.id,
    events: [],
  });
  await fixture.serviceStore.ingestJobs.enqueue(deadLetterSeed);
  await fixture.serviceStore.ingestJobs.moveToDeadLetter(deadLetterSeed.id, "simulated failure");

  const deadLetterList = await fixture.app.inject({
    method: "GET",
    url: "/v1/admin/dead-letter-jobs",
    headers,
  });
  assert.equal(deadLetterList.statusCode, 200);
  const deadLetterJobs = parseJson<Array<{ id: string }>>(deadLetterList.body);
  assert.equal(deadLetterJobs.length, 1);

  const requeueResponse = await fixture.app.inject({
    method: "POST",
    url: `/v1/admin/dead-letter-jobs/${deadLetterJobs[0]?.id}:requeue`,
    headers,
    payload: {
      deadLetterJobId: deadLetterJobs[0]?.id,
    },
  });
  assert.equal(requeueResponse.statusCode, 200);
  assert.equal(parseJson<{ status: string }>(requeueResponse.body).status, "queued");

  const cleanupResponse = await fixture.app.inject({
    method: "POST",
    url: "/v1/admin/retention/cleanup",
    headers,
    payload: {
      cutoff: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  assert.equal(cleanupResponse.statusCode, 200);
  const cleanup = parseJson<{ idempotencyDeleted: number }>(cleanupResponse.body);
  assert.ok(cleanup.idempotencyDeleted >= 0);

  await fixture.app.close();
});

test("published OpenAPI spec covers the hosted runtime and admin routes", async () => {
  const schemaPath = path.resolve(
    process.cwd(),
    "../../..",
    "schemas",
    "cip-admin-api.openapi.json",
  );
  const spec = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    info: { version: string };
    paths: Record<string, unknown>;
  };

  const requiredPaths = [
    "/metrics",
    "/v1/ingest-jobs/{jobId}",
    "/v1/deployments/{deploymentId}/compliance-profile",
    "/v1/sessions/{sessionId}:record-disclosure",
    "/v1/sessions/{sessionId}:record-human-review",
    "/v1/admin/tenants",
    "/v1/admin/connector-definitions",
    "/v1/admin/credential-bindings",
    "/v1/admin/connector-bindings",
    "/v1/admin/policy-packs",
    "/v1/admin/guardrail-definitions",
    "/v1/admin/agent-blueprints",
    "/v1/admin/deployments",
    "/v1/admin/deployments/{deploymentId}/compliance-profile",
    "/v1/admin/deployments/{deploymentId}/compliance-artifacts",
    "/v1/admin/api-keys",
    "/v1/admin/dead-letter-jobs",
    "/v1/admin/retention/cleanup",
  ];

  assert.equal(spec.info.version, "0.2.0-alpha.0");
  for (const requiredPath of requiredPaths) {
    assert.ok(spec.paths[requiredPath], `missing OpenAPI path ${requiredPath}`);
  }
});
