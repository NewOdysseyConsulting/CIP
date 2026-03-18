# CIP

Common Infrastructure Protocol, or CIP, is New Odyssey's infrastructure layer for building governed enterprise AI agents.

CIP is SDK-first. It gives you the APIs, data model, repository layer, policy hooks, audit trail, approval persistence, and control-plane contracts needed to build agents on top of the OpenAI Agents SDK without hard-coupling your application to one runtime or one deployment model.

This repository currently includes:

- a TypeScript SDK for Node.js teams
- a Python SDK for backend and orchestration teams
- a deployable TypeScript control-plane API, worker, and migration runner
- Postgres and in-memory repository implementations
- immutable blueprint versioning, deployment lifecycle state, replay, and evidence bundles
- human-in-the-loop approval persistence
- policy and guardrail infrastructure
- connector contracts and stubs for Workday and Dynamics 365
- Helm and Terraform assets for self-hosted control-plane deployments

## What CIP Is

CIP is the infrastructure around agent execution:

- tenant-aware state
- deployment metadata and rollout control
- audit events and evidence projection
- approval checkpoints and resolution history
- connector inventory and quota coordination
- policy-pack and guardrail attachment
- local and remote control-plane transports

OpenAI Agents SDK still runs the agent. CIP records, governs, and exposes the infrastructure state around that execution.

## What CIP Is Not

CIP is not:

- a product-specific agent implementation
- a hosted multi-tenant SaaS in this repo
- a replacement for the OpenAI Agents SDK runtime
- a finished connector suite for every target platform

Pantheon and Phoenix consume CIP. They are not implemented here.

## Current Status

This repository is phase-1 infrastructure. The core control-plane model is present and tested, but some operational surfaces are still intentionally narrow:

- the deployable control plane supports tracked sessions, async event ingest, approvals, replay, evidence bundles, deployment transitions, and rollback
- operator tokens and SDK API keys are supported
- API-key issuance is currently a bootstrap concern, not a public API endpoint
- Workday and Dynamics 365 integrations are stubs, not live production connectors

If you want a production deployment, treat this repo as a strong foundation, not as a finished platform product.

## Quick Start

### Prerequisites

- Node.js `>=22`
- Python `>=3.10`
- Postgres for hosted control-plane mode

### Install From Source

TypeScript workspace:

```bash
npm install
npm run build --workspace @new-odyssey/cip
```

Python workspace:

```bash
python3 -m venv .venv
.venv/bin/pip install -e python/packages/cip
```

Current package names:

- TypeScript: `@new-odyssey/cip`
- Python: `new-odyssey-cip`

## TypeScript SDK Example

Local mode keeps everything in process. This is the simplest way to embed CIP into a library or service.

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
  new LocalCipControlPlaneTransport({
    controlPlane,
    repositories,
  }),
);

// In a real application, you would register tenants, blueprints,
// connectors, and deployments before starting sessions.
```

Remote mode points the SDK at a hosted CIP control plane:

```ts
import {
  CipClient,
  HttpCipControlPlaneTransport,
} from "@new-odyssey/cip";

const client = new CipClient(
  new HttpCipControlPlaneTransport({
    baseUrl: "https://cip.example.com",
    apiKey: process.env.CIP_API_KEY,
    operatorToken: process.env.CIP_OPERATOR_TOKEN,
  }),
);
```

If you want CIP to track runtime lifecycle around an OpenAI Agents SDK run, use `CipRunTracker`.

## Python SDK Example

```python
from new_odyssey_cip import (
    CipClient,
    CipControlPlane,
    LocalCipControlPlaneTransport,
    create_in_memory_cip_repositories,
)

repositories = create_in_memory_cip_repositories()
control_plane = CipControlPlane(repositories)

client = CipClient(
    LocalCipControlPlaneTransport(control_plane, repositories)
)
```

Remote mode is the same shape:

```python
from new_odyssey_cip import CipClient, HttpCipControlPlaneTransport

