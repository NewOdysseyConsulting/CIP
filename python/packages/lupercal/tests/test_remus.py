from __future__ import annotations

import unittest

from new_odyssey_cip import (
    GuardrailDefinition,
    PolicyClause,
    PolicyCondition,
    PolicyEvaluationContext,
    PolicyPack,
    PolicyRule,
)
from new_odyssey_lupercal import (
    DeterministicPolicyEvaluator,
    create_default_guardrail_catalog,
)

NOW = "2026-03-18T00:00:00+00:00"


def build_policy_pack() -> PolicyPack:
    return PolicyPack(
        id="policy-pack-1",
        created_at=NOW,
        updated_at=NOW,
        revision=1,
        key="workday-security-baseline",
        name="Workday Security Baseline",
        domain="security",
        version="1.0.0",
        ownership="shared",
        rules=[
            PolicyRule(
                id="least-privilege",
                name="Least Privilege",
                severity="high",
                action="flag",
                clauses=[
                    PolicyClause(
                        id="scope-delta",
                        name="scope-delta",
                        match="all",
                        conditions=[
                            PolicyCondition(
                                path="permissions.delta",
                                operator="gt",
                                value=0,
                            )
                        ],
                    )
                ],
            )
        ],
        guardrail_refs=[],
        status="active",
    )


def build_tenant_boundary_guardrail() -> GuardrailDefinition:
    return GuardrailDefinition(
        id="guardrail-1",
        created_at=NOW,
        updated_at=NOW,
        revision=1,
        key="tenant_boundary",
        version="1.0.0",
        name="Tenant Boundary",
        configuration={
            "clauses": [
                PolicyClause(
                    id="tenant-boundary",
                    name="tenant-boundary",
                    match="all",
                    conditions=[
                        PolicyCondition(
                            path="tenant.allowed",
                            operator="eq",
                            value=True,
                        )
                    ],
                )
            ]
        },
        status="active",
    )


class RemusTests(unittest.TestCase):
    def test_deterministic_evaluator_flags_matched_rules_and_guardrails(self) -> None:
        evaluator = DeterministicPolicyEvaluator()
        guardrail = build_tenant_boundary_guardrail()

        decision = evaluator.evaluate(
            build_policy_pack(),
            PolicyEvaluationContext(
                tenant_id="tenant-1",
                deployment_id="deployment-1",
                facts={"permissions": {"delta": 2}, "tenant": {"allowed": True}},
            ),
            [guardrail],
        )

        self.assertEqual(decision.action, "flag")
        self.assertEqual(decision.matched_rule_ids, ["least-privilege"])
        self.assertEqual(decision.triggered_guardrail_ids, [guardrail.id])
        self.assertEqual(decision.evidence_refs[0].type, "policy-pack")

    def test_deterministic_evaluator_allows_and_reports_failed_clauses(self) -> None:
        evaluator = DeterministicPolicyEvaluator()

        decision = evaluator.evaluate(
            build_policy_pack(),
            PolicyEvaluationContext(
                tenant_id="tenant-1",
                facts={"permissions": {"delta": 0}, "tenant": {"allowed": False}},
            ),
        )

        self.assertEqual(decision.action, "allow")
        self.assertEqual(decision.matched_rule_ids, [])
        self.assertEqual(decision.failed_clause_ids, ["scope-delta"])
        self.assertEqual(decision.triggered_guardrail_ids, [])

    def test_default_guardrail_catalog_keys(self) -> None:
        catalog = create_default_guardrail_catalog()
        self.assertEqual(
            [definition.key for definition in catalog],
            [
                "tenant_boundary",
                "pii_boundary",
                "least_privilege",
                "manual_review_required",
                "data_residency",
            ],
        )
        for definition in catalog:
            self.assertEqual(definition.status, "active")


if __name__ == "__main__":
    unittest.main()
