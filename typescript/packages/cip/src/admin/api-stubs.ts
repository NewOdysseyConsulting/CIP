import type { ConnectorHealthcheckResult } from "../connectors/types.js";
import {
  dynamics365ConnectorHealthcheck,
} from "../connectors/dynamics365-stub.js";
import { workdayConnectorHealthcheck } from "../connectors/workday-stub.js";
import type {
  PolicyEvaluationContext,
  PolicyEvaluator,
} from "../policy/evaluator.js";
import type { CipRepositories } from "../repositories/ports.js";
import type { CipControlPlane } from "../services/cip-control-plane.js";

export interface AdminApiResponse<T> {
  status: number;
  data: T;
}

export type ConnectorHealthcheckRegistry = Record<
  string,
  () => Promise<ConnectorHealthcheckResult>
>;

export const createAdminApiHandlers = (
  controlPlane: CipControlPlane,
  repositories: CipRepositories,
  policyEvaluator: PolicyEvaluator,
  connectorHealthchecks: ConnectorHealthcheckRegistry = {
    workday: workdayConnectorHealthcheck,
    dynamics365: dynamics365ConnectorHealthcheck,
  },
) => ({
  getTenant: async (tenantId: string): Promise<AdminApiResponse<unknown>> => ({
    status: 200,
    data: await repositories.tenants.getById(tenantId),
  }),
  getDeployments: async (tenantId?: string): Promise<AdminApiResponse<unknown>> => ({
    status: 200,
    data: await repositories.deployments.list(
      tenantId === undefined ? undefined : { tenantId },
    ),
  }),
  getSession: async (sessionId: string): Promise<AdminApiResponse<unknown>> => ({
    status: 200,
    data: await controlPlane.replayRunSession(sessionId),
  }),
  getAuditEvents: async (tenantId?: string): Promise<AdminApiResponse<unknown>> => ({
    status: 200,
    data: await repositories.auditEvents.list(
      tenantId === undefined ? undefined : { tenantId },
    ),
  }),
  evaluatePolicy: async (
    policyPackId: string,
    context: PolicyEvaluationContext,
  ): Promise<AdminApiResponse<unknown>> => {
    const policyPack = await repositories.policyPacks.getById(policyPackId);

    if (policyPack === null) {
      return {
        status: 404,
        data: { error: `unknown policy pack ${policyPackId}` },
      };
    }

    const guardrails = await repositories.guardrailDefinitions.list({
      status: "active",
    });

    return {
      status: 200,
      data: policyEvaluator.evaluate(policyPack, context, guardrails),
    };
  },
  getConnectors: async (): Promise<AdminApiResponse<unknown>> => ({
    status: 200,
    data: await repositories.connectorDefinitions.list(),
  }),
  postConnectorHealthcheck: async (
    connectorKey: string,
  ): Promise<AdminApiResponse<unknown>> => {
    const healthcheck = connectorHealthchecks[connectorKey];

    if (healthcheck === undefined) {
      return {
        status: 404,
        data: { error: `unknown connector ${connectorKey}` },
      };
    }

    return {
      status: 200,
      data: await healthcheck(),
    };
  },
});
