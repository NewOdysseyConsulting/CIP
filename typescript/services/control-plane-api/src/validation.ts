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
    "run_completed",
    "run_failed",
  ]),
  actor: auditActorSchema.optional(),
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
