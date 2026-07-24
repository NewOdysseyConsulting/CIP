# CIP: Common Interoperability Protocol

**Status:** Draft 0.2 (alpha) · **Schema anchor:** [`schemas/cip-control-plane.schema.json`](../schemas/cip-control-plane.schema.json) · **HTTP binding:** [`schemas/cip-admin-api.openapi.json`](../schemas/cip-admin-api.openapi.json)

CIP is the open protocol for governed agent operations. It defines how agent platforms, runtimes, and tools describe and exchange the state of governed runs: who an agent is, where a workflow stands, what policy decided, who approved what, what evidence backs an outcome, and how all of it correlates across systems.

CIP does not execute anything. Execution, durability, and enforcement belong to the platform that implements the protocol — for example [Lupercal](../lupercal/README.md), New Odyssey's production control platform, whose Romulus subsystem owns state and recovery and whose Remus subsystem owns policy and approvals. Any system that speaks these shapes and honors the normative requirements below can interoperate: producers (agent runtimes such as Pegasus agents) emit CIP objects, and consumers (control planes, audit sinks, review tooling) store, gate, and project them.

## Interchange domains

| Domain | Document | Core objects |
| --- | --- | --- |
| Agent identity and capabilities | [identity-and-capabilities.md](identity-and-capabilities.md) | `TenantRecord`, `AgentBlueprint`, `ConnectorDefinition`, `DeploymentRecord` |
| Workflow state and transitions | [workflow-state.md](workflow-state.md) | `RunSession`, `RunEvent`, deployment lifecycle |
| Policy decisions | [policy-decisions.md](policy-decisions.md) | `PolicyPack`, `GuardrailDefinition`, `PolicyDecision` |
| Approval requests and responses | [approvals.md](approvals.md) | `ApprovalRequest`, `HumanReviewRecord` |
| Evidence and citations | [evidence-and-citations.md](evidence-and-citations.md) | `EvidenceBundle`, `PolicyEvidenceReference`, `DisclosureRecord`, `ComplianceArtifact` |
| Audit events | [audit-events.md](audit-events.md) | `AuditEvent`, `AuditActor`, actor verification |
| Task delegation | [task-delegation.md](task-delegation.md) | handoff events, tool invocation events, `CipEventBatch` |
| Execution outcomes | [execution-outcomes.md](execution-outcomes.md) | session completion, run results, failure semantics |
| Cross-system trace identifiers | [trace-correlation.md](trace-correlation.md) | `TraceCorrelation`, `correlationId` |

Normative conformance requirements are collected in [conformance.md](conformance.md). The runnable checks live in the [`@new-odyssey/cip-conformance`](../typescript/packages/conformance) package.

## Shape conventions

- Objects are JSON. Field names are `camelCase` in the wire format; language SDKs may project them into local conventions (the Python SDK uses `snake_case` dataclasses).
- Persistent objects extend `BaseRecord`: `id`, `createdAt`, `updatedAt`, and a monotonically increasing `revision`.
- Timestamps are RFC 3339 / ISO 8601 strings in UTC.
- Every object that participates in a governed run carries `tenantId`; run-scoped objects also carry `deploymentId` and `sessionId`. Implementations MUST NOT return objects across tenant boundaries.
- Versioned definitions (blueprints, policy packs, guardrails, connectors) are immutable per `key` + `version`; changing behavior requires publishing a new version.

## Normative language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described in RFC 2119.

## Versioning

The protocol version tracks the schema `$id` and the SDK major line. While the spec is in draft (0.x), breaking changes may occur between minor versions; they are recorded in the repository [CHANGELOG](../CHANGELOG.md) and in [docs/compatibility.md](../docs/compatibility.md). From 1.0, objects and endpoint bindings under `/v1` follow semantic versioning: additive fields only within a major version.

## Relationship to runtimes

CIP is runtime-neutral. The reference adapters in this repository bind the protocol to the OpenAI Agents SDK (`OpenAIAgentsRuntimeAdapter`), and the `RuntimeProfile.provider` field is extensible (`openai-agents-sdk`, `anthropic`, `custom`). A runtime adapter's job is to translate runtime-native lifecycle moments (tool calls, handoffs, guardrail trips, completions) into the CIP event and outcome shapes without deciding governance itself.
