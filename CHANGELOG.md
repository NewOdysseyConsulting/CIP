# Changelog

All notable changes to this repository are documented here.

The project is currently in prerelease. Breaking changes are still possible between alpha releases.

## 0.2.0-alpha.0 - 2026-03-18

- Added a deployable TypeScript control plane with API, worker, and migration CLI packages.
- Added hosted runtime/session APIs, async ingest queue handling, dead-letter storage, and retention cleanup.
- Added operator bootstrap and admin APIs for tenants, connectors, credentials, policies, guardrails, blueprints, deployments, and API keys.
- Added JWT-based operator auth with `hs256` dev mode and `jwks-rs256` production mode.
- Added hybrid SDK transports for TypeScript and Python, including local and HTTP runtime clients plus HTTP admin clients.
- Added `CipRunTracker` polling helpers, typed transport errors, ingest-job access, and prerelease packaging metadata.
- Added pluggable secret and connector backend registries, including AWS Secrets Manager and a generic HTTP JSON connector backend.
- Added Helm and Terraform assets for self-hosted control-plane deployments.
