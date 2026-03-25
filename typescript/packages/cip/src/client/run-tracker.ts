import type { AuditActor } from "../domain/records.js";
import type { CipRunResult, HumanApprovalCheckpoint } from "../runtime/types.js";
import type { CipClient } from "./client.js";
import type {
  CipAuditEventEnvelope,
  CipIngestEvent,
  CipRunEventEnvelope,
  CompleteSessionRequest,
  CreateSessionRequest,
  RequestApprovalRequest,
} from "./types.js";

const defaultActor: AuditActor = {
  type: "agent",
  id: "cip-run-tracker",
};

export interface CipRunTrackerOptions {
  actor?: AuditActor;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export class CipRunTracker {
  private readonly actor: AuditActor;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(
    private readonly client: Pick<
      CipClient,
      | "createSession"
      | "enqueueEvents"
      | "requestApproval"
      | "resolveApproval"
      | "getComplianceProfile"
      | "recordDisclosure"
      | "recordHumanReview"
      | "completeSession"
      | "getIngestJob"
      | "getReplay"
      | "getEvidenceBundle"
    >,
    options: CipRunTrackerOptions = {},
  ) {
    this.actor = options.actor ?? defaultActor;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.maxPollAttempts = options.maxPollAttempts ?? 20;
  }

  async createSession(input: CreateSessionRequest, idempotencyKey?: string) {
    return this.client.createSession(input, idempotencyKey);
  }

  async enqueueRunEvent(
    tenantId: string,
    sessionId: string,
    event: Omit<CipRunEventEnvelope, "kind">,
    idempotencyKey?: string,
  ) {
    return this.enqueueEvents(
      tenantId,
      sessionId,
      [{ kind: "run_event", ...event }],
      idempotencyKey,
    );
  }

  async enqueueAuditEvent(
    tenantId: string,
    sessionId: string,
    event: Omit<CipAuditEventEnvelope, "kind">,
    idempotencyKey?: string,
  ) {
    return this.enqueueEvents(
      tenantId,
      sessionId,
      [{ kind: "audit_event", ...event }],
      idempotencyKey,
    );
  }

  async enqueueEvents(
    tenantId: string,
    sessionId: string,
    events: CipIngestEvent[],
    idempotencyKey?: string,
  ) {
    return this.client.enqueueEvents(
      {
        tenantId,
        sessionId,
        events,
      },
      idempotencyKey,
    );
  }

  async requestApproval(input: RequestApprovalRequest) {
    return this.client.requestApproval(input);
  }

  async getComplianceProfile(deploymentId: string) {
    return this.client.getComplianceProfile(deploymentId);
  }

  async recordDisclosure(
    input: import("./types.js").RecordDisclosureRequest,
  ) {
    return this.client.recordDisclosure(input);
  }

  async recordHumanReview(
    input: import("./types.js").RecordHumanReviewRequest,
  ) {
    return this.client.recordHumanReview(input);
  }

  async trackRuntimeResult(input: {
    tenantId: string;
    sessionId: string;
    result: CipRunResult;
    approvalCheckpoint?: HumanApprovalCheckpoint;
    completeRequest?: Omit<CompleteSessionRequest, "sessionId" | "status">;
  }) {
    if (input.result.pendingApproval ?? input.approvalCheckpoint) {
      const checkpoint =
        input.result.pendingApproval ?? input.approvalCheckpoint;

      if (checkpoint === undefined) {
        throw new Error("pending approval checkpoint is required");
      }

      return this.client.requestApproval({
        sessionId: input.sessionId,
        checkpoint,
        actor: this.actor,
      });
    }

    return this.client.completeSession({
      sessionId: input.sessionId,
      status: input.result.status === "failed" ? "failed" : "completed",
      ...(input.result.finalOutput === undefined
        ? {}
        : { outputSummary: input.result.finalOutput }),
      ...(input.completeRequest?.outputSummary === undefined
        ? {}
        : { outputSummary: input.completeRequest.outputSummary }),
    });
  }

  async getReplay(sessionId: string) {
    return this.client.getReplay(sessionId);
  }

  async getEvidenceBundle(sessionId: string) {
    return this.client.getEvidenceBundle(sessionId);
  }

  async waitForIngest(jobId: string) {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const job = await this.client.getIngestJob(jobId);
      if (
        job === null ||
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "dead_letter"
      ) {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    return this.client.getIngestJob(jobId);
  }

  async waitForReplayStatus(
    sessionId: string,
    status: "completed" | "failed" | "waiting-human",
  ) {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const replay = await this.client.getReplay(sessionId);
      if (replay.reconstructedStatus === status) {
        return replay;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    return this.client.getReplay(sessionId);
  }

  runStarted(payload: Record<string, unknown> = {}, occurredAt?: string) {
    return {
      type: "run_started" as const,
      actor: this.actor,
      payload,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    };
  }

  toolCalled(payload: Record<string, unknown>, occurredAt?: string) {
    return {
      type: "tool_called" as const,
      actor: this.actor,
      payload,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    };
  }

  toolCompleted(payload: Record<string, unknown>, occurredAt?: string) {
    return {
      type: "tool_completed" as const,
      actor: this.actor,
      payload,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    };
  }

  guardrailTriggered(payload: Record<string, unknown>, occurredAt?: string) {
    return {
      type: "guardrail_triggered" as const,
      actor: this.actor,
      payload,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    };
  }

  policyDecided(payload: Record<string, unknown>, occurredAt?: string) {
    return {
      type: "policy_decided" as const,
      actor: this.actor,
      payload,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    };
  }

  approvalRequested(payload: Record<string, unknown>, occurredAt?: string) {
    return {
      type: "approval_requested" as const,
      actor: this.actor,
      payload,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    };
  }

  runCompleted(payload: Record<string, unknown> = {}, occurredAt?: string) {
    return {
      type: "run_completed" as const,
      actor: this.actor,
      payload,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    };
  }

  runFailed(payload: Record<string, unknown> = {}, occurredAt?: string) {
    return {
      type: "run_failed" as const,
      actor: this.actor,
      payload,
      ...(occurredAt === undefined ? {} : { occurredAt }),
    };
  }
}
