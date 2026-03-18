import type { QueryResult } from "pg";

import type {
  AgentBlueprint,
  ApprovalRequest,
  AuditEvent,
  ConnectorBinding,
  ConnectorDefinition,
  ConnectorRateBucket,
  CredentialBinding,
  DeploymentRecord,
  EvidenceBundle,
  GuardrailDefinition,
  PolicyPack,
  RunEvent,
  RunSession,
  TenantRecord,
} from "../../domain/records.js";
import type {
  AgentBlueprintFilter,
  ApprovalRequestFilter,
  AuditEventFilter,
  ConnectorBindingFilter,
  ConnectorDefinitionFilter,
  ConnectorRateBucketFilter,
  CredentialBindingFilter,
  DeploymentFilter,
  EvidenceBundleFilter,
  GuardrailDefinitionFilter,
  PolicyPackFilter,
  RunEventFilter,
  RunSessionFilter,
  TenantFilter,
} from "../../repositories/filters.js";
import type {
  AuditEventRepository,
  CipRepositories,
  MutableRepository,
  RunEventRepository,
} from "../../repositories/ports.js";

export interface PostgresQueryable {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Record<string, unknown>>>;
}

type IndexKey =
  | "tenant_id"
  | "deployment_id"
  | "session_id"
  | "key"
  | "version"
  | "platform"
  | "provider"
  | "environment"
  | "status"
  | "domain"
  | "category"
  | "api_family"
  | "external_system_tenant"
  | "occurred_at"
  | "release_state";

interface JsonbTableConfig<TRecord extends { id: string }, TFilter extends object> {
  tableName: string;
  orderBy?: string;
  indexes: Partial<Record<IndexKey, (record: TRecord) => string | null>>;
  filterToColumns: (filter: TFilter) => Record<string, string>;
}

const fromRow = <TRecord>(row: Record<string, unknown>): TRecord =>
  row.payload as TRecord;

