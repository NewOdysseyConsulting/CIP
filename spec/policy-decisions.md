# Policy Decisions

CIP separates the *description* of policy from the *engine* that evaluates it. Policy packs, guardrails, evaluation contexts, and decisions are protocol objects; the evaluator is pluggable (`PolicyEvaluator` interface). Lupercal's Remus subsystem is one such engine — any engine that consumes and produces these shapes interoperates.

## Describing policy

**PolicyPack** — a versioned, immutable bundle of rules for one `domain` (`platform`, `security`, `expense`, `recruitment`, `onboarding`), owned `shared` or per-`tenant`. Each **PolicyRule** carries `severity`, an `action` (`allow` < `flag` < `escalate` < `block`, in ascending precedence), and either declarative `clauses` or an opaque `expression`.

**PolicyClause / PolicyCondition** — declarative matching over a facts document: a JSON-path-style `path`, an `operator` from the closed set `eq, neq, in, contains, exists, regex, gt, gte, lt, lte`, and an optional `value`. A clause matches `all` or `any` of its conditions.

**GuardrailDefinition** — a versioned, named boundary (`tenant_boundary`, `pii_boundary`, `least_privilege`, `manual_review_required`, `data_residency`, or custom keys) whose `configuration.clauses` reuse the same clause shape. Guardrails are referenced from policy packs (`guardrailRefs`) and blueprints.

## Asking for a decision

**PolicyEvaluationContext** — `tenantId`, optional `deploymentId`/`sessionId`, and `facts`: a JSON object of everything the engine may condition on. Producers MUST put all decision-relevant state into `facts`; engines MUST NOT reach outside the context.

## The decision

**PolicyDecision** — the interchange result:

| Field | Meaning |
| --- | --- |
| `action` | Highest-precedence action among matched rules (`allow` if none matched) |
| `matchedRuleIds` / `failedClauseIds` | Which rules fired and which clauses blocked others |
| `triggeredGuardrailIds` | Guardrails whose clauses all matched the facts |
| `explanation` | Human-readable rationale |
| `evidenceRefs` | `PolicyEvidenceReference` list — see [evidence-and-citations.md](evidence-and-citations.md) |

## Requirements

- Decisions MUST be recorded as `policy_decided` run events (and `guardrail_triggered` events when applicable) so the decision is replayable from the event stream.
- Evaluation MUST be deterministic for a given (pack version, context, guardrail versions) triple; nondeterministic engines MUST record enough evidence to reproduce their decision.
- An `escalate` decision routes into the approval flow ([approvals.md](approvals.md)); a `block` decision MUST prevent the governed action and SHOULD fail or pause the session rather than silently continuing.
- Decisions MUST cite the policy pack version they evaluated (`evidenceRefs` carrying `key@version`), because packs are immutable per version.
