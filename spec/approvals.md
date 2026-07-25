# Approval Requests and Responses

Human-in-the-loop control is a first-class protocol flow: a runtime declares *where* approval may be needed, the platform records *that* it was requested, and a verified human records *how* it was resolved. The session blocks in `waiting-human` in between.

## Objects

**HumanApprovalCheckpoint** (runtime-side declaration) — `checkpointId`, `reason`, optional `guardrailDefinitionId`/`policyPackId` linking the checkpoint to the rule that demanded it.

**ApprovalRequest** — the persistent request:

| Field | Meaning |
| --- | --- |
| `tenantId`, `deploymentId`, `sessionId` | Scope |
| `checkpointId` | Which declared checkpoint fired |
| `reason` | Why approval is needed |
| `requestedBy` | `AuditActor` (usually the agent) |
| `status` | `pending` → `approved` \| `rejected` \| `expired` \| `cancelled` |
| `expiresAt`, `resolvedAt`, `resolutionComment` | Lifecycle detail |
| `guardrailDefinitionId`, `policyPackId` | Provenance of the requirement |

**HumanApprovalDecision / resolution** — resolving a request records the deciding actor and comment, emits an `approval_resolved` run event, and returns the session to `running` (approved) or toward `failed`/override handling (rejected).

**HumanReviewRecord** — distinct from approvals: a post-hoc review of session output (`reviewer`, `decision: approved | rejected`, `reviewedAt`), used by oversight regimes that require review before completion ([evidence-and-citations.md](evidence-and-citations.md)).

## Flow

1. Runtime hits a checkpoint → `approval_requested` event; session → `waiting-human`; `currentApprovalRequestId` set.
2. A human resolves the request via the platform → `approval_resolved` event with `actorVerification` reflecting an authenticated operator.
3. Session resumes or terminates; the request's terminal status is immutable.

## Requirements

- A session in `waiting-human` MUST reference exactly one open approval request.
- Resolution MUST be idempotent: resolving an already-resolved request returns the recorded resolution unchanged rather than double-resolving.
- Implementations MUST verify the resolving actor themselves (`actorVerification: authenticated-operator` or stronger); a client-asserted human identity is recorded as `assertedActor`, never as the verified actor.
- Compliance profiles can require review before completion (`oversight.requireApprovalBeforeCompletion`, `minimumHumanReviewers`); implementations MUST refuse to complete such sessions until the required `HumanReviewRecord`s exist.
- Expiry (`expiresAt`) SHOULD transition abandoned requests to `expired` and fail or re-route the session rather than leaving it blocked indefinitely.
