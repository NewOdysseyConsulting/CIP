# Compatibility

This matrix describes the currently tested prerelease baseline for CIP.

| Component | Supported baseline |
| --- | --- |
| Node.js | `22.x` |
| Python | `3.10` to `3.12` |
| TypeScript SDK package | `@new-odyssey/cip@0.2.0-alpha.x` |
| Python SDK package | `new-odyssey-cip==0.2.0a*` |
| OpenAI Agents SDK (TypeScript) | version range declared in [`typescript/packages/cip/package.json`](/Users/ademolaafolabi/Documents/GitHub/CIP/typescript/packages/cip/package.json) |
| OpenAI Agents SDK (Python) | version range declared in [`python/packages/cip/pyproject.toml`](/Users/ademolaafolabi/Documents/GitHub/CIP/python/packages/cip/pyproject.toml) |
| Postgres | `15+` recommended |
| Kubernetes | `1.29+` recommended for the Helm/Terraform deployment path |

## Stability

- `0.2.0-alpha.x` is prerelease.
- The hosted control-plane API and both SDKs may still change in breaking ways between alpha releases.
- The core direction is stable: SDK-first APIs, a deployable TypeScript control plane, and OpenAI Agents SDK runtime integration.

## Upgrade expectation

- Treat alpha-to-alpha upgrades as planned engineering work, not transparent patch upgrades.
- Read [CHANGELOG.md](/Users/ademolaafolabi/Documents/GitHub/CIP/CHANGELOG.md) before upgrading.
- Re-run your local connector, policy, and approval-flow tests against each prerelease update.
