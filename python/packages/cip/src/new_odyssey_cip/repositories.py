from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar

from .records import (
    AgentBlueprint,
    AuditEvent,
    ConnectorBinding,
    ConnectorDefinition,
    CredentialBinding,
    DeploymentRecord,
    Environment,
    PolicyDomain,
    PolicyPack,
    ProductTier,
    RunSession,
    TenantRecord,
)

TRecord = TypeVar("TRecord")
TFilter = TypeVar("TFilter")


@dataclass(slots=True)
class TenantFilter:
    status: str | None = None
    product_tier: ProductTier | None = None
    platform: str | None = None


@dataclass(slots=True)
class ConnectorDefinitionFilter:
    key: str | None = None
    platform: str | None = None
    runtime: str | None = None
    capability: str | None = None
    status: str | None = None


@dataclass(slots=True)
class CredentialBindingFilter:
    tenant_id: str | None = None
    provider: str | None = None
    status: str | None = None


@dataclass(slots=True)
class ConnectorBindingFilter:
    tenant_id: str | None = None
    connector_definition_id: str | None = None
    credential_binding_id: str | None = None
    environment: Environment | None = None
    status: str | None = None


@dataclass(slots=True)
class PolicyPackFilter:
    domain: PolicyDomain | None = None
    ownership: str | None = None
    tenant_id: str | None = None
    status: str | None = None


@dataclass(slots=True)
class AgentBlueprintFilter:
    domain: PolicyDomain | None = None
    product_tier: ProductTier | None = None
    status: str | None = None


@dataclass(slots=True)
class DeploymentFilter:
    tenant_id: str | None = None
    agent_blueprint_id: str | None = None
    environment: Environment | None = None
    status: str | None = None


@dataclass(slots=True)
class RunSessionFilter:
    tenant_id: str | None = None
    deployment_id: str | None = None
    status: str | None = None


@dataclass(slots=True)
class AuditEventFilter:
    tenant_id: str | None = None
    deployment_id: str | None = None
    session_id: str | None = None
    category: str | None = None
    severity: str | None = None
    action: str | None = None


class MutableRepository(Protocol, Generic[TRecord, TFilter]):
    def get_by_id(self, record_id: str) -> TRecord | None: ...

    def list(self, record_filter: TFilter | None = None) -> list[TRecord]: ...

    def save(self, record: TRecord) -> TRecord: ...

    def delete(self, record_id: str) -> None: ...


class AuditEventRepository(Protocol):
    def append(self, event: AuditEvent) -> AuditEvent: ...

    def get_by_id(self, event_id: str) -> AuditEvent | None: ...

    def list(self, record_filter: AuditEventFilter | None = None) -> list[AuditEvent]: ...


class CipRepositories(Protocol):
    tenants: MutableRepository[TenantRecord, TenantFilter]
    connector_definitions: MutableRepository[ConnectorDefinition, ConnectorDefinitionFilter]
    credential_bindings: MutableRepository[CredentialBinding, CredentialBindingFilter]
    connector_bindings: MutableRepository[ConnectorBinding, ConnectorBindingFilter]
    policy_packs: MutableRepository[PolicyPack, PolicyPackFilter]
    agent_blueprints: MutableRepository[AgentBlueprint, AgentBlueprintFilter]
    deployments: MutableRepository[DeploymentRecord, DeploymentFilter]
    run_sessions: MutableRepository[RunSession, RunSessionFilter]
    audit_events: AuditEventRepository
