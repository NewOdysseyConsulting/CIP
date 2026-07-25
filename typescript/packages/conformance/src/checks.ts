import { randomUUID } from "node:crypto";

import type {
  CipEventBatch,
  CipIngestReceipt,
  RunSession,
} from "@new-odyssey/cip";

import {
  ConformanceViolation,
  type ConformanceCheck,
  type ConformanceFixture,
} from "./types.js";

const INGEST_POLL_INTERVAL_MS = 250;
const INGEST_POLL_ATTEMPTS = 40;

const expect = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new ConformanceViolation(message);
  }
};

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const startSession = async (
  fixture: ConformanceFixture,
  correlationId?: string,
): Promise<RunSession> =>
  fixture.client.createSession(
    {
      tenantId: fixture.tenant.id,
      deploymentId: fixture.deployment.id,
      correlationId: correlationId ?? `conf-${randomUUID()}`,
      inputSummary: "Conformance suite session.",
    },
    `conf-session-${randomUUID()}`,
  );

const completeSession = async (
  fixture: ConformanceFixture,
  input: Parameters<ConformanceFixture["client"]["completeSession"]>[0],
): Promise<RunSession> =>
  fixture.client.completeSession(input, `conf-complete-${randomUUID()}`);

/**
 * Hosted platforms may acknowledge a batch before persisting it. Poll the
 * ingest job to a terminal state so later replay reads observe the events.
 * A null job (in-process transports ingest synchronously) means done.
 */
const awaitIngest = async (
  fixture: ConformanceFixture,
  receipt: CipIngestReceipt,
): Promise<void> => {
  for (let attempt = 0; attempt < INGEST_POLL_ATTEMPTS; attempt += 1) {
    const job = await fixture.client.getIngestJob(receipt.ingestJobId);
    if (job === null || job.status === "completed") {
      return;
    }
    if (job.status === "failed" || job.status === "dead_letter") {
      throw new ConformanceViolation(
        `ingest job ${job.id} reached ${job.status}: ${job.lastError ?? "no error recorded"}`,
      );
    }
    await sleep(INGEST_POLL_INTERVAL_MS);
  }
  throw new ConformanceViolation(
    `ingest job ${receipt.ingestJobId} did not reach a terminal state in time`,
  );
};

const enqueueAndAwait = async (
  fixture: ConformanceFixture,
  batch: CipEventBatch,
  idempotencyKey?: string,
): Promise<CipIngestReceipt> => {
  const receipt = await fixture.client.enqueueEvents(
    batch,
    idempotencyKey ?? `conf-batch-${randomUUID()}`,
  );
  await awaitIngest(fixture, receipt);
  return receipt;
};

const toolEventBatch = (
  fixture: ConformanceFixture,
  sessionId: string,
): CipEventBatch => ({
  tenantId: fixture.tenant.id,
  sessionId,
  events: [
    {
      kind: "run_event",
      type: "tool_called",
      payload: { tool: "conformance.echo" },
    },
    {
      kind: "run_event",
      type: "tool_completed",
      payload: { tool: "conformance.echo", outcome: "ok" },
    },
  ],
});

