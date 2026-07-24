from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .records import (
    GuardrailDefinition,
    PolicyPack,
    PolicyRuleAction,
)


@dataclass(slots=True)
class PolicyEvaluationContext:
    tenant_id: str
    facts: dict[str, Any]
    deployment_id: str | None = None
    session_id: str | None = None


@dataclass(slots=True)
class PolicyEvidenceReference:
    type: str
    id: str
    detail: str | None = None


@dataclass(slots=True)
class PolicyDecision:
    action: PolicyRuleAction
    matched_rule_ids: list[str]
    failed_clause_ids: list[str]
    triggered_guardrail_ids: list[str]
    explanation: str
    evidence_refs: list[PolicyEvidenceReference]


class PolicyEvaluator(Protocol):
    def evaluate(
        self,
        policy_pack: PolicyPack,
        context: PolicyEvaluationContext,
        guardrails: list[GuardrailDefinition] | None = None,
    ) -> PolicyDecision: ...
