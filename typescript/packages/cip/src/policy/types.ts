import type {
  GuardrailDefinition,
  PolicyPack,
  PolicyRule,
} from "../domain/records.js";

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