export const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  {
    id: "session-lifecycle",
    title: "Run sessions start, carry correlation, and complete terminally",
    spec: "workflow-state.md",
    run: async (fixture) => {
      const correlationId = `conf-${randomUUID()}`;
      const session = await startSession(fixture, correlationId);
      expect(session.tenantId === fixture.tenant.id, "session tenant mismatch");
      expect(
        session.correlationId === correlationId,
        "correlationId must be stored and returned verbatim",
      );
      expect(
        session.status === "queued" || session.status === "running",
        `new session must be queued or running, got ${session.status}`,
      );

      const completed = await completeSession(fixture, {
        sessionId: session.id,
        status: "completed",
        outputSummary: "Conformance run finished.",
      });
      expect(completed.status === "completed", "completion must be recorded");
      expect(
        typeof completed.completedAt === "string",
        "completedAt must be set on terminal sessions",
      );
    },
  },
  {
    id: "terminal-immutability",
    title: "Terminal sessions reject further lifecycle writes",
    spec: "execution-outcomes.md",
    run: async (fixture) => {
      const session = await startSession(fixture);
      await completeSession(fixture, {
        sessionId: session.id,
        status: "completed",
        outputSummary: "Original terminal outcome.",
      });
      const before = await fixture.client.getReplay(session.id);

      try {
        await completeSession(fixture, {
          sessionId: session.id,
          status: "failed",
          outputSummary: "attempted overwrite",
        });
      } catch {
        // Rejecting the write satisfies the requirement.
      }

      const after = await fixture.client.getReplay(session.id);
      expect(
        after.session.status === "completed" &&
          after.session.completedAt === before.session.completedAt &&
          after.session.outputSummary === before.session.outputSummary,
        "the full terminal outcome (status, completedAt, outputSummary) must be immutable",
      );
    },
  },
  {
    id: "event-ordering",
    title: "Run events keep strictly increasing per-session sequence",
    spec: "workflow-state.md",
    run: async (fixture) => {
      const session = await startSession(fixture);
      await enqueueAndAwait(fixture, toolEventBatch(fixture, session.id));
      const replay = await fixture.client.getReplay(session.id);

      expect(replay.runEvents.length >= 3, "expected run_started plus tool events");
      const sequences = replay.runEvents.map((event) => event.sequence);
      const sorted = [...sequences].sort((a, b) => a - b);
      expect(
        JSON.stringify(sequences) === JSON.stringify(sorted),
        "events must be returned in sequence order",
      );
      expect(
        new Set(sequences).size === sequences.length,
        "sequences must be strictly increasing (no duplicates)",
      );
      const types = replay.runEvents.map((event) => event.type);
      expect(
        types.indexOf("tool_called") < types.indexOf("tool_completed"),
        "producer ordering must be preserved within a batch",
      );
    },
  },
  {
    id: "ingest-idempotency",
    title: "Redelivered event batches with the same idempotency key do not duplicate events",
    spec: "task-delegation.md",
    skip: (fixture) =>
      fixture.supportsIngestIdempotency
        ? undefined
        : "target transport delegates ingest idempotency to the caller",
    run: async (fixture) => {
      const session = await startSession(fixture);
      const batch = toolEventBatch(fixture, session.id);
      const key = `conf-idem-${randomUUID()}`;

      await enqueueAndAwait(fixture, batch, key);
      await enqueueAndAwait(fixture, batch, key);

      // Reusing the key with a different batch is a conflict: the platform
      // must not apply the conflicting events (rejecting outright is best).
      const conflicting: CipEventBatch = {
        tenantId: fixture.tenant.id,
        sessionId: session.id,
        events: [
          {
            kind: "run_event",
            type: "guardrail_triggered",
            payload: { conflict: true },
          },
        ],
      };
      try {
        const receipt = await fixture.client.enqueueEvents(conflicting, key);
        await awaitIngest(fixture, receipt);
      } catch {
        // Rejecting conflicting key reuse satisfies the requirement.
      }

      const replay = await fixture.client.getReplay(session.id);
      const toolCalls = replay.runEvents.filter(
        (event) => event.type === "tool_called",
      );
      expect(
        toolCalls.length === 1,
        `expected exactly one tool_called event, got ${toolCalls.length}`,
      );
      expect(
        !replay.runEvents.some((event) => event.type === "guardrail_triggered"),
        "a conflicting batch reusing an idempotency key must not be applied",
      );
    },
  },
  {
    id: "approval-flow",
    title: "Approval requests block sessions and resolutions release them",
    spec: "approvals.md",
    run: async (fixture) => {
      const session = await startSession(fixture);
      const approval = await fixture.client.requestApproval({
        sessionId: session.id,
        checkpoint: {
          checkpointId: "conformance-gate",
          reason: "Conformance suite approval checkpoint.",
        },
      });
      expect(approval.status === "pending", "new approval must be pending");

      const waiting = await fixture.client.getReplay(session.id);
      expect(
        waiting.session.status === "waiting-human",
        "session must wait on the open approval",
      );
      expect(
        waiting.session.currentApprovalRequestId === approval.id,
        "waiting session must reference its open approval request",
      );

      const resolved = await fixture.client.resolveApproval({
        approvalRequestId: approval.id,
        decision: "approved",
        resolutionComment: "Approved by conformance suite.",
      });
      expect(resolved.status === "approved", "resolution must be recorded");

      const resumed = await fixture.client.getReplay(session.id);
      expect(
        resumed.session.status === "running",
        "approved session must resume running",
      );

      // A second, conflicting resolution may be rejected outright or answered
      // idempotently with the recorded resolution — but it must not change it.
      let overwritten = false;
      try {
        const second = await fixture.client.resolveApproval({
          approvalRequestId: approval.id,
          decision: "rejected",
        });
        overwritten = second.status !== "approved";
      } catch {
        // Rejecting the conflicting write satisfies the requirement.
      }
      const finalReplay = await fixture.client.getReplay(session.id);
      const storedApproval = finalReplay.approvalRequests.find(
        (request) => request.id === approval.id,
      );
      expect(
        !overwritten && storedApproval?.status === "approved",
        "terminal approval resolutions must be immutable",
      );
    },
  },
  {
    id: "evidence-bundle",
    title: "Completed sessions project evidence naming exact dependency versions",
    spec: "evidence-and-citations.md",
    run: async (fixture) => {
      const session = await startSession(fixture);
      await enqueueAndAwait(fixture, toolEventBatch(fixture, session.id));
      await completeSession(fixture, {
        sessionId: session.id,
        status: "completed",
        outputSummary: "Evidence check complete.",
      });

      const bundle = await fixture.client.getEvidenceBundle(session.id);
      expect(bundle !== null, "completed sessions must have an evidence bundle");
      expect(
        bundle!.agentBlueprintVersion.length > 0,
        "bundle must name the blueprint version that acted",
      );
      expect(
        bundle!.policyPackVersions.every(
          (ref) => ref.key.length > 0 && ref.version.length > 0,
        ),
        "policy pack references must carry key and version",
      );
      expect(
        bundle!.runEventIds.length >= 3,
        "bundle must reference the session's run events",
      );
    },
  },
  {
    id: "replay-determinism",
    title: "Replaying a session is deterministic",
    spec: "workflow-state.md",
    run: async (fixture) => {
      const session = await startSession(fixture);
      await enqueueAndAwait(fixture, toolEventBatch(fixture, session.id));
      await completeSession(fixture, {
        sessionId: session.id,
        status: "completed",
      });

      const first = await fixture.client.getReplay(session.id);
      const second = await fixture.client.getReplay(session.id);
      expect(
        JSON.stringify(first) === JSON.stringify(second),
        "two replays of the same session must be identical",
      );
      expect(
        first.reconstructedStatus === first.session.status,
        "replayed status must reproduce the recorded terminal state",
      );
    },
  },
  {
    id: "audit-provenance",
    title: "Audit events are tenant-scoped and carry actor verification",
    spec: "audit-events.md",
    run: async (fixture) => {
      const session = await startSession(fixture);
      await completeSession(fixture, {
        sessionId: session.id,
        status: "completed",
      });

      const auditEvents = await fixture.client.listAuditEvents(fixture.tenant.id);
      expect(auditEvents.length > 0, "lifecycle writes must emit audit events");
      expect(
        auditEvents.every((event) => event.tenantId === fixture.tenant.id),
        "audit listings must be tenant-scoped",
      );
      expect(
        auditEvents.every(
          (event) =>
            typeof event.actorVerification === "string" &&
            event.actorVerification.length > 0,
        ),
        "every audit event must state its actor verification level",
      );
    },
  },
];
