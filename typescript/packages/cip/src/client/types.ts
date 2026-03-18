import type {
  ApprovalRequest,
  AuditActor,
  AuditEvent,
  DeploymentRecord,
  EvidenceBundle,
  RunEvent,
  RunSession,
  TenantRecord,
  TraceCorrelation,
} from "../domain/records.js";
import type {
  AppendAuditEventInput,
  CompleteRunSessionInput,
  ReplayedRunSession,
  ResolveApprovalRequestInput,
  RollbackDeploymentInput,
  StartRunSessionInput,
  TransitionDeploymentInput,
} from "../services/cip-control-plane.js";
import type { HumanApprovalCheckpoint } from "../runtime/types.js";

export interface CipRunEventEnvelope {
  kind: "run_event";
  type: RunEvent["type"];
  actor?: AuditActor;
  payload?: Record<string, unknown>;
  traceCorrelation?: TraceCorrelation;
  occurredAt?: string;
}

export interface CipAuditEventEnvelope {
  kind: "audit_event";
  category: AuditEvent["category"];
  action: string;
  severity?: AuditEvent["severity"];
  actor: AuditActor;
  payload: Record<string, unknown>;
  deploymentId?: string;
  occurredAt?: string;
}

export type CipIngestEvent = CipRunEventEnvelope | CipAuditEventEnvelope;

export interface CipEventBatch {
  tenantId: string;
  sessionId: string;
  events: CipIngestEvent[];
}

export interface CipIngestReceipt {
  ingestJobId: string;
  acceptedCount: number;
  receivedAt: string;
}

export interface CreateSessionRequest extends StartRunSessionInput {}

export interface CompleteSessionRequest extends CompleteRunSessionInput {}

export interface RequestApprovalRequest {
  sessionId: string;
  checkpoint: HumanApprovalCheckpoint;
  actor?: AuditActor;
}

export interface ResolveApprovalRequestRequest extends ResolveApprovalRequestInput {}

export interface TransitionDeploymentRequest extends TransitionDeploymentInput {}

export interface RollbackDeploymentRequest extends RollbackDeploymentInput {}

export interface CipControlPlaneTransport {
  createSession(input: CreateSessionRequest, idempotencyKey?: string): Promise<RunSession>;
  enqueueEvents(
    batch: CipEventBatch,
    idempotencyKey?: string,
  ): Promise<CipIngestReceipt>;
  requestApproval(input: RequestApprovalRequest): Promise<ApprovalRequest>;
  resolveApproval(
    input: ResolveApprovalRequestRequest,
  ): Promise<ApprovalRequest>;
  completeSession(
    input: CompleteSessionRequest,
    idempotencyKey?: string,
  ): Promise<RunSession>;
  transitionDeployment(
    input: TransitionDeploymentRequest,
  ): Promise<DeploymentRecord>;
  rollbackDeployment(
    input: RollbackDeploymentRequest,
  ): Promise<DeploymentRecord>;
  getReplay(sessionId: string): Promise<ReplayedRunSession>;
  getEvidenceBundle(sessionId: string): Promise<EvidenceBundle | null>;
  getTenant(tenantId: string): Promise<TenantRecord | null>;
  listDeployments(tenantId?: string): Promise<DeploymentRecord[]>;
  listAuditEvents(tenantId?: string): Promise<AuditEvent[]>;
}
