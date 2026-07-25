# Evidence and Citations

Evidence is how a CIP implementation proves, after the fact, what happened and under which rules. The protocol defines a projection — the `EvidenceBundle` — plus the citation shapes that link decisions back to their sources.

## EvidenceBundle

A per-session projection assembled from immutable inputs:

| Field | Meaning |
| --- | --- |
| `agentBlueprintId` / `agentBlueprintVersion` | Exactly which agent identity acted |
| `policyPackVersions`, `guardrailVersions` | `DependencyVersionReference` (`id`, `key`, `version`) for every rule surface in force |
| `runEventIds`, `auditEventIds` | The full event trail backing the summary |
| `complianceProfile` | Snapshot of the profile governing the session, if any |
| `disclosureRecordIds`, `humanReviewIds`, `complianceArtifactIds` | Oversight and transparency evidence |
| `summary`, `generatedAt` | Human-readable digest and projection time |

Bundles are generated, not authored: an implementation MUST derive the bundle from stored records so that regenerating it yields the same content (aside from `generatedAt`).

## Citations

**PolicyEvidenceReference** — the citation unit inside a `PolicyDecision`: `type` (`policy-pack` \| `guardrail-definition` \| `fact`), `id`, and optional `detail` (conventionally `key@version` for versioned sources). Every decision cites at least the policy pack it evaluated.

## Transparency and oversight records

- **DisclosureRecord** — proof an AI disclosure was presented (`surface`: `banner`, `first_message`, or both; `presentedAt`, optional `acknowledgedAt`, `disclosureVersion`). The platform records disclosures; rendering them is the application's job.
- **HumanReviewRecord** — a verified reviewer's `approved`/`rejected` verdict on session output.
- **ComplianceArtifact** — long-lived documentation evidence (technical documentation, conformity assessment, EU database registration, etc.) with `status` lifecycle `draft` → `approved`/`filed`; high-risk deployments gate activation on required artifacts. See [docs/eu-ai-act.md](../docs/eu-ai-act.md) for the EU AI Act application.

## Requirements

- Evidence inputs (events, disclosures, reviews, artifacts) are append-only; corrections are new records, not edits.
- A bundle MUST name concrete versions for every versioned dependency — "the rules at the time", never "the current rules".
- Implementations SHOULD expose bundle retrieval per session (`GET /v1/evidence-bundles/{sessionId}` in the HTTP binding).
