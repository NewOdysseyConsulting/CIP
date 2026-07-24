# Changelog

All notable changes to this repository are documented here.

The project is currently in prerelease. Breaking changes are still possible between alpha releases.

## 0.3.0-alpha.0 - 2026-07-24

CIP is now the open interoperability protocol for governed agent operations; the commercial implementation is repositioned as the Lupercal platform (Romulus for state/execution, Remus for policy/approvals).

- Added the protocol specification under `spec/`: interchange domains for identity/capabilities, workflow state, policy decisions, approvals, evidence/citations, audit events, task delegation, execution outcomes, and trace correlation, plus conformance requirements.
- Added `@new-odyssey/cip-conformance`, a runnable conformance suite and CLI for CIP platform implementations (in-memory reference by default, hosted platforms via `--base-url`).
- Added `PolicyDecision`, `PolicyEvaluationContext`, `PolicyEvidenceReference`, and `TraceCorrelation` definitions to the JSON schema.
- **Breaking:** moved Postgres persistence out of the SDKs into Lupercal's Romulus (`@new-odyssey/romulus`, `new_odyssey_lupercal.romulus`); `createPostgresCipRepositories` and `PHASE1_POSTGRES_MIGRATION_SQL` are no longer exported from `@new-odyssey/cip` / `new_odyssey_cip`.
- **Breaking:** moved the deterministic policy evaluator and default guardrail catalog into Lupercal's Remus (`@new-odyssey/remus`, `new_odyssey_lupercal.remus`); the SDKs keep only the `PolicyEvaluator` interface and decision types.
- **Breaking:** renamed the deployable services to `@new-odyssey/lupercal-api`, `@new-odyssey/lupercal-worker`, and `@new-odyssey/lupercal-migrate`, now under `lupercal/services/`; service environment variables are renamed `CIP_*` → `LUPERCAL_*`.
- **Breaking:** moved Helm/Terraform/SQL assets under `lupercal/infra` and `lupercal/sql`; the Helm chart is now named `lupercal` and default images/secrets/issuers use Lupercal naming.

## 0.2.0-alpha.0 - 2026-03-18

- Added a deployable TypeScript control plane with API, worker, and migration CLI packages.
- Added hosted runtime/session APIs, async ingest queue handling, dead-letter storage, and retention cleanup.
- Added operator bootstrap and admin APIs for tenants, connectors, credentials, policies, guardrails, blueprints, deployments, and API keys.
- Added JWT-based operator auth with `hs256` dev mode and `jwks-rs256` production mode.
- Added hybrid SDK transports for TypeScript and Python, including local and HTTP runtime clients plus HTTP admin clients.
- Added `CipRunTracker` polling helpers, typed transport errors, ingest-job access, and prerelease packaging metadata.
- Added pluggable secret and connector backend registries, including AWS Secrets Manager and a generic HTTP JSON connector backend.
- Added Helm and Terraform assets for self-hosted control-plane deployments.
