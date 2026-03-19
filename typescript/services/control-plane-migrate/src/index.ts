import fs from "node:fs/promises";

import {
  CipControlPlane,
  createPostgresCipRepositories,
  type CreateConnectorBindingInput,
  type CreateCredentialBindingInput,
  type DeployAgentInput,
  type PublishGuardrailDefinitionInput,
  type PublishPolicyPackInput,
  type RegisterAgentBlueprintInput,
  type RegisterConnectorDefinitionInput,
  type RegisterTenantInput,
} from "@new-odyssey/cip";
import {
  createPostgresControlPlaneServiceStore,
  issueApiKey,
  revokeApiKey,
  runControlPlaneMigrations,
} from "@new-odyssey/cip-control-plane-api";
import { Pool } from "pg";

const databaseUrl = process.env.CIP_DATABASE_URL;

if (databaseUrl === undefined) {
  throw new Error("CIP_DATABASE_URL must be configured");
}

const pool = new Pool({
  connectionString: databaseUrl,
});

const repositories = createPostgresCipRepositories(pool);
const controlPlane = new CipControlPlane(repositories);
const serviceStore = createPostgresControlPlaneServiceStore(pool);

const readJsonInput = async <T>(pathArg?: string): Promise<T> => {
  if (pathArg === undefined) {
    throw new Error("--json <path|-> is required");
  }
  const payload =
    pathArg === "-"
      ? await new Promise<string>((resolve, reject) => {
          let body = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => {
            body += chunk;
          });
          process.stdin.on("end", () => resolve(body));
          process.stdin.on("error", reject);
        })
      : await fs.readFile(pathArg, "utf8");
  return JSON.parse(payload) as T;
};

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const print = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const migrate = async () => {
  await runControlPlaneMigrations(pool);
  print({ ok: true, command: "migrate" });
};

const seedTenant = async () => {
  const input = await readJsonInput<RegisterTenantInput>(argValue("--json"));
  const tenant = await controlPlane.registerTenant(input);
  print(tenant);
};

const issueSdkApiKey = async () => {
  const input = await readJsonInput<{
    tenantId: string;
    name: string;
    scopes: Array<
      | "sessions:read"
      | "sessions:write"
      | "approvals:write"
      | "approvals:resolve"
      | "deployments:read"
      | "deployments:write"
      | "tenants:read"
      | "audit:read"
    >;
    expiresAt?: string;
    description?: string;
  }>(argValue("--json"));
  const issued = await issueApiKey(serviceStore, input);
  print(issued);
};

const revokeSdkApiKey = async () => {
  const apiKeyId = argValue("--api-key-id");
  if (apiKeyId === undefined) {
    throw new Error("--api-key-id is required");
  }
  const revoked = await revokeApiKey(serviceStore, { apiKeyId });
  print(revoked);
};

const publishBootstrapResources = async () => {
  const input = await readJsonInput<{
    connectorDefinitions?: RegisterConnectorDefinitionInput[];
    credentialBindings?: CreateCredentialBindingInput[];
    connectorBindings?: CreateConnectorBindingInput[];
    guardrailDefinitions?: PublishGuardrailDefinitionInput[];
    policyPacks?: PublishPolicyPackInput[];
    agentBlueprints?: RegisterAgentBlueprintInput[];
    deployments?: DeployAgentInput[];
  }>(argValue("--json"));

  const result = {
    connectorDefinitions: [] as unknown[],
    credentialBindings: [] as unknown[],
    connectorBindings: [] as unknown[],
    guardrailDefinitions: [] as unknown[],
    policyPacks: [] as unknown[],
    agentBlueprints: [] as unknown[],
    deployments: [] as unknown[],
  };

  for (const item of input.connectorDefinitions ?? []) {
    result.connectorDefinitions.push(
      await controlPlane.registerConnectorDefinition(item),
    );
  }
  for (const item of input.credentialBindings ?? []) {
    result.credentialBindings.push(
      await controlPlane.createCredentialBinding(item),
    );
  }
  for (const item of input.connectorBindings ?? []) {
    result.connectorBindings.push(
      await controlPlane.createConnectorBinding(item),
    );
  }
  for (const item of input.guardrailDefinitions ?? []) {
    result.guardrailDefinitions.push(
      await controlPlane.publishGuardrailDefinition(item),
    );
  }
  for (const item of input.policyPacks ?? []) {
    result.policyPacks.push(await controlPlane.publishPolicyPack(item));
  }
  for (const item of input.agentBlueprints ?? []) {
    result.agentBlueprints.push(
      await controlPlane.registerAgentBlueprint(item),
    );
  }
  for (const item of input.deployments ?? []) {
    result.deployments.push(await controlPlane.deployAgent(item));
  }

  print(result);
};

const command = process.argv[2] ?? "migrate";

try {
  if (command === "migrate") {
    await migrate();
  } else if (command === "seed-tenant") {
    await seedTenant();
  } else if (command === "issue-api-key") {
    await issueSdkApiKey();
  } else if (command === "revoke-api-key") {
    await revokeSdkApiKey();
  } else if (command === "publish-bootstrap-resources") {
    await publishBootstrapResources();
  } else {
    throw new Error(`unknown command ${command}`);
  }
} finally {
  await pool.end();
}
