# @new-odyssey/cip

TypeScript SDK for the Common Infrastructure Protocol.

This package provides the core CIP library surface for Node.js teams:

- `CipControlPlane`
- `CipClient`
- `CipAdminClient`
- `LocalCipControlPlaneTransport`
- `HttpCipControlPlaneTransport`
- `HttpCipAdminTransport`
- `CipRunTracker`
- `SecretBackendRegistry`
- `AwsSecretsManagerSecretBackend`
- `ConnectorBackendRegistry`
- `HttpJsonConnectorBackend`
- in-memory and Postgres repository factories
- OpenAI Agents SDK runtime integration

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

For the full repo guide, hosted control-plane setup, and architecture notes, see the [root README](../../../README.md).
