import { z } from "zod";

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

const auditActorSchema = z.object({
  type: z.enum(["agent", "human", "system"]),
  id: z.string().min(1),
});

const traceCorrelationSchema = z.object({
  provider: z.enum(["openai", "custom"]),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  conversationId: z.string().optional(),
  responseId: z.string().optional(),
});

const humanApprovalCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  reason: z.string().min(1),
  guardrailDefinitionId: z.string().optional(),
  policyPackId: z.string().optional(),
  expiresAt: z.string().optional(),
});

const highRiskBasisSchema = z.object({
  annex: z.enum(["annex-i", "annex-iii"]),
  category: z.string().min(1),
  rationale: z.string().min(1),
});

const complianceTransparencySchema = z.object({
  required: z.boolean(),
  noticeText: z.string(),
  placement: z.literal("banner-and-first-message"),
  requiresAcknowledgement: z.boolean(),
});

const complianceOversightSchema = z.object({
  required: z.boolean(),
  requireApprovalBeforeCompletion: z.boolean(),
  minimumHumanReviewers: z.number().int().min(0),
  stopMechanismRequired: z.boolean(),
});

const complianceLoggingSchema = z.object({
  requireVerifiedActors: z.boolean(),
  retentionDays: z.number().int().min(1),
});

const runtimeProfileSchema = z.object({
  provider: z.enum(["openai-agents-sdk", "anthropic", "custom"]),
  modelProfile: z.enum(["default", "reasoning", "fast"]),
  adapterVersion: z.string().optional(),
});

const runEventEnvelopeSchema = z.object({
  kind: z.literal("run_event"),
  type: z.enum([
    "run_started",
    "tool_called",
    "tool_completed",
    "handoff_started",
    "handoff_completed",
    "guardrail_triggered",
    "policy_decided",
    "approval_requested",
    "approval_resolved",
    "disclosure_presented",
    "disclosure_acknowledged",
    "human_review_completed",
    "output_overridden",
    "stop_invoked",
    "run_completed",
    "run_failed",
  ]),
  actor: auditActorSchema.optional(),
  assertedActor: auditActorSchema.optional(),
  actorVerification: z
    .enum(["system", "authenticated-sdk", "authenticated-operator", "asserted"])
    .optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  traceCorrelation: traceCorrelationSchema.optional(),
  occurredAt: z.string().optional(),
});

const auditEventEnvelopeSchema = z.object({
  kind: z.literal("audit_event"),
  category: z.enum([
    "tenant",
    "connector",
    "policy",
    "deployment",
    "session",
    "security",
    "approval",
    "runtime",
  ]),
  action: z.string().min(1),
  severity: z.enum(["info", "warn", "error", "critical"]).optional(),
  actor: auditActorSchema,
  assertedActor: auditActorSchema.optional(),
  actorVerification: z
    .enum(["system", "authenticated-sdk", "authenticated-operator", "asserted"])
    .optional(),
  payload: z.record(z.string(), z.unknown()),
  deploymentId: z.string().optional(),
  occurredAt: z.string().optional(),
});

export const startRunSessionInputSchema = z.object({
  id: z.string().optional(),
  tenantId: z.string().min(1),
  deploymentId: z.string().min(1),
  correlationId: z.string().optional(),
  inputSummary: z.string().min(1),
  traceCorrelation: traceCorrelationSchema.optional(),
});

export const completeRunSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  outputSummary: z.string().optional(),
});

export const upsertComplianceProfileInputSchema = z.object({
  id: z.string().optional(),
  deploymentId: z.string().min(1),
  regime: z.literal("eu-ai-act"),
  servesEuUsers: z.boolean(),
  intendedPurpose: z.string().min(1),
  riskTier: z.enum(["minimal", "limited", "high-risk", "prohibited", "unclassified"]),
  highRiskBasis: highRiskBasisSchema.optional(),
  transparency: complianceTransparencySchema.partial().optional(),
  oversight: complianceOversightSchema.partial().optional(),
  logging: complianceLoggingSchema.partial().optional(),
});

