# Task Delegation

Delegation covers two exchanges: an agent handing work to another agent (handoffs) or to an external capability (tool calls), and a producer handing recorded work to a platform (event ingest). Both are expressed as events so delegation is always reconstructable.

## Agent-to-agent handoffs

A blueprint declares its permissible delegates in `handoffTargets` (blueprint keys). At runtime, delegation is recorded as a `handoff_started` event (payload naming the target) and a `handoff_completed` event when control returns. Implementations MUST reject or flag handoffs to targets not declared by the acting blueprint version.

Delegated work that runs as its own session MUST share the parent's `correlationId` (see [trace-correlation.md](trace-correlation.md)) so a delegation chain can be assembled across sessions and systems.

## Tool invocation

Tool use is delegation to an external system through a bound connector: `tool_called` / `tool_completed` events whose payloads identify the connector, capability name, and outcome. The capability MUST appear in the `capabilities` list of a `ConnectorDefinition` bound to the deployment ([identity-and-capabilities.md](identity-and-capabilities.md)). Shared external-system quotas are coordinated via `ConnectorRateBucket` records.

## Event ingest

Producers deliver recorded events to a platform in batches:

**CipRunEventEnvelope / CipAuditEventEnvelope** — an event body plus scope identifiers, tagged by kind.

**CipEventBatch** — `tenantId`, `sessionId`, and the envelope list. Producers supply an idempotency key alongside the batch (an `Idempotency-Key` header in the HTTP binding).

**CipIngestReceipt** — the platform's acknowledgement: `ingestJobId`, `acceptedCount`, `receivedAt`. The job id resolves to an `IngestJobRecord` for asynchronous processing. Failed jobs retry up to a bounded attempt count, then land in a dead-letter queue (`DeadLetterJobRecord`) for operator requeue.

## Requirements

- Hosted platforms MUST honor the batch idempotency key: redelivering a batch with the same key MUST NOT duplicate events (the conformance suite exercises this). In-process transports MAY delegate idempotency to the caller.
- An idempotency key is bound to the batch it first acknowledged (tenant, session, and event content). An identical retry MUST be answered with the recorded outcome; reusing a key with a *different* batch is a conflict — the platform MUST NOT apply the conflicting batch, and SHOULD reject the request rather than silently replaying the original receipt.
- Event envelopes carry no `sequence`; the platform assigns the per-session `sequence` at ingest. Producers MUST order events within a batch by occurrence, and platforms MUST assign sequences that preserve that order within a session.
- Asynchronous acceptance is allowed (receipt before persistence), but a receipt MUST be traceable to a terminal ingest outcome (processed or dead-lettered) via the job record.
