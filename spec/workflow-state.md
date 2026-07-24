# Workflow State and Transitions

CIP models a governed run as a `RunSession` whose status advances through an explicit state machine, with an append-only sequence of `RunEvent`s recording every transition. Consumers reconstruct workflow position from these two objects alone; there is no hidden state.

## RunSession state machine

```
queued ── running ── waiting-human ── running ─┬─ completed
            │              │                   └─ failed
            └──────────────┴────────────────────── failed
```

| Status | Meaning |
| --- | --- |
| `queued` | Accepted, not yet executing |
| `running` | The runtime is executing |
| `waiting-human` | Blocked on an open `ApprovalRequest` (`currentApprovalRequestId` is set) |
| `completed` | Terminal success; `completedAt` and `outputSummary` set |
| `failed` | Terminal failure |

Transitions into `waiting-human` MUST create an approval request ([approvals.md](approvals.md)); transitions out of it MUST reference the resolution. Terminal states are final — a retry is a new session correlated via `correlationId`.

## RunEvent

Each lifecycle moment is one event: `type` (see the closed enum: `run_started`, `tool_called`, `tool_completed`, `handoff_started`, `handoff_completed`, `guardrail_triggered`, `policy_decided`, `approval_requested`, `approval_resolved`, `disclosure_presented`, `disclosure_acknowledged`, `human_review_completed`, `output_overridden`, `stop_invoked`, `run_completed`, `run_failed`), a per-session monotonic `sequence`, `occurredAt`, an actor with verification level ([audit-events.md](audit-events.md)), a free-form `payload`, and optional `traceCorrelation`.

Requirements:

- Event streams are append-only. Implementations MUST NOT mutate or delete events inside the retention window.
- `sequence` MUST be strictly increasing per session; consumers MUST order by sequence, not arrival.
- Replay (projecting session state from its events) MUST be deterministic: the same event stream yields the same session view.

## Deployment lifecycle

Deployments carry their own machine: `provisioning` → `active` ⇄ `paused` → `draining` → `retired`, with `failed` reachable from any non-terminal state and rollback re-activating the previous blueprint version. Every transition MUST stamp `lastTransitionAt` and emit a `deployment`-category audit event.

## Durability boundary

The protocol defines the *shapes* of state; durability and recovery are implementation concerns. In Lupercal, Romulus owns this: queued ingest jobs, retry with dead-lettering, and retention sweeps. A conforming implementation MAY be non-durable (the in-memory reference implementation is), but MUST still preserve ordering and append-only semantics within a process lifetime.
