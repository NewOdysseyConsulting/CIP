# Compatibility

This matrix describes the currently tested prerelease baseline for CIP and the staged Lupercal implementation.

| Component | Supported baseline |
| --- | --- |
| Node.js | `22.x` |
| Python | `3.10` to `3.12` |
| TypeScript SDK package | `@new-odyssey/cip@0.3.0-alpha.x` |
| Conformance package | `@new-odyssey/cip-conformance@0.3.0-alpha.x` |
| Python SDK package | `new-odyssey-cip==0.3.0a*` |
| OpenAI Agents SDK (TypeScript) | version range declared in [`typescript/packages/cip/package.json`](../typescript/packages/cip/package.json) |
| OpenAI Agents SDK (Python) | version range declared in [`python/packages/cip/pyproject.toml`](../python/packages/cip/pyproject.toml) |
| Postgres (Lupercal/Romulus) | `15+` recommended |
| Kubernetes | `1.29+` recommended for the Helm/Terraform deployment path |

## Stability

- `0.3.0-alpha.x` is prerelease.
- The protocol spec in [`spec/`](../spec/README.md) is Draft 0.2: object shapes and the `/v1` HTTP binding may still change in breaking ways between alpha releases.
- The core direction is stable: CIP as the open protocol (spec, schemas, SDKs, reference adapters, conformance tools), Lupercal as the production platform implementing it.

## Upgrade expectation

- Treat alpha-to-alpha upgrades as planned engineering work, not transparent patch upgrades.
- Read [CHANGELOG.md](../CHANGELOG.md) before upgrading — the 0.3 line moved Postgres persistence and the policy engine out of the SDKs into the Lupercal packages and renamed service environment variables to `LUPERCAL_*`.
- Re-run your connector, policy, and approval-flow tests — and the conformance suite against any platform you operate — after each prerelease update.
