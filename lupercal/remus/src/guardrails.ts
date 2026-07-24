import type { GuardrailDefinition, PolicyClause } from "@new-odyssey/cip";

const guardrailClause = (
  id: string,
  path: string,
  value?: unknown,
): PolicyClause => ({
  id,
  name: id,
  match: "all",
  conditions: [
    {
      path,
      operator: value === undefined ? "exists" : "eq",
      ...(value === undefined ? {} : { value }),
    },
  ],
});

export const createDefaultGuardrailCatalog = (): GuardrailDefinition[] => {
  const now = new Date().toISOString();

  return [
    {
      id: "guardrail-tenant-boundary",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      key: "tenant_boundary",
      version: "1.0.0",
      name: "Tenant Boundary",
      configuration: {
        clauses: [guardrailClause("tenant-boundary", "tenant.allowed", true)],
      },
      status: "active",
    },
    {
      id: "guardrail-pii-boundary",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      key: "pii_boundary",
      version: "1.0.0",
      name: "PII Boundary",
      configuration: {
        clauses: [guardrailClause("pii-boundary", "pii.detected", true)],
      },
      status: "active",
    },
    {
      id: "guardrail-least-privilege",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      key: "least_privilege",
      version: "1.0.0",
      name: "Least Privilege",
      configuration: {
        clauses: [
          {
            id: "least-privilege-check",
            name: "least-privilege-check",
            match: "all",
            conditions: [
              {
                path: "permissions.delta",
                operator: "gt",
                value: 0,
              },
            ],
          },
        ],
      },
      status: "active",
    },
    {
      id: "guardrail-manual-review-required",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      key: "manual_review_required",
      version: "1.0.0",
      name: "Manual Review Required",
      configuration: {
        clauses: [guardrailClause("manual-review", "review.required", true)],
      },
      status: "active",
    },
    {
      id: "guardrail-data-residency",
      createdAt: now,
      updatedAt: now,
      revision: 1,
      key: "data_residency",
      version: "1.0.0",
      name: "Data Residency",
      configuration: {
        clauses: [guardrailClause("data-residency", "region.allowed", true)],
      },
      status: "active",
    },
  ];
};
