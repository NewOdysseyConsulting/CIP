# Audit Events

Audit events are the tenant-wide, security-relevant ledger; run events are the per-session execution trail. They share the actor and provenance model defined here.

## AuditEvent

| Field | Meaning |
| --- | --- |
| `tenantId`, optional `deploymentId`/`sessionId` | Scope |
| `category` | `tenant`, `connector`, `policy`, `deployment`, `session`, `security`, `approval`, `runtime` |
| `action` | Verb string, e.g. `deployment.transitioned` |
| `severity` | `info` \| `warn` \| `error` \| `critical` |
| `occurredAt` | Event time |
| `actor`, `assertedActor`, `actorVerification` | Provenance (below) |
| `payload` | Structured detail |

## Actor provenance

**AuditActor** — `type` (`agent` \| `human` \| `system`) plus `id`.

`actorVerification` states how the platform knows who acted:

| Level | Meaning |
| --- | --- |
| `system` | The platform itself acted |
| `authenticated-operator` | A verified operator (JWT-authenticated) acted |
| `authenticated-sdk` | An authenticated SDK principal (API key) acted |
| `asserted` | Identity was claimed by the client, not verified |

The separation is deliberate: `actor` is what the implementation *verified*; `assertedActor` preserves what the client *claimed* when the two differ. Consumers evaluating oversight requirements MUST rely on the verified actor.

## Requirements

- Audit trails are append-only within the retention window; implementations MUST NOT rewrite history.
- Every state-changing operation in the other domains (deployment transitions, policy publication, approval resolution, key issuance, session lifecycle) MUST emit an audit event in the matching category.
- Implementations MUST set `actorVerification` from their own authentication context, never from the request body; regimes with `logging.requireVerifiedActors` MUST reject evidence-bearing writes whose acting identity is merely asserted.
- Audit queries are tenant-scoped; cross-tenant listings are an operator capability, never an SDK one.
