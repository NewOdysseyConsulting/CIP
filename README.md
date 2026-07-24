# CIP

CIP is the open protocol for governed agent operations. Lupercal is the production platform that implements it.

CIP defines how agent platforms, runtimes, and tools describe and exchange the state of governed runs:

- agent identity and capabilities
- workflow state and transitions
- policy decisions
- approval requests and responses
- evidence and citations
- audit events
- task delegation
- execution outcomes
- cross-system trace identifiers

CIP does not own a runtime. Any system that speaks these shapes and satisfies the [conformance requirements](spec/conformance.md) can interoperate.

```text
CIP
Open interoperability protocol
        ↓ implemented by
Lupercal
Commercial control platform
        ├── Romulus: state and execution
        └── Remus: policy and rules
```

For Pegasus, that means: Pegasus agents use CIP to represent governed runs and evidence; Lupercal executes and controls those runs; Romulus knows where each workflow is and how it recovers; Remus decides what is permitted and when approval is required.

## What's in this repository

The open-source surface of CIP:

| Area | Where | What |
| --- | --- | --- |
| **Specification** | [`spec/`](spec/README.md) | The protocol: interchange domains, state machines, normative requirements |
| **Schemas** | [`schemas/`](schemas) | JSON Schema for protocol objects and the OpenAPI description of the `/v1` HTTP binding |
| **TypeScript SDK** | [`typescript/packages/cip`](typescript/packages/cip) | `@new-odyssey/cip`: protocol types, clients, transports, reference implementation |
| **Python SDK** | [`python/packages/cip`](python/packages/cip) | `new-odyssey-cip`: the same surface with Python conventions |
| **Reference adapters** | in the SDKs | OpenAI Agents SDK runtime adapter, HTTP JSON connector backend, Workday/Dynamics 365 stubs, AWS Secrets Manager backend |
| **Conformance tools** | [`typescript/packages/conformance`](typescript/packages/conformance) | `@new-odyssey/cip-conformance`: runnable suite + CLI for validating platform implementations |

The [`lupercal/`](lupercal/README.md) directory stages the commercial platform (Romulus, Remus, hosted services, infra) ahead of extraction into its private repository. It is **not** part of the CIP open-source surface.

## The protocol in one paragraph

A **tenant** deploys a versioned **agent blueprint** as a **deployment**. Runs execute as **sessions** that move `queued → running → waiting-human → completed/failed`, emitting an append-only, sequenced stream of **run events**. **Policy packs** and **guardrails** are evaluated into citable **policy decisions**; escalations become **approval requests** that block the session until a verified human resolves them. Everything a run did is projected into an **evidence bundle** naming exact dependency versions, backed by tenant-scoped **audit events** with explicit actor verification, and correlated across systems via **trace identifiers**. Full detail: [`spec/README.md`](spec/README.md).

## Quick start

Prerequisites: Node.js `>=22`, Python `>=3.10`.

```bash
npm install
npm run build --workspace @new-odyssey/cip
```

```bash
python3 -m venv .venv
.venv/bin/pip install -e python/packages/cip
```

### TypeScript

Local mode embeds the non-durable reference implementation — ideal for development, tests, and conformance work:

```ts
import {
  CipClient,
  CipControlPlane,
  LocalCipControlPlaneTransport,
  createInMemoryCipRepositories,
} from "@new-odyssey/cip";

const repositories = createInMemoryCipRepositories();
const controlPlane = new CipControlPlane(repositories);
const client = new CipClient(
  new LocalCipControlPlaneTransport({ controlPlane, repositories }),
);
```

Remote mode points the same client at any CIP-conformant platform (such as Lupercal):

```ts
import { CipClient, HttpCipControlPlaneTransport } from "@new-odyssey/cip";

const client = new CipClient(
  new HttpCipControlPlaneTransport({
    baseUrl: "https://cip.example.com",
    apiKey: process.env.CIP_API_KEY,
  }),
);
```

Admin/bootstrap flows use `CipAdminClient` with `HttpCipAdminTransport`; runtime lifecycle tracking around an OpenAI Agents SDK run uses `CipRunTracker`.

### Python

```python
from new_odyssey_cip import (
    CipClient,
    CipControlPlane,
    LocalCipControlPlaneTransport,
    create_in_memory_cip_repositories,
)

repositories = create_in_memory_cip_repositories()
control_plane = CipControlPlane(repositories)
client = CipClient(LocalCipControlPlaneTransport(control_plane, repositories))
```

Remote mode mirrors TypeScript: `HttpCipControlPlaneTransport(base_url, api_key=..., operator_token=...)`.

## Checking conformance

Run the suite against the bundled reference implementation:

```bash
npx cip-conformance
```

Or against a hosted platform:

```bash
npx cip-conformance --base-url https://cip.example.com --api-key $CIP_API_KEY --operator-token $CIP_OPERATOR_TOKEN
```

Checks cover session lifecycle, terminal immutability, event ordering, ingest idempotency, approval flow, evidence bundles, replay determinism, and audit provenance. See [`spec/conformance.md`](spec/conformance.md).

## HTTP binding

CIP-conformant platforms expose REST endpoints under `/v1` (sessions, event ingest, approvals, disclosures, human reviews, replay, evidence bundles, deployments, audit events) and operator endpoints under `/v1/admin`. The binding is described by:

- [`schemas/cip-control-plane.schema.json`](schemas/cip-control-plane.schema.json) — protocol object schemas
- [`schemas/cip-admin-api.openapi.json`](schemas/cip-admin-api.openapi.json) — endpoint description

Lupercal's hosted API service is the production implementation of this binding; the repository's in-memory implementation is the reference.

## Compliance positioning

CIP carries the *evidence shapes* that compliance regimes need — disclosure records, human review records, compliance profiles and artifacts, verified actor provenance — and conformant platforms enforce the associated gates (e.g. refusing to complete oversight-gated sessions). This enables compliance workflows; it is not a blanket "AI Act compliant" claim, and applications must still present disclosures in their own UI. See [`docs/eu-ai-act.md`](docs/eu-ai-act.md).

## Repository layout

```text
.
├── spec                      # CIP protocol specification
├── schemas                   # JSON Schema + OpenAPI binding
├── typescript
│   └── packages
│       ├── cip               # @new-odyssey/cip (SDK + reference implementation)
│       └── conformance       # @new-odyssey/cip-conformance
├── python
│   └── packages
│       ├── cip               # new-odyssey-cip
│       └── lupercal          # new-odyssey-lupercal (staged commercial modules)
├── lupercal                  # Lupercal platform (staged for private extraction)
│   ├── romulus               # @new-odyssey/romulus — durable state
│   ├── remus                 # @new-odyssey/remus — policy engine
│   ├── services              # lupercal-api, lupercal-worker, lupercal-migrate
│   ├── sql                   # Postgres migrations
│   └── infra                 # Helm chart + Terraform module
└── docs                      # Compatibility and compliance guides
```

## Development

```bash
npm test          # everything
npm run test:ts   # TypeScript packages and services
npm run test:py   # Python packages
```

## Status

The protocol and SDKs are prerelease (`0.3.0-alpha`): contracts are alpha and `v1` stability guarantees are not yet in place. Breaking changes between alpha releases are recorded in the [CHANGELOG](CHANGELOG.md) and [docs/compatibility.md](docs/compatibility.md).

## Security and contributions

External contributions are welcome. Changes must preserve tenant isolation, append-only event provenance, idempotent public APIs, and explicit versioning of blueprints, policy packs, and guardrails. Report security issues privately to the maintainers rather than opening a public exploit issue.

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)

## License

MIT
