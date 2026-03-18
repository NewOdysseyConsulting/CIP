import type {
  ConnectorHealthcheckResult,
  ConnectorManifest,
  ConnectorStubContext,
  ConnectorToolExecutionResult,
} from "./types.js";

const checkedAt = (): string => new Date().toISOString();

const executeStubTool = async (
  context: ConnectorStubContext,
  toolName: string,
): Promise<ConnectorToolExecutionResult> => {
  const quota = await context.quotaCoordinator.acquire({
    provider: "dynamics365",
    externalSystemTenant: context.externalSystemTenant,
    environment: context.environment,
    apiFamily: "odata",
    maxRequestsPerSecond: 25,
  });

  return {
    status: "not_implemented",
    connectorKey: "dynamics365",
    toolName,
    quota,
    message: `${toolName} is a Dynamics 365 connector stub in phase 1.`,
    data: {
      externalSystemTenant: context.externalSystemTenant,
      tenantId: context.tenantId,
    },
  };
};

export const dynamics365ConnectorManifest: ConnectorManifest = {
  key: "dynamics365",
  version: "1.0.0",
  platform: "dynamics365",
  description: "Dynamics 365 connector stub for CIP phase 1.",
  rateLimitPolicy: {
    maxRequestsPerSecond: 25,
  },
  tools: [
    {
      name: "list_users",
      description: "List users for a Dynamics 365 tenant.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { users: { type: "array" } } },
    },
    {
      name: "get_account",
      description: "Get an account by id.",
      inputSchema: {
        type: "object",
        required: ["accountId"],
        properties: { accountId: { type: "string" } },
      },
      outputSchema: { type: "object", properties: { account: { type: "object" } } },
    },
    {
      name: "list_integrations",
      description: "List configured integrations.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: {
        type: "object",
        properties: { integrations: { type: "array" } },
      },
    },
    {
      name: "list_audit_events",
      description: "List Dynamics 365 audit events.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: {
        type: "object",
        properties: { auditEvents: { type: "array" } },
      },
    },
  ],
};

export const dynamics365ConnectorHealthcheck =
  async (): Promise<ConnectorHealthcheckResult> => ({
    connectorKey: "dynamics365",
    status: "not_implemented",
    checkedAt: checkedAt(),
    details: {
      phase: "stub",
    },
  });

export const dynamics365ConnectorStub = {
  manifest: dynamics365ConnectorManifest,
  healthcheck: dynamics365ConnectorHealthcheck,
  listUsers: (context: ConnectorStubContext) =>
    executeStubTool(context, "list_users"),
  getAccount: (context: ConnectorStubContext) =>
    executeStubTool(context, "get_account"),
  listIntegrations: (context: ConnectorStubContext) =>
    executeStubTool(context, "list_integrations"),
  listAuditEvents: (context: ConnectorStubContext) =>
    executeStubTool(context, "list_audit_events"),
};
