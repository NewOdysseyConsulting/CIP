# Execution Outcomes

An outcome is the durable answer to "what did the run produce, and can it be trusted?" CIP separates the runtime's transient result from the platform's recorded outcome.

## Runtime result

A runtime adapter returns a `CipRunResult`: `status` (`completed` \| `waiting-human` \| `failed`), output payload, and the session handle. `waiting-human` is not an outcome — it parks the session in the approval flow ([approvals.md](approvals.md)).

## Recorded outcome

Completing a session (`POST /v1/sessions/{sessionId}:complete` in the HTTP binding) fixes the outcome on the `RunSession`:

- `status`: `completed` or `failed` (terminal, immutable)
- `completedAt`, `outputSummary`
- a final `run_completed` or `run_failed` event closing the sequence

Failure detail travels in the closing event's `payload` (error class, retryability), not in ad-hoc fields.

## Outcome integrity

Outcomes are only as trustworthy as the gates that guarded them:

- If a compliance profile requires oversight, completion MUST be refused until required disclosures and human reviews are recorded ([evidence-and-citations.md](evidence-and-citations.md)).
- An `output_overridden` event records that a human replaced or edited agent output; a `stop_invoked` event records use of a stop mechanism. Both MUST carry verified human actors.
- After completion, the session's `EvidenceBundle` is the citable projection of the outcome; replay of the event stream MUST reproduce the recorded terminal state.

## Requirements

- Terminal status transitions are one-way; implementations MUST reject further lifecycle writes to a completed or failed session (idempotent re-completion with identical payload MAY return the recorded result).
- Every terminal session MUST have a closing `run_completed`/`run_failed` event whose `occurredAt` is ≥ every prior event in the session.
- Retries of failed work MUST be new sessions sharing `correlationId`, preserving each attempt's outcome individually.
