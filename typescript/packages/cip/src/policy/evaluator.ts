import type {
  GuardrailDefinition,
  PolicyClause,
  PolicyCondition,
  PolicyPack,
  PolicyRule,
} from "./types.js";

const getValueAtPath = (
  source: Record<string, unknown>,
  path: string,
): unknown => {
  return path
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        current !== null &&
        typeof current === "object" &&
        segment in (current as Record<string, unknown>)
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      source,
    );
};

const matchesCondition = (
  condition: PolicyCondition,
  facts: Record<string, unknown>,
): boolean => {
  const actual = getValueAtPath(facts, condition.path);

  switch (condition.operator) {
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "in":
      return Array.isArray(condition.value)
        ? condition.value.includes(actual)
        : false;
    case "contains":
      return Array.isArray(actual)
        ? actual.includes(condition.value)
        : typeof actual === "string" && typeof condition.value === "string"
          ? actual.includes(condition.value)
          : false;
    case "exists":
      return actual !== undefined && actual !== null;
    case "regex":
      return typeof actual === "string" && typeof condition.value === "string"
        ? new RegExp(condition.value).test(actual)
        : false;
    case "gt":
      return typeof actual === "number" && typeof condition.value === "number"
        ? actual > condition.value
        : false;
    case "gte":
      return typeof actual === "number" && typeof condition.value === "number"
        ? actual >= condition.value
        : false;
    case "lt":
      return typeof actual === "number" && typeof condition.value === "number"
        ? actual < condition.value
        : false;
    case "lte":
      return typeof actual === "number" && typeof condition.value === "number"
        ? actual <= condition.value
        : false;
  }
};

const matchesClause = (
  clause: PolicyClause,
  facts: Record<string, unknown>,
): boolean => {
  const results = clause.conditions.map((condition) =>
    matchesCondition(condition, facts),
  );

  return clause.match === "all"
    ? results.every(Boolean)
    : results.some(Boolean);
};

const actionWeight: Record<PolicyRule["action"], number> = {
  allow: 0,
  flag: 1,
  escalate: 2,
  block: 3,
};

const guardrailTriggered = (
  definition: GuardrailDefinition,
  facts: Record<string, unknown>,
): boolean => {
  const clauses = definition.configuration.clauses;

  if (!Array.isArray(clauses) || clauses.length === 0) {
    return false;
  }

  return clauses.every((clause) => matchesClause(clause as PolicyClause, facts));
};

export interface PolicyEvaluationContext {
  tenantId: string;
  deploymentId?: string;
  sessionId?: string;
  facts: Record<string, unknown>;
}

export interface PolicyEvidenceReference {
  type: "policy-pack" | "guardrail-definition" | "fact";
  id: string;
  detail?: string;
}

export interface PolicyDecision {
  action: PolicyRule["action"];
  matchedRuleIds: string[];
  failedClauseIds: string[];
  triggeredGuardrailIds: string[];
  explanation: string;
  evidenceRefs: PolicyEvidenceReference[];
}

export interface PolicyEvaluator {
  evaluate(
    policyPack: PolicyPack,
    context: PolicyEvaluationContext,
    guardrails?: GuardrailDefinition[],
  ): PolicyDecision;
}

export class DeterministicPolicyEvaluator implements PolicyEvaluator {
  evaluate(
    policyPack: PolicyPack,
    context: PolicyEvaluationContext,
    guardrails: GuardrailDefinition[] = [],
  ): PolicyDecision {
    const matchedRuleIds: string[] = [];
    const failedClauseIds: string[] = [];
    let action: PolicyRule["action"] = "allow";

    for (const rule of policyPack.rules) {
      const clauses = rule.clauses ?? [];

      if (clauses.length === 0) {
        continue;
      }

      const matched = clauses.every((clause) =>
        matchesClause(clause, context.facts),
      );

      if (matched) {
        matchedRuleIds.push(rule.id);

        if (actionWeight[rule.action] > actionWeight[action]) {
          action = rule.action;
        }
      } else {
        for (const clause of clauses) {
          if (!matchesClause(clause, context.facts)) {
            failedClauseIds.push(clause.id);
          }
        }
      }
    }

    const triggeredGuardrailIds = guardrails
      .filter((definition) => guardrailTriggered(definition, context.facts))
      .map((definition) => definition.id);

    const explanation = matchedRuleIds.length
      ? `Matched ${matchedRuleIds.length} rule(s) in ${policyPack.key}.`
      : `No rules matched in ${policyPack.key}.`;

    return {
      action,
      matchedRuleIds,
      failedClauseIds,
      triggeredGuardrailIds,
      explanation,
      evidenceRefs: [
        {
          type: "policy-pack",
          id: policyPack.id,
          detail: `${policyPack.key}@${policyPack.version}`,
        },
        ...triggeredGuardrailIds.map((guardrailId) => ({
          type: "guardrail-definition" as const,
          id: guardrailId,
        })),
      ],
    };
  }
}
