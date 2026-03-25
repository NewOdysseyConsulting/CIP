# EU AI Act Support in CIP

CIP is a compliance-enabling control plane for AI systems. It helps teams implement and evidence parts of an EU AI Act operating model, but it does not by itself make an application “EU AI Act compliant.”

## What CIP Now Supports

- deployment-scoped `ComplianceProfile` records for EU AI Act configuration
- high-risk deployment activation gates driven by required compliance artifacts
- `ComplianceArtifact` records for technical documentation and adjacent governance evidence
- `DisclosureRecord` records for transparency notices shown to end users
- `HumanReviewRecord` records for operator review decisions
- trusted actor provenance with `actorVerification` and `assertedActor`
- enriched replay and evidence bundles that include compliance state

## What CIP Does Not Do

- render banners, first-message notices, or other UI disclosures for you
- decide your legal risk tier automatically
- generate your legal documentation or register systems with regulators automatically
- replace legal review, product review, or human operator procedures

Your application is still responsible for presenting disclosure text to end users and for calling CIP when the notice has actually been shown.

## Compliance Model

Each deployment can now have one `ComplianceProfile` with:

- regime: currently `eu-ai-act`
- EU scope: whether the deployment serves EU users
- intended purpose
- risk tier
- optional high-risk basis
- transparency requirements
- oversight requirements
- logging requirements

For high-risk deployments, CIP blocks transition to `active` until required artifacts are present in acceptable states:

- `technical_documentation = approved`
- `fundamental_rights_impact_assessment = approved`
- `conformity_assessment = approved`
- `eu_declaration_of_conformity = filed`
- `eu_database_registration = filed`
- `post_market_monitoring_plan = approved`

## Trusted Provenance

Generic event ingestion remains available, but CIP no longer treats caller-supplied actors as trusted human identities.

- `actor` is the verified actor persisted by the server or control plane
- `assertedActor` preserves the caller-reported identity when one was supplied
- `actorVerification` distinguishes `system`, `authenticated-sdk`, `authenticated-operator`, and `asserted`

This lets operators and auditors tell the difference between:

- a verified operator approval
- an SDK-authenticated runtime action
- a client-asserted identity embedded in an event payload

## Limited-Risk Flow

Example: customer support chatbot serving EU users.

1. Create or update the deployment `ComplianceProfile` with:
   - `riskTier = limited`
   - `transparency.required = true`
   - appropriate notice text
2. Before the first user-facing interaction, fetch the deployment compliance profile.
3. Render the required disclosure in your application UI.
4. Call `POST /v1/sessions/{sessionId}:record-disclosure`.
5. Complete the session normally.

If disclosure is required and no disclosure record exists, CIP rejects session completion.

## High-Risk Flow

Example: employment screening, legal intake, or another high-risk use case.

1. Create or update the deployment `ComplianceProfile` with:
   - `riskTier = high-risk`
   - high-risk basis
   - disclosure requirements if applicable
   - oversight requirements, including review count
2. Create required `ComplianceArtifact` records for the deployment.
3. Attempt to transition the deployment to `active`.
4. CIP blocks activation until the required artifacts are present in the required states.
5. During runtime:
   - record disclosure if required
   - record operator review with `POST /v1/sessions/{sessionId}:record-human-review`
6. Complete the session only after oversight requirements are met.
7. Export replay and evidence bundles for regulator or internal review.

## Evidence Bundle Contents

Evidence bundles now include:

- run event IDs
- audit event IDs
- disclosure record IDs
- human review record IDs
- compliance artifact IDs
- compliance profile snapshot captured on session start
- blueprint, policy pack, and guardrail version references

This gives you a single session-scoped evidence object that can be joined back to the relevant deployment compliance state.

## Recommended Integration Pattern

- use admin APIs to manage compliance profiles and artifacts per deployment
- use runtime APIs to fetch compliance profile requirements before interaction
- render disclosure in the host application
- record disclosure and human review through CIP
- use replay and evidence bundles as the audit export surface

## Public Surfaces

Runtime routes:

- `GET /v1/deployments/{deploymentId}/compliance-profile`
- `POST /v1/sessions/{sessionId}:record-disclosure`
- `POST /v1/sessions/{sessionId}:record-human-review`

Admin routes:

- `GET /v1/admin/deployments/{deploymentId}/compliance-profile`
- `PUT /v1/admin/deployments/{deploymentId}/compliance-profile`
- `GET /v1/admin/deployments/{deploymentId}/compliance-artifacts`
- `POST /v1/admin/deployments/{deploymentId}/compliance-artifacts`
