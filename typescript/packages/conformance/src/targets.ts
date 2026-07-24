import { randomUUID } from "node:crypto";

import {
  CipAdminClient,
  CipClient,
  CipControlPlane,
  HttpCipAdminTransport,
  HttpCipControlPlaneTransport,
  LocalCipControlPlaneTransport,
  createInMemoryCipRepositories,
  type DeploymentRecord,
  type TenantRecord,
} from "@new-odyssey/cip";

import type { ConformanceFixture, ConformanceTarget } from "./types.js";

const FIXTURE_RUNTIME = {
  provider: "openai-agents-sdk",
  modelProfile: "default",
} as const;

export const createLocalTarget = (): ConformanceTarget => ({
  name: "in-memory reference implementation",
  setup: async (): Promise<ConformanceFixture> => {
    const repositories = createInMemoryCipRepositories();
    const controlPlane = new CipControlPlane(repositories);
    const suffix = randomUUID().slice(0, 8);

    const tenant = await controlPlane.registerTenant({
      slug: `conformance-${suffix}`,
      displayName: "CIP Conformance Fixture",
      productTier: "pegasus",
      platforms: ["conformance"],
      regions: ["eu-west-2"],
    });

    const policyPack = await controlPlane.publishPolicyPack({
      key: "conformance-baseline",
      name: "Conformance Baseline",
      domain: "platform",
      version: "1.0.0",
      ownership: "shared",
      rules: [],
    });

    const blueprint = await controlPlane.registerAgentBlueprint({
      key: "conformance-agent",
      version: "1.0.0",
      name: "Conformance Agent",
      productTier: "pegasus",
      domain: "platform",
      description: "Fixture agent used by the CIP conformance suite.",
      runtime: FIXTURE_RUNTIME,
      connectorDefinitionIds: [],
      policyPackIds: [policyPack.id],
    });

    const deployment = await controlPlane.deployAgent({
      tenantId: tenant.id,
      agentBlueprintId: blueprint.id,
      environment: "test",
      connectorBindingIds: [],
    });
    const activeDeployment = await controlPlane.transitionDeployment({
      deploymentId: deployment.id,
      targetStatus: "active",
    });

    const client = new CipClient(
      new LocalCipControlPlaneTransport({ controlPlane, repositories }),
    );

    return {
      client,
      tenant,
      deployment: activeDeployment,
      supportsIngestIdempotency: false,
    };
  },
});

export interface HttpTargetConfig {
  baseUrl: string;
  apiKey?: string;
  operatorToken?: string;
  /** Existing tenant/deployment to test against; provisioned when omitted. */
  tenantId?: string;
  deploymentId?: string;
}

export const createHttpTarget = (config: HttpTargetConfig): ConformanceTarget => ({
  name: `hosted platform at ${config.baseUrl}`,
  setup: async (): Promise<ConformanceFixture> => {
    const client = new CipClient(
      new HttpCipControlPlaneTransport({
        baseUrl: config.baseUrl,
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.operatorToken === undefined
          ? {}
          : { operatorToken: config.operatorToken }),
      }),
    );

    let tenant: TenantRecord | null = null;
    let deployment: DeploymentRecord | null = null;

    if (config.tenantId !== undefined && config.deploymentId !== undefined) {
      tenant = await client.getTenant(config.tenantId);
      const deployments = await client.listDeployments(config.tenantId);
      deployment =
        deployments.find((record) => record.id === config.deploymentId) ?? null;
    } else {
      if (config.operatorToken === undefined) {
        throw new Error(
          "an operator token is required to provision a conformance fixture over HTTP",
        );
      }
      const admin = new CipAdminClient(
        new HttpCipAdminTransport({
          baseUrl: config.baseUrl,
          operatorToken: config.operatorToken,
        }),
      );
      const suffix = randomUUID().slice(0, 8);
      tenant = await admin.createTenant({
        slug: `conformance-${suffix}`,
        displayName: "CIP Conformance Fixture",
        productTier: "pegasus",
        platforms: ["conformance"],
        regions: ["eu-west-2"],
      });
      const policyPack = await admin.publishPolicyPack({
        key: `conformance-baseline-${suffix}`,
        name: "Conformance Baseline",
        domain: "platform",
        version: "1.0.0",
        ownership: "shared",
        rules: [],
      });
      const blueprint = await admin.registerAgentBlueprint({
        key: `conformance-agent-${suffix}`,
        version: "1.0.0",
        name: "Conformance Agent",
        productTier: "pegasus",
        domain: "platform",
        description: "Fixture agent used by the CIP conformance suite.",
        runtime: FIXTURE_RUNTIME,
        connectorDefinitionIds: [],
        policyPackIds: [policyPack.id],
      });
      deployment = await admin.createDeployment({
        tenantId: tenant.id,
        agentBlueprintId: blueprint.id,
        environment: "test",
        connectorBindingIds: [],
      });
      deployment = await client.transitionDeployment({
        deploymentId: deployment.id,
        targetStatus: "active",
      });
    }

    if (tenant === null || deployment === null) {
      throw new Error("could not resolve a tenant and deployment for the fixture");
    }

    return {
      client,
      tenant,
      deployment,
      supportsIngestIdempotency: true,
    };
  },
});
