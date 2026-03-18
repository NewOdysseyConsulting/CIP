import type {
  ApprovalRequestStatus,
  GuardrailDefinition,
  RunSessionStatus,
  RuntimeProfile,
  TraceCorrelation,
} from "../domain/records.js";

export interface CipToolBinding {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface CipGuardrailBinding {
  definition: GuardrailDefinition;
  mode: "blocking";
}

export interface HumanApprovalCheckpoint {
  checkpointId: string;
  reason: string;
  guardrailDefinitionId?: string;
  policyPackId?: string;
  expiresAt?: string;
}

export interface HumanApprovalDecision {
  approvalRequestId: string;
  decision: Extract<
    ApprovalRequestStatus,
    "approved" | "rejected" | "expired" | "cancelled"
  >;
  resolutionComment?: string;
}

export interface CipSessionHandle {
  sessionId: string;
  conversationId?: string;
  previousResponseId?: string;
  metadata?: Record<string, unknown>;
}

export interface CipAgentSpec {
  name: string;
  instructions: string;
  runtimeProfile: RuntimeProfile;
  tools: CipToolBinding[];
  handoffTargets?: string[];
  guardrails?: CipGuardrailBinding[];
  structuredOutput?: string;
}

export interface CipRunRequest {
  agent: CipAgentSpec;
  input: string;
  session: CipSessionHandle;
  context?: Record<string, unknown>;
  approvalCheckpoints?: HumanApprovalCheckpoint[];
}

export interface CipRunResult {
  status: RunSessionStatus;
  finalOutput?: string;
  traceCorrelation?: TraceCorrelation;
  pendingApproval?: HumanApprovalCheckpoint;
  outputItems?: Record<string, unknown>[];
}

export interface CipRuntimeAdapter {
  readonly name: string;
  readonly version: string;
  createAgent(spec: CipAgentSpec): unknown;
  run(request: CipRunRequest): Promise<CipRunResult>;
  createSessionHandle(
    sessionId: string,
    metadata?: Record<string, unknown>,
  ): CipSessionHandle;
  createApprovalCheckpoint(
    checkpoint: HumanApprovalCheckpoint,
  ): HumanApprovalCheckpoint;
  resolveApprovalDecision(
    decision: HumanApprovalDecision,
  ): HumanApprovalDecision;
}
