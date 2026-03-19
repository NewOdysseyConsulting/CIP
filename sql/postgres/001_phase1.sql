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
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  rotated_from_api_key_id text,
  description text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
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
alter table if exists api_keys
  add column if not exists expires_at timestamptz;
alter table if exists api_keys
  add column if not exists revoked_at timestamptz;
alter table if exists api_keys
  add column if not exists last_used_at timestamptz;
alter table if exists api_keys
  add column if not exists rotated_from_api_key_id text;
alter table if exists api_keys
  add column if not exists description text;

create index if not exists ingest_jobs_available_idx
  on ingest_jobs (status, available_at, created_at);
create index if not exists api_keys_tenant_idx
  on api_keys (tenant_id, status);
create index if not exists dead_letter_jobs_created_idx
  on dead_letter_jobs (created_at);
