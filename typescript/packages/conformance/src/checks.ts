import { randomUUID } from "node:crypto";

import type {
  CipEventBatch,
  RunSession,
} from "@new-odyssey/cip";

import {
  ConformanceViolation,
  type ConformanceCheck,
  type ConformanceFixture,
} from "./types.js";

const expect = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new ConformanceViolation(message);
  }
};

const startSession = async (
  fixture: ConformanceFixture,
  correlationId?: string,
): Promise<RunSession> =>
  fixture.client.createSession({
    tenantId: fixture.tenant.id,
    deploymentId: fixture.deployment.id,
    correlationId: correlationId ?? `conf-${randomUUID()}`,
    inputSummary: "Conformance suite session.",
  });

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

      const completed = await fixture.client.completeSession({
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
      await fixture.client.completeSession({
        sessionId: session.id,
        status: "completed",
      });

      let mutated = false;
      try {
        const second = await fixture.client.completeSession({
          sessionId: session.id,
          status: "failed",
          outputSummary: "attempted overwrite",
        });
        mutated = second.status !== "completed";
      } catch {
        // Rejecting the write satisfies the requirement.
      }

      const replay = await fixture.client.getReplay(session.id);
      expect(
        !mutated && replay.session.status === "completed",
        "terminal status must be immutable",
      );
    },
  },
  {
    id: "event-ordering",
    title: "Run events keep strictly increasing per-session sequence",
    spec: "workflow-state.md",
    run: async (fixture) => {
      const session = await startSession(fixture);
      await fixture.client.enqueueEvents(toolEventBatch(fixture, session.id));
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

      await fixture.client.enqueueEvents(batch, key);
      await fixture.client.enqueueEvents(batch, key);

      const replay = await fixture.client.getReplay(session.id);
      const toolCalls = replay.runEvents.filter(
        (event) => event.type === "tool_called",
      );
      expect(
        toolCalls.length === 1,
        `expected exactly one tool_called event, got ${toolCalls.length}`,
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

      let doubleResolved = false;
      try {
        await fixture.client.resolveApproval({
          approvalRequestId: approval.id,
          decision: "rejected",
        });
        doubleResolved = true;
      } catch {
        // Terminal approval statuses are immutable.
      }
      expect(!doubleResolved, "resolved approvals must not be re-resolvable");
    },
  },
  {
    id: "evidence-bundle",
    title: "Completed sessions project evidence naming exact dependency versions",
    spec: "evidence-and-citations.md",
    run: async (fixture) => {
      const session = await startSession(fixture);
      await fixture.client.enqueueEvents(toolEventBatch(fixture, session.id));
      await fixture.client.completeSession({
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
      await fixture.client.enqueueEvents(toolEventBatch(fixture, session.id));
      await fixture.client.completeSession({
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
      await fixture.client.completeSession({
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
