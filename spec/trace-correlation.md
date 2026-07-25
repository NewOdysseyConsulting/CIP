# Cross-System Trace Identifiers

Governed runs cross system boundaries: an application, an agent runtime, a control platform, observability backends. CIP carries two complementary identifiers so any of these can join their views of the same work.

## correlationId

Every `RunSession` carries a `correlationId`, a caller-supplied string that groups related sessions: retries of the same task, sessions in one delegation chain, or one business transaction spanning agents. It is opaque to the platform.

- Producers SHOULD reuse the `correlationId` across retries and delegated sub-sessions.
- Platforms MUST store and return it verbatim and support querying sessions by it.

## TraceCorrelation

A structured link into distributed-tracing and conversation systems, attachable to sessions and to individual run events:

| Field | Meaning |
| --- | --- |
| `provider` | `openai` \| `custom` |
| `traceId`, `spanId` | Distributed-trace coordinates |
| `conversationId`, `responseId` | Conversation-system coordinates (e.g. OpenAI response ids) |

`provider` names the id namespace; `custom` covers W3C Trace Context or in-house tracing, with ids carried verbatim.

## Requirements

- Trace identifiers are opaque: implementations MUST NOT parse, validate, or rewrite them beyond storing and returning.
- When a runtime adapter has trace context (e.g. an OpenAI `responseId`), it SHOULD attach `TraceCorrelation` to the session at start and to events it emits, so evidence bundles can cite external traces.
- Events inherit their session's correlation scope; a per-event `traceCorrelation` refines, never replaces, session-level identity (`tenantId`/`sessionId` remain authoritative for scoping).
- Producers MUST NOT place secrets or personal data in trace identifiers — they are exchanged across trust boundaries, and platforms cannot police values they are required to treat as opaque. Platforms MUST limit their own handling to opaque storage and return, subject to documented retention controls.
