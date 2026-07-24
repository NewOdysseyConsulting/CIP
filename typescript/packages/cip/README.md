# @new-odyssey/cip

TypeScript SDK for CIP, the open protocol for governed agent operations.

This package provides the protocol types, client surface, and reference implementation for Node.js teams:

- protocol types for every CIP interchange domain (see [`spec/`](../../../spec/README.md))
- `CipClient` and `CipAdminClient`
- `LocalCipControlPlaneTransport`, `HttpCipControlPlaneTransport`, `HttpCipAdminTransport`
- `CipControlPlane` + in-memory repositories: the non-durable reference implementation
- `CipRunTracker`
- the `PolicyEvaluator` interface (engines such as Lupercal's Remus implement it)
- `SecretBackendRegistry`, `AwsSecretsManagerSecretBackend`
- `ConnectorBackendRegistry`, `HttpJsonConnectorBackend`
- OpenAI Agents SDK reference runtime adapter

Durable persistence and the production policy engine live in Lupercal — New Odyssey's commercial platform, maintained in its own repository — not in this SDK.

From this monorepo:

```bash
npm install
npm run build --workspace @new-odyssey/cip
```

Example:

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

For the protocol specification, conformance tooling, and architecture notes, see the [root README](../../../README.md) and [`spec/`](../../../spec/README.md).