class JsonbMutableRepository<TRecord extends { id: string }, TFilter extends object>
  implements MutableRepository<TRecord, TFilter>
{
  constructor(
    private readonly db: PostgresQueryable,
    private readonly config: JsonbTableConfig<TRecord, TFilter>,
  ) {}

  async getById(id: string): Promise<TRecord | null> {
    const result = await this.db.query(
      `select payload from ${this.config.tableName} where id = $1`,
      [id],
    );
    const row = result.rows[0];

    return row === undefined ? null : fromRow<TRecord>(row);
  }

  async list(filter?: TFilter): Promise<TRecord[]> {
    const values: unknown[] = [];
    const clauses: string[] = [];

    if (filter !== undefined) {
      const mapping = this.config.filterToColumns(filter);

      for (const [column, value] of Object.entries(mapping)) {
        if (value !== undefined) {
          values.push(value);
          clauses.push(`${column} = $${values.length}`);
        }
      }
    }

    const sql = [
      `select payload from ${this.config.tableName}`,
      clauses.length ? `where ${clauses.join(" and ")}` : "",
      this.config.orderBy ? `order by ${this.config.orderBy}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const result = await this.db.query(sql, values);
    return result.rows.map((row: Record<string, unknown>) => fromRow<TRecord>(row));
  }

  async save(record: TRecord): Promise<TRecord> {
    const extract = (key: IndexKey): string | null =>
      this.config.indexes[key]?.(record) ?? null;

    const values: unknown[] = [
      record.id,
      extract("tenant_id"),
      extract("deployment_id"),
      extract("session_id"),
      extract("key"),
      extract("version"),
      extract("platform"),
      extract("provider"),
      extract("environment"),
      extract("status"),
      extract("domain"),
      extract("category"),
      extract("api_family"),
      extract("external_system_tenant"),
      extract("occurred_at"),
      extract("release_state"),
      JSON.stringify(record),
    ];

    await this.db.query(
      `insert into ${this.config.tableName} (
        id,
        tenant_id,
        deployment_id,
        session_id,
        key,
        version,
        platform,
        provider,
        environment,
        status,
        domain,
        category,
        api_family,
        external_system_tenant,
        occurred_at,
        release_state,
        payload
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb
      )
      on conflict (id) do update set
        tenant_id = excluded.tenant_id,
        deployment_id = excluded.deployment_id,
        session_id = excluded.session_id,
        key = excluded.key,
        version = excluded.version,
        platform = excluded.platform,
        provider = excluded.provider,
        environment = excluded.environment,
        status = excluded.status,
        domain = excluded.domain,
        category = excluded.category,
        api_family = excluded.api_family,
        external_system_tenant = excluded.external_system_tenant,
        occurred_at = excluded.occurred_at,
        release_state = excluded.release_state,
        payload = excluded.payload`,
      values,
    );

    return record;
  }

  async delete(id: string): Promise<void> {
    await this.db.query(`delete from ${this.config.tableName} where id = $1`, [id]);
  }
}

class JsonbAppendOnlyRepository<TRecord extends { id: string }, TFilter extends object> {
  constructor(
    private readonly db: PostgresQueryable,
    private readonly config: JsonbTableConfig<TRecord, TFilter>,
  ) {}

  async append(record: TRecord): Promise<TRecord> {
    const repo = new JsonbMutableRepository(this.db, this.config);
    return repo.save(record);
  }

  async getById(id: string): Promise<TRecord | null> {
    const repo = new JsonbMutableRepository(this.db, this.config);
    return repo.getById(id);
  }

  async list(filter?: TFilter): Promise<TRecord[]> {
    const repo = new JsonbMutableRepository(this.db, this.config);
    return repo.list(filter);
  }
}

const filterToColumns = <T extends object>(
  filter: T,
): Record<string, string> => {
  const mapping: Record<string, string> = {};

  for (const [key, value] of Object.entries(filter as Record<string, unknown>)) {
    if (value !== undefined) {
      const column = key
        .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
        .replace(/^external_system_tenant$/, "external_system_tenant");
      mapping[column] = String(value);
    }
  }

  return mapping;
};

export const PHASE1_POSTGRES_MIGRATION_SQL = `
create table if not exists tenants (
  id text primary key,
  tenant_id text,
  deployment_id text,
  session_id text,
  key text,
  version text,
  platform text,
  provider text,
  environment text,
  status text,
  domain text,
  category text,
  api_family text,
  external_system_tenant text,
  occurred_at timestamptz,
  release_state text,
  payload jsonb not null
);
create table if not exists connector_definitions (like tenants including all);
create table if not exists credential_bindings (like tenants including all);
create table if not exists connector_bindings (like tenants including all);
create table if not exists policy_packs (like tenants including all);
create table if not exists guardrail_definitions (like tenants including all);
create table if not exists agent_blueprints (like tenants including all);
create table if not exists deployments (like tenants including all);
create table if not exists run_sessions (like tenants including all);
create table if not exists approval_requests (like tenants including all);
create table if not exists run_events (like tenants including all);
create table if not exists evidence_bundles (like tenants including all);
create table if not exists audit_events (like tenants including all);
create table if not exists connector_rate_buckets (like tenants including all);
create table if not exists api_keys (
  id text primary key,
  tenant_id text not null,
  name text not null,
  key_hash text not null unique,
  scopes jsonb not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table if not exists ingest_jobs (
  id text primary key,
  tenant_id text not null,
  session_id text not null,
  job_type text not null,
  payload jsonb not null,
  status text not null,
  attempt_count integer not null default 0,
  available_at timestamptz not null,
  last_error text,
  idempotency_key text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table if not exists dead_letter_jobs (
  id text primary key,
  original_job_id text not null,
  tenant_id text not null,
  session_id text not null,
  job_type text not null,
  payload jsonb not null,
  last_error text not null,
  created_at timestamptz not null
);
create table if not exists idempotency_records (
  route_key text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (route_key, idempotency_key)
);
alter table if exists idempotency_records
  add column if not exists status text;
alter table if exists idempotency_records
  add column if not exists response_status integer;
alter table if exists idempotency_records
  add column if not exists response_body jsonb;
alter table if exists idempotency_records
  add column if not exists updated_at timestamptz;
update idempotency_records
set status = coalesce(status, 'completed'),
    updated_at = coalesce(updated_at, created_at)
where status is null or updated_at is null;
alter table if exists idempotency_records
  alter column status set not null;
alter table if exists idempotency_records
  alter column response_status drop not null;
alter table if exists idempotency_records
  alter column response_body drop not null;
create index if not exists ingest_jobs_available_idx
  on ingest_jobs (status, available_at, created_at);
create index if not exists api_keys_tenant_idx
  on api_keys (tenant_id, status);
create index if not exists dead_letter_jobs_created_idx
  on dead_letter_jobs (created_at);
`;

export const createPostgresCipRepositories = (
  db: PostgresQueryable,
): CipRepositories => ({
  tenants: new JsonbMutableRepository<TenantRecord, TenantFilter>(db, {
    tableName: "tenants",
    indexes: {
      platform: (record) => record.platforms[0] ?? null,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  connectorDefinitions: new JsonbMutableRepository<
    ConnectorDefinition,
    ConnectorDefinitionFilter
  >(db, {
    tableName: "connector_definitions",
    indexes: {
      key: (record) => record.key,
      version: (record) => record.version,
      platform: (record) => record.platform,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  credentialBindings: new JsonbMutableRepository<
    CredentialBinding,
    CredentialBindingFilter
  >(db, {
    tableName: "credential_bindings",
    indexes: {
      tenant_id: (record) => record.tenantId,
      provider: (record) => record.provider,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  connectorBindings: new JsonbMutableRepository<
    ConnectorBinding,
    ConnectorBindingFilter
  >(db, {
    tableName: "connector_bindings",
    indexes: {
      tenant_id: (record) => record.tenantId,
      environment: (record) => record.environment,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  policyPacks: new JsonbMutableRepository<PolicyPack, PolicyPackFilter>(db, {
    tableName: "policy_packs",
    indexes: {
      tenant_id: (record) => record.tenantId ?? null,
      key: (record) => record.key,
      version: (record) => record.version,
      domain: (record) => record.domain,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  guardrailDefinitions: new JsonbMutableRepository<
    GuardrailDefinition,
    GuardrailDefinitionFilter
  >(db, {
    tableName: "guardrail_definitions",
    indexes: {
      key: (record) => record.key,
      version: (record) => record.version,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  agentBlueprints: new JsonbMutableRepository<
    AgentBlueprint,
    AgentBlueprintFilter
  >(db, {
    tableName: "agent_blueprints",
    indexes: {
      key: (record) => record.key,
      version: (record) => record.version,
      status: (record) => record.status,
      domain: (record) => record.domain,
      release_state: (record) => record.releaseState,
    },
    filterToColumns,
  }),
  deployments: new JsonbMutableRepository<DeploymentRecord, DeploymentFilter>(db, {
    tableName: "deployments",
    indexes: {
      tenant_id: (record) => record.tenantId,
      deployment_id: (record) => record.id,
      environment: (record) => record.environment,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  runSessions: new JsonbMutableRepository<RunSession, RunSessionFilter>(db, {
    tableName: "run_sessions",
    indexes: {
      tenant_id: (record) => record.tenantId,
      deployment_id: (record) => record.deploymentId,
      session_id: (record) => record.id,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  approvalRequests: new JsonbMutableRepository<
    ApprovalRequest,
    ApprovalRequestFilter
  >(db, {
    tableName: "approval_requests",
    indexes: {
      tenant_id: (record) => record.tenantId,
      deployment_id: (record) => record.deploymentId,
      session_id: (record) => record.sessionId,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  evidenceBundles: new JsonbMutableRepository<
    EvidenceBundle,
    EvidenceBundleFilter
  >(db, {
    tableName: "evidence_bundles",
    indexes: {
      tenant_id: (record) => record.tenantId,
      deployment_id: (record) => record.deploymentId,
      session_id: (record) => record.sessionId,
    },
    filterToColumns,
  }),
  connectorRateBuckets: new JsonbMutableRepository<
    ConnectorRateBucket,
    ConnectorRateBucketFilter
  >(db, {
    tableName: "connector_rate_buckets",
    indexes: {
      provider: (record) => record.provider,
      environment: (record) => record.environment,
      api_family: (record) => record.apiFamily,
      external_system_tenant: (record) => record.externalSystemTenant,
      status: (record) => record.status,
    },
    filterToColumns,
  }),
  auditEvents: new JsonbAppendOnlyRepository<AuditEvent, AuditEventFilter>(db, {
    tableName: "audit_events",
    orderBy: "occurred_at asc",
    indexes: {
      tenant_id: (record) => record.tenantId,
      deployment_id: (record) => record.deploymentId ?? null,
      session_id: (record) => record.sessionId ?? null,
      category: (record) => record.category,
      occurred_at: (record) => record.occurredAt,
    },
    filterToColumns,
  }) as AuditEventRepository,
  runEvents: new JsonbAppendOnlyRepository<RunEvent, RunEventFilter>(db, {
    tableName: "run_events",
    orderBy: "occurred_at asc",
    indexes: {
      tenant_id: (record) => record.tenantId,
      deployment_id: (record) => record.deploymentId,
      session_id: (record) => record.sessionId,
      occurred_at: (record) => record.occurredAt,
      status: (record) => record.type,
    },
    filterToColumns,
  }) as RunEventRepository,
});
