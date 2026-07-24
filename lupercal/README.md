# Lupercal

Lupercal is New Odyssey's commercial AI control platform: the production implementation of the [CIP protocol](../spec/README.md). Pegasus agents represent governed runs and evidence in CIP; Lupercal executes and controls those runs.

```text
CIP        — open interoperability protocol (spec, schemas, SDKs, conformance)
   ↓ implemented by
Lupercal   — commercial control platform
   ├── Romulus: state, workflow execution, recovery, durable coordination
   └── Remus:  rules, policy, permissions, human approvals
```

> **Boundary note:** this directory stages the commercial implementation ahead of extraction into the private Lupercal repository. It is not part of the CIP open-source surface, which consists of the spec, schemas, SDKs, reference adapters, and conformance tools at the repository root.

## Layout

| Path | Package | Role |
| --- | --- | --- |
| `romulus/` | `@new-odyssey/romulus` | Durable state: Postgres repositories, phase-1 migration SQL |
| `remus/` | `@new-odyssey/remus` | Policy engine: deterministic evaluator, default guardrail catalog |
| `services/api/` | `@new-odyssey/lupercal-api` | Hosted control-plane API (runtime `/v1` + admin `/v1/admin`) |
| `services/worker/` | `@new-odyssey/lupercal-worker` | Ingest queue processing, retries, dead-lettering, retention |
| `services/migrate/` | `@new-odyssey/lupercal-migrate` | Migration runner and bootstrap CLI |
| `sql/postgres/` | — | Schema migrations |
| `infra/helm/lupercal/` | — | Helm chart |
| `infra/terraform/kubernetes/lupercal/` | — | Terraform module wrapping the chart |

Romulus and Remus implement interfaces defined by the open `@new-odyssey/cip` SDK (`CipRepositories`, `PolicyEvaluator`); the services compose them with the shared control-plane engine.

## Configuration

API service:

- `LUPERCAL_DATABASE_URL`
- `LUPERCAL_OPERATOR_AUTH_MODE` (`hs256` or `jwks-rs256`)
- `LUPERCAL_OPERATOR_SHARED_SECRET` (hs256) or `LUPERCAL_OPERATOR_JWKS_URL` (jwks-rs256)
- optional: `HOST`, `PORT`, `LUPERCAL_OPERATOR_ISSUER`, `LUPERCAL_OPERATOR_AUDIENCE`, `LUPERCAL_RUN_MIGRATIONS_ON_STARTUP`

Worker:

- `LUPERCAL_DATABASE_URL`
- `LUPERCAL_WORKER_POLL_INTERVAL_MS`, `LUPERCAL_WORKER_MAX_ATTEMPTS`
- `LUPERCAL_RETENTION_WINDOW_HOURS`, `LUPERCAL_RETENTION_SWEEP_EVERY_LOOPS`

## Local quickstart

```bash
npm install
npm run build:ts
export LUPERCAL_DATABASE_URL=postgres://postgres:postgres@localhost:5432/lupercal
export LUPERCAL_OPERATOR_AUTH_MODE=hs256
export LUPERCAL_OPERATOR_SHARED_SECRET=replace-me
npm run start --workspace @new-odyssey/lupercal-migrate -- migrate
npm run start --workspace @new-odyssey/lupercal-api
```

Run the worker in a second shell:

```bash
npm run start --workspace @new-odyssey/lupercal-worker
```

Bootstrap CLI commands (`@new-odyssey/lupercal-migrate`): `migrate`, `seed-tenant --json <path|->`, `issue-api-key --json <path|->`, `revoke-api-key --api-key-id <id>`, `publish-bootstrap-resources --json <path|->`.

## Verifying protocol conformance

```bash
npx cip-conformance --base-url http://localhost:8080 --api-key $CIP_API_KEY --operator-token $OPERATOR_TOKEN
```