export const createComplianceArtifactInputSchema = z.object({
  id: z.string().optional(),
  deploymentId: z.string().min(1),
  kind: z.enum([
    "technical_documentation",
    "fundamental_rights_impact_assessment",
    "conformity_assessment",
    "eu_declaration_of_conformity",
    "eu_database_registration",
    "post_market_monitoring_plan",
    "serious_incident_record",
  ]),
  status: z.enum(["draft", "approved", "filed", "not_applicable", "expired"]),
  owner: z.string().min(1),
  summary: z.string().min(1),
  externalRef: z.string().optional(),
  dueAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export const recordDisclosureInputSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().min(1),
  disclosureVersion: z.string().min(1),
  surface: z.enum(["banner", "first_message", "banner_and_first_message"]),
  presentedAt: z.string().min(1),
  acknowledgedAt: z.string().optional(),
});

export const recordHumanReviewInputSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().min(1),
  reviewerId: z.string().optional(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().optional(),
  reviewedAt: z.string().min(1),
  actor: auditActorSchema.optional(),
});

export const cipEventBatchSchema = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  events: z.array(z.union([runEventEnvelopeSchema, auditEventEnvelopeSchema])).min(1),
});

export const requestHumanApprovalInputSchema = z.object({
  sessionId: z.string().min(1),
  checkpoint: humanApprovalCheckpointSchema,
  actor: auditActorSchema.optional(),
});

export const resolveApprovalRequestInputSchema = z.object({
  approvalRequestId: z.string().min(1),
  decision: z.enum(["pending", "approved", "rejected", "expired", "cancelled"]),
  resolutionComment: z.string().optional(),
  actor: auditActorSchema.optional(),
});

export const transitionDeploymentInputSchema = z.object({
  deploymentId: z.string().min(1),
  targetStatus: z.enum([
    "provisioning",
    "active",
    "paused",
    "draining",
    "failed",
    "retired",
  ]),
  actor: auditActorSchema.optional(),
  reason: z.string().optional(),
});

export const rollbackDeploymentInputSchema = z.object({
  deploymentId: z.string().min(1),
  targetBlueprintId: z.string().min(1),
  actor: auditActorSchema.optional(),
  reason: z.string().optional(),
});

export const registerTenantInputSchema = z.object({
  id: z.string().optional(),
  slug: z.string().min(1),
  displayName: z.string().min(1),
  productTier: z.enum(["pegasus", "pantheon", "phoenix"]),
  platforms: z.array(z.string().min(1)).min(1),
  regions: z.array(z.string().min(1)).min(1),
  status: z.enum(["active", "suspended", "retired"]).optional(),
});

export const registerConnectorDefinitionInputSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1),
  version: z.string().optional(),
  platform: z.string().min(1),
  displayName: z.string().min(1),
  driverKey: z.string().optional(),
  driverConfig: z.record(z.string(), z.unknown()).optional(),
  runtime: z.enum(["mcp", "native", "http"]),
  authStrategy: z.enum(["oauth2", "api-key", "service-account", "custom"]),
  source: z.enum(["first-party", "partner", "community"]),
  capabilities: z.array(z.string().min(1)).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["draft", "active", "deprecated"]).optional(),
});

export const createCredentialBindingInputSchema = z.object({
  id: z.string().optional(),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  secretBackendKey: z.string().optional(),
  secretRef: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  expiresAt: z.string().optional(),
  status: z.enum(["active", "rotated", "revoked"]).optional(),
});

export const createConnectorBindingInputSchema = z.object({
  id: z.string().optional(),
  tenantId: z.string().min(1),
  connectorDefinitionId: z.string().min(1),
  credentialBindingId: z.string().min(1),
  environment: z.enum(["development", "test", "sandbox", "production"]),
  alias: z.string().min(1),
  endpoint: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

const policyConditionSchema = z.object({
  path: z.string().min(1),
  operator: z.enum(["eq", "neq", "in", "contains", "exists", "regex", "gt", "gte", "lt", "lte"]),
  value: z.unknown().optional(),
});

const policyClauseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  match: z.enum(["all", "any"]),
  conditions: z.array(policyConditionSchema).min(1),
});

const policyRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  expression: z.string().optional(),
  clauses: z.array(policyClauseSchema).optional(),
  severity: z.enum(["info", "warn", "high", "critical"]),
  action: z.enum(["allow", "flag", "block", "escalate"]),
});

export const publishPolicyPackInputSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1),
  name: z.string().min(1),
  domain: z.enum(["platform", "security", "expense", "recruitment", "onboarding"]),
  version: z.string().min(1),
  ownership: z.enum(["shared", "tenant"]),
  tenantId: z.string().optional(),
  rules: z.array(policyRuleSchema).min(1),
  guardrailRefs: z.array(z.string().min(1)).optional(),
  status: z.enum(["draft", "active", "retired"]).optional(),
});

export const publishGuardrailDefinitionInputSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1),
  version: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  configuration: z.record(z.string(), z.unknown()),
  status: z.enum(["draft", "active", "retired"]).optional(),
});

export const registerAgentBlueprintInputSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1),
  version: z.string().optional(),
  name: z.string().min(1),
  productTier: z.enum(["pegasus", "pantheon", "phoenix"]),
  domain: z.enum(["platform", "security", "expense", "recruitment", "onboarding"]),
  description: z.string().min(1),
  runtime: runtimeProfileSchema,
  connectorDefinitionIds: z.array(z.string().min(1)).min(1),
  policyPackIds: z.array(z.string().min(1)).min(1),
  guardrailDefinitionIds: z.array(z.string().min(1)).optional(),
  releaseState: z.enum(["draft", "released", "deprecated"]).optional(),
  supersedesBlueprintId: z.string().optional(),
  handoffTargets: z.array(z.string().min(1)).optional(),
  structuredOutput: z.string().optional(),
  status: z.enum(["draft", "active", "deprecated"]).optional(),
});

export const deployAgentInputSchema = z.object({
  id: z.string().optional(),
  tenantId: z.string().min(1),
  agentBlueprintId: z.string().min(1),
  environment: z.enum(["development", "test", "sandbox", "production"]),
  connectorBindingIds: z.array(z.string().min(1)).min(1),
  policyPackIds: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  status: z.enum(["provisioning", "active", "paused", "draining", "failed", "retired"]).optional(),
});

export const createApiKeyInputSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1),
  scopes: z.array(z.enum([
    "sessions:read",
    "sessions:write",
    "approvals:write",
    "approvals:resolve",
    "deployments:read",
    "deployments:write",
    "tenants:read",
    "audit:read",
  ])).min(1),
  description: z.string().optional(),
  expiresAt: z.string().optional(),
});

export const rotateApiKeyInputSchema = z.object({
  apiKeyId: z.string().min(1),
  name: z.string().optional(),
  scopes: createApiKeyInputSchema.shape.scopes.optional(),
  description: z.string().optional(),
  expiresAt: z.string().optional(),
});

export const revokeApiKeyInputSchema = z.object({
  apiKeyId: z.string().min(1),
  reason: z.string().optional(),
});

const stringPathParam = z.object({
  sessionId: z.string().min(1),
});

export const sessionPathSchema = stringPathParam;
export const approvalRequestPathSchema = z.object({
  approvalRequestId: z.string().min(1),
});
export const deploymentPathSchema = z.object({
  deploymentId: z.string().min(1),
});
export const tenantPathSchema = z.object({
  tenantId: z.string().min(1),
});
export const optionalTenantQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
});
export const resourceIdPathSchema = z.object({
  id: z.string().min(1),
});
export const ingestJobPathSchema = z.object({
  jobId: z.string().min(1),
});
export const apiKeyPathSchema = z.object({
  apiKeyId: z.string().min(1),
});
export const deadLetterJobPathSchema = z.object({
  deadLetterJobId: z.string().min(1),
});

export const parseOrThrow = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  label: string,
): z.infer<TSchema> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || label}: ${issue.message}`)
      .join("; ");
    throw new RequestValidationError(`invalid ${label}: ${issues}`);
  }
  return result.data;
};
