from __future__ import annotations

import re
from typing import Any

from new_odyssey_cip.policy import (
    PolicyDecision,
    PolicyEvaluationContext,
    PolicyEvidenceReference,
)
from new_odyssey_cip.records import (
    GuardrailDefinition,
    PolicyClause,
    PolicyCondition,
    PolicyPack,
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


def _guardrail_clause(identifier: str, path: str, value: object | None = None) -> PolicyClause:
    return PolicyClause(
        id=identifier,
        name=identifier,
        match="all",
        conditions=[
            PolicyCondition(
                path=path,
                operator="exists" if value is None else "eq",
                value=value,
            )
        ],
    )


def create_default_guardrail_catalog() -> list[GuardrailDefinition]:
    now = "2026-03-18T00:00:00+00:00"
    return [
        GuardrailDefinition(
            id="guardrail-tenant-boundary",
            created_at=now,
            updated_at=now,
            revision=1,
            key="tenant_boundary",
            version="1.0.0",
            name="Tenant Boundary",
            configuration={"clauses": [_guardrail_clause("tenant-boundary", "tenant.allowed", True)]},
            status="active",
        ),
        GuardrailDefinition(
            id="guardrail-pii-boundary",
            created_at=now,
            updated_at=now,
            revision=1,
            key="pii_boundary",
            version="1.0.0",
            name="PII Boundary",
            configuration={"clauses": [_guardrail_clause("pii-boundary", "pii.detected", True)]},
            status="active",
        ),
        GuardrailDefinition(
            id="guardrail-least-privilege",
            created_at=now,
            updated_at=now,
            revision=1,
            key="least_privilege",
            version="1.0.0",
            name="Least Privilege",
            configuration={
                "clauses": [
                    PolicyClause(
                        id="least-privilege-check",
                        name="least-privilege-check",
                        match="all",
                        conditions=[PolicyCondition(path="permissions.delta", operator="gt", value=0)],
                    )
                ]
            },
            status="active",
        ),
        GuardrailDefinition(
            id="guardrail-manual-review-required",
            created_at=now,
            updated_at=now,
            revision=1,
            key="manual_review_required",
            version="1.0.0",
            name="Manual Review Required",
            configuration={"clauses": [_guardrail_clause("manual-review", "review.required", True)]},
            status="active",
        ),
        GuardrailDefinition(
            id="guardrail-data-residency",
            created_at=now,
            updated_at=now,
            revision=1,
            key="data_residency",
            version="1.0.0",
            name="Data Residency",
            configuration={"clauses": [_guardrail_clause("data-residency", "region.allowed", True)]},
            status="active",
        ),
    ]
