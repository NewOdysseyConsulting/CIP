# Contributing

## Scope

This repository is the infrastructure layer for New Odyssey's Common Infrastructure Protocol:

- public SDKs for TypeScript and Python
- a deployable TypeScript control plane
- shared schemas, migrations, and deployment assets

Product-specific frameworks and agents belong on top of CIP, not inside it.

## Before you open a change

- Prefer opening an issue or discussion for large API or schema changes.
- Keep TypeScript and Python public surfaces aligned when the feature is meant to exist in both SDKs.
- Preserve the boundary that OpenAI Agents SDK executes agents while CIP provides governance, persistence, audit, approvals, quotas, and transport APIs around execution.

## Development setup

Requirements:

- Node.js `22+`
- Python `3.10+`
- a local virtual environment at `.venv`

Install and verify:

```bash
npm ci
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e python/packages/cip
npm run build
npm test
```

Optional infrastructure checks:

```bash
helm template lupercal lupercal/infra/helm/lupercal >/dev/null
cd lupercal/infra/terraform/kubernetes/lupercal
terraform init -backend=false
terraform validate
```

## Change guidelines

- Add tests for behavioral changes.
- Update schemas and docs when public contracts change.
- Do not persist raw secret material in CIP records.
- Keep immutable release resources immutable:
  - policy packs
  - guardrail definitions
  - agent blueprints
- Treat audit and replay behavior as compatibility-sensitive.

## Pull requests

Include:

- the problem being solved
- the public API or schema impact
- verification performed
- any follow-up work intentionally left out

## Release policy

- Current releases are prerelease only.
- Use alpha tags for npm and PyPI publication.
- Update [CHANGELOG.md](/Users/ademolaafolabi/Documents/GitHub/CIP/CHANGELOG.md) for user-visible changes.
