from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from typing import Any, Callable

from .records import (
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
)
from .repositories import (
    AgentBlueprintFilter,
    ApprovalRequestFilter,
    AuditEventFilter,
    CipRepositories,
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
)

try:
    import psycopg
except Exception:  # pragma: no cover - dependency may not be installed or linked in tests
    psycopg = None


PHASE1_POSTGRES_MIGRATION_SQL = """
create table if not exists cip_records (
  table_name text not null,
  id text not null,
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
  payload jsonb not null,
  primary key (table_name, id)
);
"""


def _default_serializer(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    return value


class _JsonbRepository:
    def __init__(
        self,
        connection: Any,
        table_name: str,
        indexes: Callable[[Any], dict[str, Any]],
        factory: Callable[[dict[str, Any]], Any],
    ) -> None:
        self._connection = connection
        self._table_name = table_name
        self._indexes = indexes
        self._factory = factory

    def get_by_id(self, record_id: str) -> Any | None:
        row = self._connection.execute(
            "select payload from cip_records where table_name = %s and id = %s",
            (self._table_name, record_id),
        ).fetchone()
        return None if row is None else self._factory(row[0])

    def list(self, record_filter: Any | None = None) -> list[Any]:
        clauses = ["table_name = %s"]
        values: list[Any] = [self._table_name]
        if record_filter is not None:
            for key, value in vars(record_filter).items():
                if value is not None:
                    clauses.append(f"{key} = %s")
                    values.append(value)
        rows = self._connection.execute(
            f"select payload from cip_records where {' and '.join(clauses)}",
            values,
        ).fetchall()
        return [self._factory(row[0]) for row in rows]

    def save(self, record: Any) -> Any:
        payload = json.dumps(asdict(record), default=_default_serializer)
        indexed = self._indexes(record)
        self._connection.execute(
            """
            insert into cip_records (
              table_name, id, tenant_id, deployment_id, session_id, key, version, platform,
              provider, environment, status, domain, category, api_family, external_system_tenant,
              occurred_at, release_state, payload
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            on conflict (table_name, id) do update set payload = excluded.payload
            """,
            (
                self._table_name,
                record.id,
                indexed.get("tenant_id"),
                indexed.get("deployment_id"),
                indexed.get("session_id"),
                indexed.get("key"),
                indexed.get("version"),
                indexed.get("platform"),
                indexed.get("provider"),
                indexed.get("environment"),
                indexed.get("status"),
                indexed.get("domain"),
                indexed.get("category"),
                indexed.get("api_family"),
                indexed.get("external_system_tenant"),
                indexed.get("occurred_at"),
                indexed.get("release_state"),
                payload,
            ),
        )
        return record

    def delete(self, record_id: str) -> None:
        self._connection.execute(
            "delete from cip_records where table_name = %s and id = %s",
            (self._table_name, record_id),
        )

    def append(self, event: Any) -> Any:
        return self.save(event)


def _factory(record_cls: Any) -> Callable[[dict[str, Any]], Any]:
    return lambda payload: record_cls(**payload)


def create_postgres_cip_repositories(connection: Any) -> CipRepositories:
    if psycopg is None:
        raise RuntimeError("psycopg is required to use create_postgres_cip_repositories")

    class PostgresRepositories:
        tenants = _JsonbRepository(connection, "tenants", lambda record: {"platform": record.platforms[0] if record.platforms else None, "status": record.status}, _factory(TenantRecord))
        connector_definitions = _JsonbRepository(connection, "connector_definitions", lambda record: {"key": record.key, "version": record.version, "platform": record.platform, "status": record.status}, _factory(ConnectorDefinition))
        credential_bindings = _JsonbRepository(connection, "credential_bindings", lambda record: {"tenant_id": record.tenant_id, "provider": record.provider, "status": record.status}, _factory(CredentialBinding))
        connector_bindings = _JsonbRepository(connection, "connector_bindings", lambda record: {"tenant_id": record.tenant_id, "environment": record.environment, "status": record.status}, _factory(ConnectorBinding))
        policy_packs = _JsonbRepository(connection, "policy_packs", lambda record: {"tenant_id": record.tenant_id, "key": record.key, "version": record.version, "domain": record.domain, "status": record.status}, _factory(PolicyPack))
        guardrail_definitions = _JsonbRepository(connection, "guardrail_definitions", lambda record: {"key": record.key, "version": record.version, "status": record.status}, _factory(GuardrailDefinition))
        agent_blueprints = _JsonbRepository(connection, "agent_blueprints", lambda record: {"key": record.key, "version": record.version, "status": record.status, "domain": record.domain, "release_state": record.release_state}, _factory(AgentBlueprint))
        deployments = _JsonbRepository(connection, "deployments", lambda record: {"tenant_id": record.tenant_id, "deployment_id": record.id, "environment": record.environment, "status": record.status}, _factory(DeploymentRecord))
        run_sessions = _JsonbRepository(connection, "run_sessions", lambda record: {"tenant_id": record.tenant_id, "deployment_id": record.deployment_id, "session_id": record.id, "status": record.status}, _factory(RunSession))
        approval_requests = _JsonbRepository(connection, "approval_requests", lambda record: {"tenant_id": record.tenant_id, "deployment_id": record.deployment_id, "session_id": record.session_id, "status": record.status}, _factory(ApprovalRequest))
        evidence_bundles = _JsonbRepository(connection, "evidence_bundles", lambda record: {"tenant_id": record.tenant_id, "deployment_id": record.deployment_id, "session_id": record.session_id}, _factory(EvidenceBundle))
        connector_rate_buckets = _JsonbRepository(connection, "connector_rate_buckets", lambda record: {"provider": record.provider, "environment": record.environment, "api_family": record.api_family, "external_system_tenant": record.external_system_tenant, "status": record.status}, _factory(ConnectorRateBucket))
        audit_events = _JsonbRepository(connection, "audit_events", lambda record: {"tenant_id": record.tenant_id, "deployment_id": record.deployment_id, "session_id": record.session_id, "category": record.category, "occurred_at": record.occurred_at}, _factory(AuditEvent))
        run_events = _JsonbRepository(connection, "run_events", lambda record: {"tenant_id": record.tenant_id, "deployment_id": record.deployment_id, "session_id": record.session_id, "status": record.type, "occurred_at": record.occurred_at}, _factory(RunEvent))

    return PostgresRepositories()
