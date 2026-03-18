# CIP Monorepo

Common Infrastructure Protocol (CIP) is New Odyssey's shared infrastructure layer for enterprise AI agents.

This repository is now a polyglot monorepo with:

- a TypeScript package for Node.js teams
- a Python package for backend and orchestration teams
- a shared schema directory for protocol-level assets
- OpenAI Agents SDK integration in both language packages

CIP is not the customer-facing product. It is the reusable protocol and control-plane layer underneath Pegasus, Pantheon, and Phoenix.

## What CIP Does

CIP standardizes how New Odyssey agents:

- register tenants, connectors, credentials, policies, deployments, sessions, and audit events
- attach platform-specific logic for systems such as Workday and Dynamics 365
- keep business logic portable across runtimes
- plug into OpenAI Agents SDK orchestration without hard-wiring product logic to one implementation

The control plane in this repo is the infrastructure slice that runtime SDKs do not own directly:

- tenant-aware state
- connector inventory
- credential references
- policy attachment
- deployment metadata
- audit evidence

## Monorepo Layout

```text
.
├── schemas
│   └── cip-control-plane.schema.json
├── typescript
│   └── packages
│       └── cip
│           ├── src
│           ├── test
│           ├── package.json
│           └── tsconfig.json
├── python
│   └── packages
│       └── cip
│           ├── src
│           │   └── new_odyssey_cip
│           ├── tests
│           └── pyproject.toml
├── package.json
└── tsconfig.base.json
```

## OpenAI Agents SDK

This monorepo explicitly targets the official OpenAI Agents SDKs:

- TypeScript package: [`@openai/agents`](https://github.com/openai/openai-agents-js)
- Python package: [`openai-agents`](https://github.com/openai/openai-agents-python)

OpenAI's current docs describe the Agents SDK as the orchestration layer for building agents in Python or TypeScript, and the official TypeScript package README shows installation via `npm install @openai/agents zod`. The current Python SDK is distributed as `openai-agents`. Sources:

- [Agents SDK guide](https://developers.openai.com/api/docs/guides/agents-sdk/)
- [Developer quickstart: Build agents](https://developers.openai.com/api/docs/quickstart/#build-agents)
- [OpenAI Agents SDK JS repository](https://github.com/openai/openai-agents-js)
- [OpenAI Agents SDK Python repository](https://github.com/openai/openai-agents-python)

In this repo, CIP uses those SDKs as runtime adapters, not as the source of truth for protocol state.

## Packages

### `typescript/packages/cip`

TypeScript package published as `@new-odyssey/cip`.

Includes:

- control-plane record types
- repository contracts and in-memory repositories
- `CipControlPlane` orchestration service
- `createCipControlPlaneAgent()` built on `@openai/agents`

### `python/packages/cip`

Python package published as `new-odyssey-cip`.

Includes:

- dataclass-based control-plane records
- repository protocols and in-memory repositories
- `CipControlPlane` orchestration service
- `create_cip_control_plane_agent()` built on `openai-agents`

## Development

### TypeScript

```bash
npm install
npm run build:ts
npm run test:ts
```

### Python

```bash
python3 -m venv .venv
.venv/bin/pip install -e python/packages/cip
npm run test:py
```

### Full validation

```bash
npm test
```

## Open-Source Boundary

Open source here:

- protocol records
- repository interfaces
- in-memory adapters
- control-plane orchestration
- OpenAI Agents SDK examples/adapters

Not included here:

- production database adapters
- credential vault integrations
- full Pantheon operations layer
- proprietary policy engines
- cross-run enterprise analytics

## Next Steps

- add database-backed repositories
- add Workday MCP connector packages
- add runtime-specific tracing hooks
- split connectors into their own packages as the monorepo grows

## License

MIT
