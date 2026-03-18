import { Agent, tool } from "@openai/agents";
import { z } from "zod";

import type {
  CipAgentSpec,
  CipRunRequest,
  CipRunResult,
  CipRuntimeAdapter,
  CipSessionHandle,
  HumanApprovalCheckpoint,
  HumanApprovalDecision,
} from "./types.js";

const genericPayloadSchema = z.object({
  payload: z.record(z.string(), z.unknown()).default({}),
});

const buildTraceCorrelation = (
  session: CipSessionHandle,
): CipRunResult["traceCorrelation"] => ({
  provider: "openai",
  ...(session.conversationId === undefined
    ? {}
    : { conversationId: session.conversationId }),
  ...(typeof session.metadata?.["responseId"] === "string"
    ? { responseId: session.metadata["responseId"] }
    : {}),
});

export class OpenAIAgentsRuntimeAdapter implements CipRuntimeAdapter {
  readonly name = "openai-agents-sdk";
  readonly version: string;

  constructor(version = "0.7.2") {
    this.version = version;
  }

  createAgent(spec: CipAgentSpec): Agent {
    return new Agent({
      name: spec.name,
      instructions: spec.instructions,
      tools: spec.tools.map((binding) =>
        tool({
          name: binding.name,
          description: binding.description,
          parameters: genericPayloadSchema,
          execute: async ({ payload }) => binding.execute(payload),
        }),
      ),
    });
  }

  async run(request: CipRunRequest): Promise<CipRunResult> {
    void this.createAgent(request.agent);

    if (request.approvalCheckpoints !== undefined) {
      const checkpoint = request.approvalCheckpoints[0];

      if (checkpoint !== undefined) {
        const traceCorrelation = buildTraceCorrelation(request.session);
        return {
          status: "waiting-human",
          pendingApproval: checkpoint,
          ...(traceCorrelation === undefined ? {} : { traceCorrelation }),
        };
      }
    }

    const traceCorrelation = buildTraceCorrelation(request.session);
    return {
      status: "completed",
      finalOutput: `OpenAI Agents SDK adapter accepted input: ${request.input}`,
      ...(traceCorrelation === undefined ? {} : { traceCorrelation }),
    };
  }

  createSessionHandle(
    sessionId: string,
    metadata?: Record<string, unknown>,
  ): CipSessionHandle {
    return {
      sessionId,
      ...(metadata === undefined ? {} : { metadata }),
    };
  }

  createApprovalCheckpoint(
    checkpoint: HumanApprovalCheckpoint,
  ): HumanApprovalCheckpoint {
    return {
      ...checkpoint,
    };
  }

  resolveApprovalDecision(
    decision: HumanApprovalDecision,
  ): HumanApprovalDecision {
    return {
      ...decision,
    };
  }
}
