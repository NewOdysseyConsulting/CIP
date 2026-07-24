import assert from "node:assert/strict";
import test from "node:test";

import type { GuardrailDefinition, PolicyPack } from "@new-odyssey/cip";

import {
  DeterministicPolicyEvaluator,
  createDefaultGuardrailCatalog,
} from "../src/index.js";

const now = new Date().toISOString();

const policyPack: PolicyPack = {
  id: "policy-pack-1",
  createdAt: now,
  updatedAt: now,
  revision: 1,
  key: "workday-security-baseline",
  name: "Workday Security Baseline",
  domain: "security",
  version: "1.0.0",
  ownership: "shared",
  rules: [
    {
      id: "least-privilege",
      name: "Least Privilege",
      clauses: [
        {
          id: "scope-delta",
          name: "scope-delta",
          match: "all",
          conditions: [
            { path: "permissions.delta", operator: "gt", value: 0 },
          ],
        },
      ],
      severity: "high",
      action: "flag",
    },
  ],
  guardrailRefs: [],
  status: "active",
};

const tenantBoundaryGuardrail: GuardrailDefinition = {
  id: "guardrail-1",
  createdAt: now,
  updatedAt: now,
  revision: 1,
  key: "tenant_boundary",
  version: "1.0.0",
  name: "Tenant Boundary",
  configuration: {
    clauses: [
      {
        id: "tenant-boundary",
        name: "tenant-boundary",
        match: "all",
        conditions: [{ path: "tenant.allowed", operator: "eq", value: true }],
      },
    ],
  },
  status: "active",
};

test("deterministic evaluator escalates matched rules and reports guardrails", () => {
  const evaluator = new DeterministicPolicyEvaluator();

  const decision = evaluator.evaluate(
    policyPack,
    {
      tenantId: "tenant-1",
      deploymentId: "deployment-1",
      facts: {
        permissions: { delta: 2 },
        tenant: { allowed: true },
      },
    },
    [tenantBoundaryGuardrail],
  );

  assert.equal(decision.action, "flag");
  assert.deepEqual(decision.matchedRuleIds, ["least-privilege"]);
  assert.equal(decision.triggeredGuardrailIds[0], tenantBoundaryGuardrail.id);
  assert.equal(decision.evidenceRefs[0]?.type, "policy-pack");
  assert.equal(decision.evidenceRefs[0]?.id, policyPack.id);
});

test("deterministic evaluator allows when no rules match and records failed clauses", () => {
  const evaluator = new DeterministicPolicyEvaluator();

  const decision = evaluator.evaluate(policyPack, {
    tenantId: "tenant-1",
    facts: {
      permissions: { delta: 0 },
      tenant: { allowed: false },
    },
  });

  assert.equal(decision.action, "allow");
  assert.deepEqual(decision.matchedRuleIds, []);
  assert.deepEqual(decision.failedClauseIds, ["scope-delta"]);
  assert.deepEqual(decision.triggeredGuardrailIds, []);
});

test("default guardrail catalog ships the baseline enterprise boundaries", () => {
  const catalog = createDefaultGuardrailCatalog();
  const keys = catalog.map((definition) => definition.key);

  assert.deepEqual(keys, [
    "tenant_boundary",
    "pii_boundary",
    "least_privilege",
    "manual_review_required",
    "data_residency",
  ]);

  for (const definition of catalog) {
    assert.equal(definition.status, "active");
    assert.ok(Array.isArray(definition.configuration.clauses));
  }
});
