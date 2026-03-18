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
