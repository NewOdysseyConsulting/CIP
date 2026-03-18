import { Agent, tool } from "@openai/agents";
import { z } from "zod";

import type { CipRepositories } from "../repositories/ports.js";

export interface CreateCipControlPlaneAgentOptions {
  repositories: CipRepositories;
  name?: string;
  instructions?: string;
}

const environmentSchema = z
  .enum(["development", "test", "sandbox", "production"])
  .optional();

const defaultInstructions = [
  "You are the CIP control-plane assistant for New Odyssey.",
  "Use the available tools to inspect tenants, deployments, and policy packs.",
  "Explain operational state clearly and do not invent repository records.",
].join(" ");

export const createCipControlPlaneAgent = ({
  repositories,
  name = "CIP Control Plane Assistant",
  instructions = defaultInstructions,
}: CreateCipControlPlaneAgentOptions): Agent => {
  const getTenantTool = tool({
    name: "get_tenant",
    description: "Fetch a CIP tenant by id.",
    parameters: z.object({
      tenantId: z.string().min(1),
    }),
    execute: async ({ tenantId }) => {
      const tenant = await repositories.tenants.getById(tenantId);

      return tenant ?? { found: false, tenantId };
    },
  });

  const listDeploymentsTool = tool({
    name: "list_deployments",
    description: "List CIP deployments for a tenant and optional environment.",
    parameters: z.object({
      tenantId: z.string().min(1),
      environment: environmentSchema,
    }),
    execute: async ({ tenantId, environment }) =>
      repositories.deployments.list({
        tenantId,
        ...(environment === undefined ? {} : { environment }),
      }),
  });

  const listPolicyPacksTool = tool({
    name: "list_policy_packs",
    description: "List active policy packs for a policy domain.",
    parameters: z.object({
      domain: z.enum([
        "platform",
        "security",
        "expense",
        "recruitment",
        "onboarding",
      ]),
    }),
    execute: async ({ domain }) =>
      repositories.policyPacks.list({
        domain,
        status: "active",
      }),
  });

  return new Agent({
    name,
    instructions,
    tools: [getTenantTool, listDeploymentsTool, listPolicyPacksTool],
  });
};
