import type { CipEventBatch } from "@new-odyssey/cip";

export type ApiKeyScope =
  | "sessions:read"
  | "sessions:write"
  | "approvals:write"
  | "approvals:resolve"
  | "deployments:read"
  | "deployments:write"
  | "tenants:read"
  | "audit:read";

export interface ServiceRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord extends ServiceRecord {
  tenantId: string;
  name: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  status: "active" | "revoked";
}

export interface CreateApiKeyInput {
  id?: string;
  tenantId: string;
  name: string;
  scopes: ApiKeyScope[];
}

export interface IssuedApiKey {
  record: ApiKeyRecord;
  plainTextKey: string;
}

export interface StoredHttpResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyRecord {
  routeKey: string;
  idempotencyKey: string;
  requestHash: string;
  status: "pending" | "completed";
  response?: StoredHttpResponse;
  createdAt: string;
  updatedAt: string;
}

export type IdempotencyReservation =
  | { state: "acquired" }
  | { state: "pending"; record: IdempotencyRecord }
  | { state: "completed"; record: IdempotencyRecord }
  | { state: "conflict"; record: IdempotencyRecord };

export interface ReserveIdempotencyInput {
  routeKey: string;
  idempotencyKey: string;
  requestHash: string;
}

export type IngestJobType = "event_batch";
export type IngestJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "dead_letter";

export interface IngestJobRecord extends ServiceRecord {
  tenantId: string;
  sessionId: string;
  jobType: IngestJobType;
  payload: CipEventBatch;
  status: IngestJobStatus;
  attemptCount: number;
  availableAt: string;
  lastError?: string;
  idempotencyKey?: string;
}

export interface DeadLetterJobRecord {
  id: string;
  originalJobId: string;
  tenantId: string;
  sessionId: string;
  jobType: IngestJobType;
  payload: CipEventBatch;
  lastError: string;
  createdAt: string;
}

export interface IngestJobReceipt {
  ingestJobId: string;
  acceptedCount: number;
  receivedAt: string;
}

export interface ApiKeyStore {
  save(record: ApiKeyRecord): Promise<ApiKeyRecord>;
  getByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  list(tenantId?: string): Promise<ApiKeyRecord[]>;
}

export interface IdempotencyStore {
  get(routeKey: string, idempotencyKey: string): Promise<IdempotencyRecord | null>;
  reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation>;
  complete(
    routeKey: string,
    idempotencyKey: string,
    response: StoredHttpResponse,
  ): Promise<IdempotencyRecord>;
  abandon(routeKey: string, idempotencyKey: string): Promise<void>;
}

export interface IngestJobStore {
  enqueue(record: IngestJobRecord): Promise<IngestJobRecord>;
  getById(id: string): Promise<IngestJobRecord | null>;
  list(status?: IngestJobStatus): Promise<IngestJobRecord[]>;
  claimNextAvailable(workerId?: string): Promise<IngestJobRecord | null>;
  markCompleted(id: string): Promise<IngestJobRecord | null>;
  markRetryable(
    id: string,
    error: string,
    availableAt: string,
  ): Promise<IngestJobRecord | null>;
  moveToDeadLetter(id: string, error: string): Promise<DeadLetterJobRecord | null>;
}

export interface DeadLetterJobStore {
  save(record: DeadLetterJobRecord): Promise<DeadLetterJobRecord>;
  list(): Promise<DeadLetterJobRecord[]>;
}

export interface ControlPlaneServiceStore {
  apiKeys: ApiKeyStore;
  idempotency: IdempotencyStore;
  ingestJobs: IngestJobStore;
  deadLetterJobs: DeadLetterJobStore;
}

export interface WorkerProcessResult {
  outcome: "processed" | "retried" | "dead_letter";
  job: IngestJobRecord;
}
