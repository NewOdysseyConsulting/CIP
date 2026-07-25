# @new-odyssey/cip-conformance

Runnable conformance suite for [CIP](../../../spec/README.md) platform implementations. Each check enforces normative requirements from a spec document and reports `passed` / `failed` / `skipped` per check.

## Usage

Against the bundled in-memory reference implementation:

```bash
npx cip-conformance
```

Against a hosted platform (provisions a throwaway fixture tenant via the admin API). Credentials are read from the environment — `CIP_API_KEY` and `CIP_OPERATOR_TOKEN` — so they never appear in process listings, shell history, or CI logs:

```bash
export CIP_OPERATOR_TOKEN=...   # e.g. from your secret manager
npx cip-conformance --base-url https://cip.example.com
```

Against an existing tenant and deployment instead of provisioning (`CIP_API_KEY` must be scoped to that tenant):

```bash
export CIP_API_KEY=...
export CIP_OPERATOR_TOKEN=...
npx cip-conformance --base-url https://cip.example.com --tenant-id t_123 --deployment-id d_456
```

`--api-key` / `--operator-token` flags exist as overrides for local experimentation, but prefer the environment variables. An operator token is always required in HTTP mode — fixture resolution, approval resolution, and audit listing use operator-authenticated routes. In provisioning mode the suite issues its own tenant-scoped SDK key for the fixture tenant. Exit code is `0` when no check fails.

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
