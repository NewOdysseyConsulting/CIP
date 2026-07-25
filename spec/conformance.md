# Conformance

A system conforms to CIP by implementing one or more roles and satisfying the normative requirements of the domain documents. The runnable suite in [`@new-odyssey/cip-conformance`](../typescript/packages/conformance) automates the platform checks.

## Roles

| Role | Implements | Examples |
| --- | --- | --- |
| **Platform** | Stores CIP objects, runs the state machines, enforces gates, serves the HTTP binding | Lupercal; the in-memory reference implementation |
| **Producer** | Emits sessions, events, and outcomes in CIP shapes | Pegasus agents, runtime adapters |
| **Consumer** | Reads sessions, evidence, and audit trails | Audit tooling, review UIs |

## Platform requirements (summary)

A conforming platform MUST:

1. Enforce tenant isolation on every read and write.
2. Keep run and audit event streams append-only, ordered by per-session `sequence`.
3. Honor batch idempotency keys on hosted ingest (redelivery MUST NOT duplicate events).
4. Run the `RunSession` state machine exactly as specified, including `waiting-human` ↔ approval-request coupling.
5. Treat versioned definitions (blueprints, policy packs, guardrails, connectors) as immutable per `key`+`version`.
6. Record `actorVerification` from its own authentication context and preserve `assertedActor` separately.
7. Refuse completion of oversight-gated sessions until required disclosures and reviews exist.
8. Produce deterministic replay and evidence-bundle projections from stored records.
9. Reject terminal-state mutations (idempotent repeats excepted).
10. Serve the `/v1` HTTP binding described by [`schemas/cip-admin-api.openapi.json`](../schemas/cip-admin-api.openapi.json), or document which binding subset it offers.

A platform MAY be non-durable (reference implementation); durability, recovery, and retention are quality-of-implementation concerns (in Lupercal: Romulus).

## Producer requirements (summary)

Producers MUST scope every object with `tenantId`/`deploymentId`/`sessionId`, deliver events in occurrence order (the platform assigns each session's monotonic `sequence` at ingest), reuse `correlationId` across retries and delegation, and only invoke capabilities declared by the bound deployment.

## Running the suite

```bash
npx cip-conformance            # against the bundled in-memory reference implementation
npx cip-conformance --base-url https://cip.example.com --api-key $KEY --operator-token $TOKEN
```

The suite reports one result per check; a platform passes a conformance level when every check in that level passes. Checks are versioned with the spec — see the package README for the current check list.
