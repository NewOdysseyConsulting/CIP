# @new-odyssey/cip-conformance

Runnable conformance suite for [CIP](../../../spec/README.md) platform implementations. Each check enforces normative requirements from a spec document and reports `passed` / `failed` / `skipped` per check.

## Usage

Against the bundled in-memory reference implementation:

```bash
npx cip-conformance
```

Against a hosted platform (provisions a throwaway fixture tenant via the admin API):

```bash
npx cip-conformance --base-url https://cip.example.com --api-key $CIP_API_KEY --operator-token $CIP_OPERATOR_TOKEN
```

Against an existing tenant and deployment instead of provisioning:

```bash
npx cip-conformance --base-url https://cip.example.com --api-key $CIP_API_KEY --tenant-id t_123 --deployment-id d_456
```

Exit code is `0` when no check fails.

## Checks

| Check | Spec |
| --- | --- |
| `session-lifecycle` | workflow-state.md |
| `terminal-immutability` | execution-outcomes.md |
| `event-ordering` | workflow-state.md |
| `ingest-idempotency` (hosted only) | task-delegation.md |
| `approval-flow` | approvals.md |
| `evidence-bundle` | evidence-and-citations.md |
| `replay-determinism` | workflow-state.md |
| `audit-provenance` | audit-events.md |

## Programmatic use

```ts
import {
  createLocalTarget,
  createHttpTarget,
  runConformanceSuite,
} from "@new-odyssey/cip-conformance";

const report = await runConformanceSuite(createLocalTarget());
```

Custom platforms can implement `ConformanceTarget` to plug their own fixture provisioning into the same checks.
