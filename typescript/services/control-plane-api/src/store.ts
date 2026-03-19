import { createHash, randomUUID } from "node:crypto";

import type { CipEventBatch } from "@new-odyssey/cip";
import type { Pool } from "pg";

import type {
  ApiKeyRecord,
  ControlPlaneServiceStore,
  CreateApiKeyInput,
  DeadLetterJobRecord,
  IdempotencyRecord,
  IdempotencyReservation,
  IngestJobRecord,
  IngestJobStatus,
  IssuedApiKey,
  RevokeApiKeyInput,
  RetentionCleanupResult,
  RotateApiKeyInput,
  ReserveIdempotencyInput,
  StoredHttpResponse,
} from "./types.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const nowIso = (): string => new Date().toISOString();

const toJson = (value: unknown): string => JSON.stringify(value);

export const hashApiKey = (plainTextKey: string): string =>
  createHash("sha256").update(plainTextKey).digest("hex");

export const hashPayload = (value: unknown): string =>
  createHash("sha256").update(toJson(value)).digest("hex");

const buildServiceRecord = (id?: string) => {
  const now = nowIso();

  return {
    id: id ?? randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
};

const withUpdatedAt = <TRecord extends { updatedAt: string }>(
  record: TRecord,
): TRecord => ({
  ...record,
  updatedAt: nowIso(),
});

export const issueApiKey = async (
  store: ControlPlaneServiceStore,
  input: CreateApiKeyInput,
): Promise<IssuedApiKey> => {
  const plainTextKey = `cip_sk_${randomUUID().replace(/-/g, "")}`;
  const record: ApiKeyRecord = {
    ...buildServiceRecord(input.id),
    tenantId: input.tenantId,
    name: input.name,
    keyHash: hashApiKey(plainTextKey),
    scopes: input.scopes,
    status: "active",
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.rotatedFromApiKeyId === undefined
      ? {}
      : { rotatedFromApiKeyId: input.rotatedFromApiKeyId }),
    ...(input.description === undefined ? {} : { description: input.description }),
  };

  await store.apiKeys.save(record);

  return {
    record,
    plainTextKey,
  };
};

class InMemoryApiKeyStore {
  private readonly records = new Map<string, ApiKeyRecord>();

  async save(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    const persisted = clone(record);
    this.records.set(record.id, persisted);
    return clone(persisted);
  }

  async getById(id: string): Promise<ApiKeyRecord | null> {
    const record = this.records.get(id);
    return record === undefined ? null : clone(record);
  }

  async getByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    for (const record of this.records.values()) {
      if (record.keyHash === keyHash) {
        return clone(record);
      }
    }

    return null;
  }

  async list(tenantId?: string): Promise<ApiKeyRecord[]> {
    return Array.from(this.records.values())
      .filter((record) => tenantId === undefined || record.tenantId === tenantId)
      .map((record) => clone(record));
  }
}

class InMemoryIdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  private buildKey(routeKey: string, idempotencyKey: string): string {
    return `${routeKey}::${idempotencyKey}`;
  }

  async get(
    routeKey: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | null> {
    const record = this.records.get(this.buildKey(routeKey, idempotencyKey));
    return record === undefined ? null : clone(record);
  }

  async reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
    const key = this.buildKey(input.routeKey, input.idempotencyKey);
    const existing = this.records.get(key);
    if (existing !== undefined) {
      if (existing.requestHash !== input.requestHash) {
        return { state: "conflict", record: clone(existing) };
      }
      if (existing.status === "completed") {
        return { state: "completed", record: clone(existing) };
      }
      return { state: "pending", record: clone(existing) };
    }

    const now = nowIso();
    this.records.set(key, {
      routeKey: input.routeKey,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { state: "acquired" };
  }

  async complete(
    routeKey: string,
    idempotencyKey: string,
    response: StoredHttpResponse,
  ): Promise<IdempotencyRecord> {
    const key = this.buildKey(routeKey, idempotencyKey);
    const existing = this.records.get(key);
    if (existing === undefined) {
      throw new Error("idempotency reservation does not exist");
    }
    const completed: IdempotencyRecord = {
      ...existing,
      status: "completed",
      response: clone(response),
      updatedAt: nowIso(),
    };
    this.records.set(key, clone(completed));
    return clone(completed);
  }

  async abandon(routeKey: string, idempotencyKey: string): Promise<void> {
    this.records.delete(this.buildKey(routeKey, idempotencyKey));
  }

  async deleteOlderThan(cutoff: string): Promise<number> {
    let deleted = 0;
    for (const [key, record] of this.records.entries()) {
      if (record.updatedAt < cutoff) {
        this.records.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

class InMemoryDeadLetterJobStore {
  private readonly records = new Map<string, DeadLetterJobRecord>();

  async save(record: DeadLetterJobRecord): Promise<DeadLetterJobRecord> {
    const persisted = clone(record);
    this.records.set(record.id, persisted);
    return clone(persisted);
  }

  async list(): Promise<DeadLetterJobRecord[]> {
    return Array.from(this.records.values()).map((record) => clone(record));
  }

  async getById(id: string): Promise<DeadLetterJobRecord | null> {
    const record = this.records.get(id);
    return record === undefined ? null : clone(record);
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async deleteOlderThan(cutoff: string): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.records.entries()) {
      if (record.createdAt < cutoff) {
        this.records.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

class InMemoryIngestJobStore {
  private readonly records = new Map<string, IngestJobRecord>();

  constructor(private readonly deadLetterJobs: InMemoryDeadLetterJobStore) {}

  async enqueue(record: IngestJobRecord): Promise<IngestJobRecord> {
    const persisted = clone(record);
    this.records.set(record.id, persisted);
    return clone(persisted);
  }

  async getById(id: string): Promise<IngestJobRecord | null> {
    const record = this.records.get(id);
    return record === undefined ? null : clone(record);
  }

  async list(status?: IngestJobStatus): Promise<IngestJobRecord[]> {
    return Array.from(this.records.values())
      .filter((record) => status === undefined || record.status === status)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => clone(record));
  }

  async claimNextAvailable(): Promise<IngestJobRecord | null> {
    const now = nowIso();
    const next = Array.from(this.records.values())
      .filter(
        (record) => record.status === "queued" && record.availableAt <= now,
      )
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt))
      .at(0);

    if (next === undefined) {
      return null;
    }

    const claimed = withUpdatedAt({
      ...next,
      status: "processing" as const,
    });
    this.records.set(claimed.id, clone(claimed));
    return clone(claimed);
  }

  async markCompleted(id: string): Promise<IngestJobRecord | null> {
    const current = this.records.get(id);
    if (current === undefined) {
      return null;
    }

    const completed: IngestJobRecord = {
      ...(current.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: current.idempotencyKey }),
      ...withUpdatedAt({
        ...current,
        status: "completed" as const,
      }),
    };
    delete (completed as { lastError?: string }).lastError;
    this.records.set(id, clone(completed));
    return clone(completed);
  }

  async markRetryable(
    id: string,
    error: string,
    availableAt: string,
  ): Promise<IngestJobRecord | null> {
    const current = this.records.get(id);
    if (current === undefined) {
      return null;
    }

    const retried: IngestJobRecord = {
      ...withUpdatedAt(current),
      status: "queued",
      attemptCount: current.attemptCount + 1,
      availableAt,
      lastError: error,
    };
    this.records.set(id, clone(retried));
    return clone(retried);
  }

  async moveToDeadLetter(
    id: string,
    error: string,
  ): Promise<DeadLetterJobRecord | null> {
    const current = this.records.get(id);
    if (current === undefined) {
      return null;
    }

    const deadLetter: DeadLetterJobRecord = {
      id: randomUUID(),
      originalJobId: current.id,
      tenantId: current.tenantId,
      sessionId: current.sessionId,
      jobType: current.jobType,
      payload: clone(current.payload),
      lastError: error,
      createdAt: nowIso(),
    };
    await this.deadLetterJobs.save(deadLetter);
    this.records.set(
      id,
      clone({
        ...withUpdatedAt(current),
        status: "dead_letter" as const,
        attemptCount: current.attemptCount + 1,
        lastError: error,
      }),
    );
    return clone(deadLetter);
  }

  async deleteOlderThan(cutoff: string): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.records.entries()) {
      if (record.updatedAt < cutoff) {
        this.records.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

export const createInMemoryControlPlaneServiceStore =
  (): ControlPlaneServiceStore => {
    const deadLetterJobs = new InMemoryDeadLetterJobStore();
    return {
      apiKeys: new InMemoryApiKeyStore(),
      idempotency: new InMemoryIdempotencyStore(),
      ingestJobs: new InMemoryIngestJobStore(deadLetterJobs),
      deadLetterJobs,
    };
  };

const asApiKeyRecord = (row: Record<string, unknown>): ApiKeyRecord => ({
  id: String(row.id),
  tenantId: String(row.tenant_id),
  name: String(row.name),
  keyHash: String(row.key_hash),
  scopes: clone(row.scopes as ApiKeyRecord["scopes"]),
  status: String(row.status) as ApiKeyRecord["status"],
  createdAt: new Date(String(row.created_at)).toISOString(),
  updatedAt: new Date(String(row.updated_at)).toISOString(),
  ...(row.expires_at === null || row.expires_at === undefined
    ? {}
    : { expiresAt: new Date(String(row.expires_at)).toISOString() }),
  ...(row.revoked_at === null || row.revoked_at === undefined
    ? {}
    : { revokedAt: new Date(String(row.revoked_at)).toISOString() }),
  ...(row.last_used_at === null || row.last_used_at === undefined
    ? {}
    : { lastUsedAt: new Date(String(row.last_used_at)).toISOString() }),
  ...(row.rotated_from_api_key_id === null || row.rotated_from_api_key_id === undefined
    ? {}
    : { rotatedFromApiKeyId: String(row.rotated_from_api_key_id) }),
  ...(row.description === null || row.description === undefined
    ? {}
    : { description: String(row.description) }),
});

const asIngestJobRecord = (row: Record<string, unknown>): IngestJobRecord => ({
  id: String(row.id),
  tenantId: String(row.tenant_id),
  sessionId: String(row.session_id),
  jobType: String(row.job_type) as IngestJobRecord["jobType"],
  payload: clone(row.payload as CipEventBatch),
  status: String(row.status) as IngestJobRecord["status"],
  attemptCount: Number(row.attempt_count),
  availableAt: new Date(String(row.available_at)).toISOString(),
  createdAt: new Date(String(row.created_at)).toISOString(),
  updatedAt: new Date(String(row.updated_at)).toISOString(),
  ...(row.last_error === null || row.last_error === undefined
    ? {}
    : { lastError: String(row.last_error) }),
  ...(row.idempotency_key === null || row.idempotency_key === undefined
    ? {}
    : { idempotencyKey: String(row.idempotency_key) }),
});

const asDeadLetterJobRecord = (
  row: Record<string, unknown>,
): DeadLetterJobRecord => ({
  id: String(row.id),
  originalJobId: String(row.original_job_id),
  tenantId: String(row.tenant_id),
  sessionId: String(row.session_id),
  jobType: String(row.job_type) as DeadLetterJobRecord["jobType"],
  payload: clone(row.payload as CipEventBatch),
  lastError: String(row.last_error),
  createdAt: new Date(String(row.created_at)).toISOString(),
});

const asIdempotencyRecord = (
  row: Record<string, unknown>,
): IdempotencyRecord => ({
  routeKey: String(row.route_key),
  idempotencyKey: String(row.idempotency_key),
  requestHash: String(row.request_hash),
  status: String(row.status) as IdempotencyRecord["status"],
  ...(row.response_status === null || row.response_status === undefined
    ? {}
    : {
        response: {
          status: Number(row.response_status),
          body: clone(row.response_body),
        },
      }),
  createdAt: new Date(String(row.created_at)).toISOString(),
  updatedAt: new Date(String(row.updated_at)).toISOString(),
});

export const createPostgresControlPlaneServiceStore = (
  pool: Pool,
): ControlPlaneServiceStore => ({
  apiKeys: {
    async save(record) {
      await pool.query(
        `insert into api_keys (
          id, tenant_id, name, key_hash, scopes, status, created_at, updated_at,
          expires_at, revoked_at, last_used_at, rotated_from_api_key_id, description
        ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)
        on conflict (id) do update set
          tenant_id = excluded.tenant_id,
          name = excluded.name,
          key_hash = excluded.key_hash,
          scopes = excluded.scopes,
          status = excluded.status,
          expires_at = excluded.expires_at,
          revoked_at = excluded.revoked_at,
          last_used_at = excluded.last_used_at,
          rotated_from_api_key_id = excluded.rotated_from_api_key_id,
          description = excluded.description,
          updated_at = excluded.updated_at`,
        [
          record.id,
          record.tenantId,
          record.name,
          record.keyHash,
          toJson(record.scopes),
          record.status,
          record.createdAt,
          record.updatedAt,
          record.expiresAt ?? null,
          record.revokedAt ?? null,
          record.lastUsedAt ?? null,
          record.rotatedFromApiKeyId ?? null,
          record.description ?? null,
        ],
      );
      return record;
    },
    async getById(id) {
      const result = await pool.query(
        `select * from api_keys where id = $1 limit 1`,
        [id],
      );
      const row = result.rows[0];
      return row === undefined ? null : asApiKeyRecord(row);
    },
    async getByHash(keyHash) {
      const result = await pool.query(
        `select * from api_keys where key_hash = $1 limit 1`,
        [keyHash],
      );
      const row = result.rows[0];
      return row === undefined ? null : asApiKeyRecord(row);
    },
    async list(tenantId) {
      const result = await pool.query(
        tenantId === undefined
          ? `select * from api_keys order by created_at asc`
          : `select * from api_keys where tenant_id = $1 order by created_at asc`,
        tenantId === undefined ? [] : [tenantId],
      );
      return result.rows.map(asApiKeyRecord);
    },
  },
  idempotency: {
    async get(routeKey, idempotencyKey) {
      const result = await pool.query(
        `select * from idempotency_records where route_key = $1 and idempotency_key = $2 limit 1`,
        [routeKey, idempotencyKey],
      );
      const row = result.rows[0];
      return row === undefined ? null : asIdempotencyRecord(row);
    },
    async reserve(input) {
      const now = nowIso();
      const insertResult = await pool.query(
        `insert into idempotency_records (
          route_key, idempotency_key, request_hash, status, created_at, updated_at
        ) values ($1,$2,$3,'pending',$4,$4)
        on conflict (route_key, idempotency_key) do nothing`,
        [input.routeKey, input.idempotencyKey, input.requestHash, now],
      );
      if (insertResult.rowCount === 1) {
        return { state: "acquired" } satisfies IdempotencyReservation;
      }

      const existing = await pool.query(
        `select * from idempotency_records where route_key = $1 and idempotency_key = $2 limit 1`,
        [input.routeKey, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new Error("failed to load reserved idempotency record");
      }
      const record = asIdempotencyRecord(row);
      if (record.requestHash !== input.requestHash) {
        return { state: "conflict", record };
      }
      if (record.status === "completed") {
        return { state: "completed", record };
      }
      return { state: "pending", record };
    },
    async complete(routeKey, idempotencyKey, response) {
      const result = await pool.query(
        `update idempotency_records
         set status = 'completed',
             response_status = $3,
             response_body = $4::jsonb,
             updated_at = $5
         where route_key = $1 and idempotency_key = $2
         returning *`,
        [routeKey, idempotencyKey, response.status, toJson(response.body), nowIso()],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("idempotency reservation does not exist");
      }
      return asIdempotencyRecord(row);
    },
    async abandon(routeKey, idempotencyKey) {
      await pool.query(
        `delete from idempotency_records
         where route_key = $1 and idempotency_key = $2 and status = 'pending'`,
        [routeKey, idempotencyKey],
      );
    },
    async deleteOlderThan(cutoff) {
      const result = await pool.query(
        `delete from idempotency_records where updated_at < $1`,
        [cutoff],
      );
      return result.rowCount ?? 0;
    },
  },
  ingestJobs: {
    async enqueue(record) {
      await pool.query(
        `insert into ingest_jobs (
          id, tenant_id, session_id, job_type, payload, status, attempt_count,
          available_at, last_error, idempotency_key, created_at, updated_at
        ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)
        on conflict (id) do update set
          payload = excluded.payload,
          status = excluded.status,
          attempt_count = excluded.attempt_count,
          available_at = excluded.available_at,
          last_error = excluded.last_error,
          idempotency_key = excluded.idempotency_key,
          updated_at = excluded.updated_at`,
        [
          record.id,
          record.tenantId,
          record.sessionId,
          record.jobType,
          toJson(record.payload),
          record.status,
          record.attemptCount,
          record.availableAt,
          record.lastError ?? null,
          record.idempotencyKey ?? null,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return record;
    },
    async getById(id) {
      const result = await pool.query(`select * from ingest_jobs where id = $1`, [id]);
      const row = result.rows[0];
      return row === undefined ? null : asIngestJobRecord(row);
    },
    async list(status) {
      const result = await pool.query(
        status === undefined
          ? `select * from ingest_jobs order by created_at asc`
          : `select * from ingest_jobs where status = $1 order by created_at asc`,
        status === undefined ? [] : [status],
      );
      return result.rows.map(asIngestJobRecord);
    },
    async claimNextAvailable() {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await client.query(
          `with next_job as (
            select id
            from ingest_jobs
            where status = 'queued' and available_at <= now()
            order by available_at asc, created_at asc
            for update skip locked
            limit 1
          )
          update ingest_jobs
          set status = 'processing', updated_at = now()
          where id = (select id from next_job)
          returning *`,
        );
        await client.query("commit");
        const row = result.rows[0];
        return row === undefined ? null : asIngestJobRecord(row);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async markCompleted(id) {
      const result = await pool.query(
        `update ingest_jobs
         set status = 'completed', updated_at = now(), last_error = null
         where id = $1
         returning *`,
        [id],
      );
      const row = result.rows[0];
      return row === undefined ? null : asIngestJobRecord(row);
    },
    async markRetryable(id, error, availableAt) {
      const result = await pool.query(
        `update ingest_jobs
         set status = 'queued',
             attempt_count = attempt_count + 1,
             last_error = $2,
             available_at = $3,
             updated_at = now()
         where id = $1
         returning *`,
        [id, error, availableAt],
      );
      const row = result.rows[0];
      return row === undefined ? null : asIngestJobRecord(row);
    },
    async moveToDeadLetter(id, error) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const jobResult = await client.query(
          `update ingest_jobs
           set status = 'dead_letter',
               attempt_count = attempt_count + 1,
               last_error = $2,
               updated_at = now()
           where id = $1
           returning *`,
          [id, error],
        );
        const row = jobResult.rows[0];
        if (row === undefined) {
          await client.query("rollback");
          return null;
        }
        const deadLetterId = randomUUID();
        await client.query(
          `insert into dead_letter_jobs (
            id, original_job_id, tenant_id, session_id, job_type, payload, last_error, created_at
          ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
          [
            deadLetterId,
            row.id,
            row.tenant_id,
            row.session_id,
            row.job_type,
            toJson(row.payload),
            error,
            nowIso(),
          ],
        );
        await client.query("commit");
        return {
          id: deadLetterId,
          originalJobId: String(row.id),
          tenantId: String(row.tenant_id),
          sessionId: String(row.session_id),
          jobType: String(row.job_type) as DeadLetterJobRecord["jobType"],
          payload: clone(row.payload as CipEventBatch),
          lastError: error,
          createdAt: nowIso(),
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async deleteOlderThan(cutoff) {
      const result = await pool.query(
        `delete from ingest_jobs
         where updated_at < $1 and status in ('completed', 'failed', 'dead_letter')`,
        [cutoff],
      );
      return result.rowCount ?? 0;
    },
  },
  deadLetterJobs: {
    async save(record) {
      await pool.query(
        `insert into dead_letter_jobs (
          id, original_job_id, tenant_id, session_id, job_type, payload, last_error, created_at
        ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
        on conflict (id) do update set last_error = excluded.last_error`,
        [
          record.id,
          record.originalJobId,
          record.tenantId,
          record.sessionId,
          record.jobType,
          toJson(record.payload),
          record.lastError,
          record.createdAt,
        ],
      );
      return record;
    },
    async list() {
      const result = await pool.query(
        `select * from dead_letter_jobs order by created_at asc`,
      );
      return result.rows.map(asDeadLetterJobRecord);
    },
    async getById(id) {
      const result = await pool.query(
        `select * from dead_letter_jobs where id = $1 limit 1`,
        [id],
      );
      const row = result.rows[0];
      return row === undefined ? null : asDeadLetterJobRecord(row);
    },
    async delete(id) {
      await pool.query(`delete from dead_letter_jobs where id = $1`, [id]);
    },
    async deleteOlderThan(cutoff) {
      const result = await pool.query(
        `delete from dead_letter_jobs where created_at < $1`,
        [cutoff],
      );
      return result.rowCount ?? 0;
    },
  },
});

export const createQueuedIngestJob = (
  tenantId: string,
  sessionId: string,
  payload: CipEventBatch,
  idempotencyKey?: string,
): IngestJobRecord => ({
  ...buildServiceRecord(),
  tenantId,
  sessionId,
  jobType: "event_batch",
  payload,
  status: "queued",
  attemptCount: 0,
  availableAt: nowIso(),
  ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
});

export const buildIdempotencyRecord = (
  routeKey: string,
  idempotencyKey: string,
  requestHash: string,
  response: { status: number; body: unknown },
): IdempotencyRecord => ({
  routeKey,
  idempotencyKey,
  requestHash,
  status: "completed",
  response,
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

export const revokeApiKey = async (
  store: ControlPlaneServiceStore,
  input: RevokeApiKeyInput,
): Promise<ApiKeyRecord> => {
  const existing = await store.apiKeys.getById(input.apiKeyId);
  if (existing === null) {
    throw new Error(`unknown api key ${input.apiKeyId}`);
  }

  const revoked: ApiKeyRecord = {
    ...existing,
    status: "revoked",
    revokedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await store.apiKeys.save(revoked);
  return revoked;
};

export const rotateApiKey = async (
  store: ControlPlaneServiceStore,
  input: RotateApiKeyInput,
): Promise<IssuedApiKey> => {
  const existing = await store.apiKeys.getById(input.apiKeyId);
  if (existing === null) {
    throw new Error(`unknown api key ${input.apiKeyId}`);
  }
  await revokeApiKey(store, { apiKeyId: input.apiKeyId });
  return issueApiKey(store, {
    tenantId: existing.tenantId,
    name: input.name ?? existing.name,
    scopes: input.scopes ?? existing.scopes,
    ...((input.expiresAt ?? existing.expiresAt) === undefined
      ? {}
      : { expiresAt: input.expiresAt ?? existing.expiresAt }),
    ...((input.description ?? existing.description) === undefined
      ? {}
      : { description: input.description ?? existing.description }),
    rotatedFromApiKeyId: existing.id,
  });
};

export const touchApiKeyLastUsed = async (
  store: ControlPlaneServiceStore,
  record: ApiKeyRecord,
): Promise<ApiKeyRecord> => {
  const updated: ApiKeyRecord = {
    ...record,
    lastUsedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await store.apiKeys.save(updated);
  return updated;
};

export const requeueDeadLetterJob = async (
  store: ControlPlaneServiceStore,
  deadLetterJobId: string,
): Promise<IngestJobRecord | null> => {
  const deadLetter = await store.deadLetterJobs.getById(deadLetterJobId);
  if (deadLetter === null) {
    return null;
  }
  const queued = createQueuedIngestJob(
    deadLetter.tenantId,
    deadLetter.sessionId,
    deadLetter.payload,
  );
  await store.ingestJobs.enqueue(queued);
  await store.deadLetterJobs.delete(deadLetter.id);
  return queued;
};

export const cleanupRetentionRecords = async (
  store: ControlPlaneServiceStore,
  cutoff: string,
): Promise<RetentionCleanupResult> => ({
  idempotencyDeleted: await store.idempotency.deleteOlderThan(cutoff),
  ingestDeleted: await store.ingestJobs.deleteOlderThan(cutoff),
  deadLetterDeleted: await store.deadLetterJobs.deleteOlderThan(cutoff),
});
