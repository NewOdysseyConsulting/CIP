# new-odyssey-cip

Python SDK for CIP, the open protocol for governed agent operations.

This package provides the protocol types, client surface, and reference implementation for Python teams:

- protocol dataclasses for every CIP interchange domain (see [`spec/`](../../../spec/README.md))
- `CipClient` and `CipAdminClient`
- `LocalCipControlPlaneTransport`, `HttpCipControlPlaneTransport`, `HttpCipAdminTransport`
- `CipControlPlane` + in-memory repositories: the non-durable reference implementation
- `CipRunTracker`
- the `PolicyEvaluator` protocol (engines such as Lupercal's Remus implement it)
- `SecretBackendRegistry`, `AwsSecretsManagerSecretBackend`
- `ConnectorBackendRegistry`, `HttpJsonConnectorBackend`
- OpenAI Agents SDK reference runtime adapter

Durable persistence and the production policy engine live in Lupercal — New Odyssey's commercial platform, maintained in its own repository — not in this SDK.

Install from this monorepo:

```bash
python3 -m venv .venv
.venv/bin/pip install -e python/packages/cip
```

Example:

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

For the protocol specification, conformance tooling, and architecture notes, see the [root README](../../../README.md) and [`spec/`](../../../spec/README.md).
