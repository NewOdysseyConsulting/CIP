# Changelog

All notable changes to this repository are documented here.

The project is currently in prerelease. Breaking changes are still possible between alpha releases.

## 0.3.0-alpha.0 - 2026-07-24

CIP is now the open interoperability protocol for governed agent operations. The commercial implementation — the Lupercal platform, with Romulus for state/execution and Remus for policy/approvals — moved out of this repository into the private Lupercal repository. This repo now contains only the open protocol surface: spec, schemas, SDKs, reference adapters, and conformance tools.

- Added the protocol specification under `spec/`: interchange domains for identity/capabilities, workflow state, policy decisions, approvals, evidence/citations, audit events, task delegation, execution outcomes, and trace correlation, plus conformance requirements.
- Added `@new-odyssey/cip-conformance`, a runnable conformance suite and CLI for CIP platform implementations (in-memory reference by default, hosted platforms via `--base-url`).
- Added `PolicyDecision`, `PolicyEvaluationContext`, `PolicyEvidenceReference`, and `TraceCorrelation` definitions to the JSON schema.
- **Breaking:** removed Postgres persistence from the SDKs; `createPostgresCipRepositories` and `PHASE1_POSTGRES_MIGRATION_SQL` are no longer exported from `@new-odyssey/cip` / `new_odyssey_cip`. Durable state is now Romulus's job inside Lupercal.
- **Breaking:** removed the deterministic policy evaluator and default guardrail catalog from the SDKs; the SDKs keep only the `PolicyEvaluator` interface and decision types. The production policy engine is now Remus's job inside Lupercal.
- **Breaking:** removed the deployable control-plane services (`cip-control-plane-api`/`-worker`/`-migrate`), Helm chart, Terraform module, and SQL migrations from this repository; they continue as Lupercal services in the private repository.
- The SDKs retain the in-process `CipControlPlane` with in-memory repositories as the protocol's non-durable reference implementation.

## 0.2.0-alpha.0 - 2026-03-18

- Added a deployable TypeScript control plane with API, worker, and migration CLI packages.
- Added hosted runtime/session APIs, async ingest queue handling, dead-letter storage, and retention cleanup.
- Added operator bootstrap and admin APIs for tenants, connectors, credentials, policies, guardrails, blueprints, deployments, and API keys.
- Added JWT-based operator auth with `hs256` dev mode and `jwks-rs256` production mode.
- Added hybrid SDK transports for TypeScript and Python, including local and HTTP runtime clients plus HTTP admin clients.
- Added `CipRunTracker` polling helpers, typed transport errors, ingest-job access, and prerelease packaging metadata.
- Added pluggable secret and connector backend registries, including AWS Secrets Manager and a generic HTTP JSON connector backend.
- Added Helm and Terraform assets for self-hosted control-plane deployments.
