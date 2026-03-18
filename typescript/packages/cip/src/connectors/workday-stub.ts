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
    provider: "workday",
    externalSystemTenant: context.externalSystemTenant,
    environment: context.environment,
    apiFamily: "rest",
    maxRequestsPerSecond: 10,
  });

  return {
    status: "not_implemented",
    connectorKey: "workday",
    toolName,
    quota,
    message: `${toolName} is a Workday connector stub in phase 1.`,
    data: {
      externalSystemTenant: context.externalSystemTenant,
      tenantId: context.tenantId,
    },
  };
};

export const workdayConnectorManifest: ConnectorManifest = {
  key: "workday",
  version: "1.0.0",
  platform: "workday",
  description: "Workday connector stub for CIP phase 1.",
  rateLimitPolicy: {
    maxRequestsPerSecond: 10,
  },
  tools: [
    {
      name: "list_security_groups",
      description: "List security groups for a Workday tenant.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { groups: { type: "array" } } },
    },
    {
      name: "get_worker",
      description: "Get worker details by worker id.",
      inputSchema: {
        type: "object",
        required: ["workerId"],
        properties: { workerId: { type: "string" } },
      },
      outputSchema: { type: "object", properties: { worker: { type: "object" } } },
    },
    {
      name: "list_signon_activity",
      description: "List signon activity for a Workday tenant.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { activity: { type: "array" } } },
    },
    {
      name: "list_domain_policies",
      description: "List domain security policies for a Workday tenant.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { policies: { type: "array" } } },
    },
  ],
};

export const workdayConnectorHealthcheck =
  async (): Promise<ConnectorHealthcheckResult> => ({
    connectorKey: "workday",
    status: "not_implemented",
    checkedAt: checkedAt(),
    details: {
      phase: "stub",
    },
  });

export const workdayConnectorStub = {
  manifest: workdayConnectorManifest,
  healthcheck: workdayConnectorHealthcheck,
  listSecurityGroups: (context: ConnectorStubContext) =>
    executeStubTool(context, "list_security_groups"),
  getWorker: (context: ConnectorStubContext) =>
    executeStubTool(context, "get_worker"),
  listSignonActivity: (context: ConnectorStubContext) =>
    executeStubTool(context, "list_signon_activity"),
  listDomainPolicies: (context: ConnectorStubContext) =>
    executeStubTool(context, "list_domain_policies"),
};
