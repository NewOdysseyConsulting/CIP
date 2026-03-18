from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Protocol

from .records import (
    GuardrailDefinition,
    PolicyClause,
    PolicyCondition,
    PolicyPack,
    PolicyRule,
    PolicyRuleAction,
)


def _get_value_at_path(source: dict[str, Any], path: str) -> Any:
    current: Any = source
    for segment in path.split("."):
        if not isinstance(current, dict) or segment not in current:
            return None
        current = current[segment]
    return current


def _matches_condition(condition: PolicyCondition, facts: dict[str, Any]) -> bool:
    actual = _get_value_at_path(facts, condition.path)
    if condition.operator == "eq":
        return actual == condition.value
    if condition.operator == "neq":
        return actual != condition.value
    if condition.operator == "in":
        return isinstance(condition.value, list) and actual in condition.value
    if condition.operator == "contains":
        if isinstance(actual, list):
            return condition.value in actual
        if isinstance(actual, str) and isinstance(condition.value, str):
            return condition.value in actual
        return False
    if condition.operator == "exists":
        return actual is not None
    if condition.operator == "regex":
        return isinstance(actual, str) and isinstance(condition.value, str) and re.search(condition.value, actual) is not None
    if condition.operator == "gt":
        return isinstance(actual, (int, float)) and isinstance(condition.value, (int, float)) and actual > condition.value
    if condition.operator == "gte":
        return isinstance(actual, (int, float)) and isinstance(condition.value, (int, float)) and actual >= condition.value
    if condition.operator == "lt":
        return isinstance(actual, (int, float)) and isinstance(condition.value, (int, float)) and actual < condition.value
    if condition.operator == "lte":
        return isinstance(actual, (int, float)) and isinstance(condition.value, (int, float)) and actual <= condition.value
    return False


def _matches_clause(clause: PolicyClause, facts: dict[str, Any]) -> bool:
    results = [_matches_condition(condition, facts) for condition in clause.conditions]
    return all(results) if clause.match == "all" else any(results)


def _guardrail_triggered(definition: GuardrailDefinition, facts: dict[str, Any]) -> bool:
    clauses = definition.configuration.get("clauses")
    if not isinstance(clauses, list) or not clauses:
        return False
    return all(
        _matches_clause(clause, facts)
        for clause in clauses
        if isinstance(clause, PolicyClause)
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


class DeterministicPolicyEvaluator:
    _action_weight = {"allow": 0, "flag": 1, "escalate": 2, "block": 3}

    def evaluate(
        self,
        policy_pack: PolicyPack,
        context: PolicyEvaluationContext,
        guardrails: list[GuardrailDefinition] | None = None,
    ) -> PolicyDecision:
        matched_rule_ids: list[str] = []
        failed_clause_ids: list[str] = []
        action = "allow"

        for rule in policy_pack.rules:
            clauses = rule.clauses or []
            if not clauses:
                continue
            matched = all(_matches_clause(clause, context.facts) for clause in clauses)
            if matched:
                matched_rule_ids.append(rule.id)
                if self._action_weight[rule.action] > self._action_weight[action]:
                    action = rule.action
            else:
                for clause in clauses:
                    if not _matches_clause(clause, context.facts):
                        failed_clause_ids.append(clause.id)

        triggered_guardrail_ids = [
            definition.id
            for definition in (guardrails or [])
            if _guardrail_triggered(definition, context.facts)
        ]
        explanation = (
            f"Matched {len(matched_rule_ids)} rule(s) in {policy_pack.key}."
            if matched_rule_ids
            else f"No rules matched in {policy_pack.key}."
        )

        return PolicyDecision(
            action=action,
            matched_rule_ids=matched_rule_ids,
            failed_clause_ids=failed_clause_ids,
            triggered_guardrail_ids=triggered_guardrail_ids,
            explanation=explanation,
            evidence_refs=[
                PolicyEvidenceReference(
                    type="policy-pack",
                    id=policy_pack.id,
                    detail=f"{policy_pack.key}@{policy_pack.version}",
                ),
                *[
                    PolicyEvidenceReference(type="guardrail-definition", id=guardrail_id)
                    for guardrail_id in triggered_guardrail_ids
                ],
            ],
        )
