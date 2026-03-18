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
}

export class CipRunTracker {
  private readonly actor: AuditActor;

  constructor(
    private readonly client: Pick<
      CipClient,
      | "createSession"
      | "enqueueEvents"
      | "requestApproval"
      | "resolveApproval"
      | "completeSession"
      | "getReplay"
      | "getEvidenceBundle"
    >,
    options: CipRunTrackerOptions = {},
  ) {
    this.actor = options.actor ?? defaultActor;
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
}