client = CipClient(
    HttpCipControlPlaneTransport(
        "https://cip.example.com",
        api_key="cip_sdk_key",
        operator_token="operator_token",
    )
)
```

## Deployable Control Plane

The deployable control plane is the self-hosted reference implementation of the CIP APIs.

Services in this repo:

- `@new-odyssey/cip-control-plane-api`
- `@new-odyssey/cip-control-plane-worker`
- `@new-odyssey/cip-control-plane-migrate`

### Required Environment Variables

API service:

- `CIP_DATABASE_URL`
- `CIP_OPERATOR_SHARED_SECRET`

Optional API service variables:

- `HOST`
- `PORT`
- `CIP_OPERATOR_ISSUER`
- `CIP_OPERATOR_AUDIENCE`
- `CIP_RUN_MIGRATIONS_ON_STARTUP=false`

Worker:

- `CIP_DATABASE_URL`
- `CIP_WORKER_POLL_INTERVAL_MS`
- `CIP_WORKER_MAX_ATTEMPTS`

### Local Hosted Quickstart

1. Install dependencies and build the TypeScript workspaces.

```bash
npm install
npm run build:ts
```

2. Set the minimum control-plane environment.

```bash
export CIP_DATABASE_URL=postgres://postgres:postgres@localhost:5432/cip
export CIP_OPERATOR_SHARED_SECRET=replace-me
```

3. Run the shared Postgres migration.

```bash
npm run start --workspace @new-odyssey/cip-control-plane-migrate
```

4. Start the API.

```bash
npm run start --workspace @new-odyssey/cip-control-plane-api
```

5. Start the worker in a separate shell.

```bash
export CIP_DATABASE_URL=postgres://postgres:postgres@localhost:5432/cip
npm run start --workspace @new-odyssey/cip-control-plane-worker
```

### Bootstrap Caveat

The v1 API does not yet expose public endpoints for:

- issuing SDK API keys
- minting operator tokens
- tenant/bootstrap provisioning workflows

For now, bootstrap those out of band through your own provisioning code, direct database seeding, or internal helpers in the service packages.

## Public SDK Surface

The main SDK entry points are:

- `CipControlPlane`
- `CipClient`
- `LocalCipControlPlaneTransport`
- `HttpCipControlPlaneTransport`
- `CipRunTracker`
- `OpenAIAgentsRuntimeAdapter`
- `createInMemoryCipRepositories`
- `createPostgresCipRepositories`

The Python package exposes the same concepts with Python naming conventions.

## OpenAI Agents SDK

CIP is designed to work with the official OpenAI Agents SDKs:

- TypeScript: [`@openai/agents`](https://github.com/openai/openai-agents-js)
- Python: [`openai-agents`](https://github.com/openai/openai-agents-python)

Relevant docs:

- [Agents SDK guide](https://developers.openai.com/api/docs/guides/agents-sdk/)
- [Build agents quickstart](https://developers.openai.com/api/docs/quickstart/#build-agents)

In this repo, OpenAI Agents SDK is the runtime adapter layer. CIP owns the infrastructure state around that runtime.

## Hosted API Surface

The hosted reference implementation exposes REST endpoints under `/v1`, including:

- `POST /v1/sessions`
- `POST /v1/sessions/{sessionId}/events:enqueue`
- `POST /v1/sessions/{sessionId}:complete`
- `GET /v1/sessions/{sessionId}/replay`
- `GET /v1/evidence-bundles/{sessionId}`
- `POST /v1/approval-requests/{approvalRequestId}:resolve`
- `POST /v1/deployments/{deploymentId}:transition`
- `POST /v1/deployments/{deploymentId}:rollback`
- `GET /v1/deployments`
- `GET /v1/tenants/{tenantId}`
- `GET /v1/audit-events`

See:

- [`schemas/cip-admin-api.openapi.json`](schemas/cip-admin-api.openapi.json)
- [`schemas/cip-control-plane.schema.json`](schemas/cip-control-plane.schema.json)

## Monorepo Layout

```text
.
├── infra
│   ├── helm/cip-control-plane
│   └── terraform/kubernetes/cip-control-plane
├── python/packages/cip
├── schemas
├── sql/postgres
├── typescript/packages/cip
└── typescript/services
    ├── control-plane-api
    ├── control-plane-migrate
    └── control-plane-worker
```

## Development

Build and test everything:

```bash
npm test
```

TypeScript only:

```bash
npm run test:ts
```

Python only:

```bash
npm run test:py
```

## Security And Contributions

External contributions are welcome, but this is infrastructure code with audit and control-plane implications. Changes should preserve:

- tenant isolation
- append-only event provenance
- idempotent public APIs
- explicit versioning of blueprints, policy packs, and guardrails

If you discover a security issue, report it privately to the maintainers rather than opening a public exploit issue.

## Open-Source Boundary

Included here:

- SDKs and transport layers
- repository interfaces and implementations
- control-plane orchestration
- policy and guardrail infrastructure
- deployable reference control-plane services
- connector contracts and stubs
- Helm, Terraform, SQL, and schema assets

Not included here:

- proprietary Pantheon or Phoenix business logic
- closed policy packs or analytics
- full enterprise vault integrations
- finished production connectors for every target platform

## License

MIT
