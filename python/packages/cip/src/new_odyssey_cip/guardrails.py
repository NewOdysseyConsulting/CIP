from __future__ import annotations

from .records import GuardrailDefinition, PolicyClause, PolicyCondition


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
