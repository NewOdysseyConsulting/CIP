# new-odyssey-cip

Python SDK for the Common Infrastructure Protocol.

This package provides the core CIP library surface for Python teams:

- `CipControlPlane`
- `CipClient`
- `LocalCipControlPlaneTransport`
- `HttpCipControlPlaneTransport`
- `CipRunTracker`
- in-memory and Postgres repository factories
- OpenAI Agents SDK runtime integration

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

For the full repo guide, hosted control-plane setup, and architecture notes, see the [root README](../../../README.md).
