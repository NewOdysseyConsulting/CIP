from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Callable, Generic, TypeVar

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
    AuditEventRepository,
    CipRepositories,
    ConnectorBindingFilter,
    ConnectorDefinitionFilter,
    ConnectorRateBucketFilter,
    CredentialBindingFilter,
    DeploymentFilter,
    EvidenceBundleFilter,
    GuardrailDefinitionFilter,
    MutableRepository,
    PolicyPackFilter,
    RunEventFilter,
    RunEventRepository,
    RunSessionFilter,
    TenantFilter,
)

TRecord = TypeVar("TRecord")
TFilter = TypeVar("TFilter")


def _matches_optional(value: object, expected: object | None) -> bool:
    return expected is None or value == expected


def _matches_included(values: list[str], expected: str | None) -> bool:
    return expected is None or expected in values


class InMemoryMutableRepository(Generic[TRecord, TFilter], MutableRepository[TRecord, TFilter]):
    def __init__(self, matches: Callable[[TRecord, TFilter], bool]):
        self._records: dict[str, TRecord] = {}
        self._matches = matches

    def get_by_id(self, record_id: str) -> TRecord | None:
        record = self._records.get(record_id)
        return deepcopy(record) if record is not None else None

    def list(self, record_filter: TFilter | None = None) -> list[TRecord]:
        values = list(self._records.values())
        filtered = (
            values
            if record_filter is None
            else [record for record in values if self._matches(record, record_filter)]
        )
        return [deepcopy(record) for record in filtered]

    def save(self, record: TRecord) -> TRecord:
        record_id = getattr(record, "id")
        self._records[record_id] = deepcopy(record)
        return deepcopy(record)

    def delete(self, record_id: str) -> None:
        self._records.pop(record_id, None)


class InMemoryAuditEventRepository(AuditEventRepository):
    def __init__(self) -> None:
        self._events: dict[str, AuditEvent] = {}

    def append(self, event: AuditEvent) -> AuditEvent:
        self._events[event.id] = deepcopy(event)
        return deepcopy(event)

    def get_by_id(self, event_id: str) -> AuditEvent | None:
        event = self._events.get(event_id)
        return deepcopy(event) if event is not None else None

    def list(self, record_filter: AuditEventFilter | None = None) -> list[AuditEvent]:
        events = list(self._events.values())
        filtered = (
            events
            if record_filter is None
            else [
                event
                for event in events
                if _matches_optional(event.tenant_id, record_filter.tenant_id)
                and _matches_optional(event.deployment_id, record_filter.deployment_id)
                and _matches_optional(event.session_id, record_filter.session_id)
                and _matches_optional(event.category, record_filter.category)
                and _matches_optional(event.severity, record_filter.severity)
                and _matches_optional(event.action, record_filter.action)
            ]
        )
        filtered.sort(key=lambda event: event.occurred_at)
        return [deepcopy(event) for event in filtered]


class InMemoryRunEventRepository(RunEventRepository):
    def __init__(self) -> None:
        self._events: dict[str, RunEvent] = {}

    def append(self, event: RunEvent) -> RunEvent:
        self._events[event.id] = deepcopy(event)
        return deepcopy(event)

    def get_by_id(self, event_id: str) -> RunEvent | None:
        event = self._events.get(event_id)
        return deepcopy(event) if event is not None else None

    def list(self, record_filter: RunEventFilter | None = None) -> list[RunEvent]:
        events = list(self._events.values())
        filtered = (
            events
            if record_filter is None
            else [
                event
                for event in events
                if _matches_optional(event.tenant_id, record_filter.tenant_id)
                and _matches_optional(event.deployment_id, record_filter.deployment_id)
                and _matches_optional(event.session_id, record_filter.session_id)
                and _matches_optional(event.type, record_filter.type)
            ]
        )
        filtered.sort(key=lambda event: event.sequence)
        return [deepcopy(event) for event in filtered]


def _tenant_matches(record: TenantRecord, record_filter: TenantFilter) -> bool:
    return (
        _matches_optional(record.status, record_filter.status)
        and _matches_optional(record.product_tier, record_filter.product_tier)
        and _matches_included(record.platforms, record_filter.platform)
    )


def _connector_definition_matches(
    record: ConnectorDefinition,
    record_filter: ConnectorDefinitionFilter,
) -> bool:
    return (
        _matches_optional(record.key, record_filter.key)
        and _matches_optional(record.version, record_filter.version)
        and _matches_optional(record.platform, record_filter.platform)
        and _matches_optional(record.runtime, record_filter.runtime)
        and _matches_optional(record.status, record_filter.status)
        and _matches_included(record.capabilities, record_filter.capability)
    )


def _credential_binding_matches(
    record: CredentialBinding,
    record_filter: CredentialBindingFilter,
) -> bool:
    return (
        _matches_optional(record.tenant_id, record_filter.tenant_id)
        and _matches_optional(record.provider, record_filter.provider)
        and _matches_optional(record.status, record_filter.status)
    )


def _connector_binding_matches(
    record: ConnectorBinding,
    record_filter: ConnectorBindingFilter,
) -> bool:
    return (
        _matches_optional(record.tenant_id, record_filter.tenant_id)
        and _matches_optional(record.connector_definition_id, record_filter.connector_definition_id)
        and _matches_optional(record.credential_binding_id, record_filter.credential_binding_id)
        and _matches_optional(record.environment, record_filter.environment)
        and _matches_optional(record.status, record_filter.status)
    )


def _policy_pack_matches(record: PolicyPack, record_filter: PolicyPackFilter) -> bool:
    return (
        _matches_optional(record.domain, record_filter.domain)
        and _matches_optional(record.ownership, record_filter.ownership)
        and _matches_optional(record.tenant_id, record_filter.tenant_id)
        and _matches_optional(record.status, record_filter.status)
    )


def _guardrail_definition_matches(
    record: GuardrailDefinition,
    record_filter: GuardrailDefinitionFilter,
) -> bool:
    return (
        _matches_optional(record.key, record_filter.key)
        and _matches_optional(record.version, record_filter.version)
        and _matches_optional(record.status, record_filter.status)
    )


def _agent_blueprint_matches(
    record: AgentBlueprint,
    record_filter: AgentBlueprintFilter,
) -> bool:
    return (
        _matches_optional(record.key, record_filter.key)
        and _matches_optional(record.version, record_filter.version)
        and _matches_optional(record.domain, record_filter.domain)
        and _matches_optional(record.product_tier, record_filter.product_tier)
        and _matches_optional(record.status, record_filter.status)
        and _matches_optional(record.release_state, record_filter.release_state)
    )


def _deployment_matches(record: DeploymentRecord, record_filter: DeploymentFilter) -> bool:
    return (
        _matches_optional(record.tenant_id, record_filter.tenant_id)
        and _matches_optional(record.agent_blueprint_id, record_filter.agent_blueprint_id)
        and _matches_optional(record.environment, record_filter.environment)
        and _matches_optional(record.status, record_filter.status)
    )


def _run_session_matches(record: RunSession, record_filter: RunSessionFilter) -> bool:
    return (
        _matches_optional(record.tenant_id, record_filter.tenant_id)
        and _matches_optional(record.deployment_id, record_filter.deployment_id)
        and _matches_optional(record.status, record_filter.status)
    )


def _approval_request_matches(
    record: ApprovalRequest,
    record_filter: ApprovalRequestFilter,
) -> bool:
    return (
        _matches_optional(record.tenant_id, record_filter.tenant_id)
        and _matches_optional(record.deployment_id, record_filter.deployment_id)
        and _matches_optional(record.session_id, record_filter.session_id)
        and _matches_optional(record.status, record_filter.status)
    )


def _evidence_bundle_matches(
    record: EvidenceBundle,
    record_filter: EvidenceBundleFilter,
) -> bool:
    return (
        _matches_optional(record.tenant_id, record_filter.tenant_id)
        and _matches_optional(record.deployment_id, record_filter.deployment_id)
        and _matches_optional(record.session_id, record_filter.session_id)
    )


def _connector_rate_bucket_matches(
    record: ConnectorRateBucket,
    record_filter: ConnectorRateBucketFilter,
) -> bool:
    return (
        _matches_optional(record.provider, record_filter.provider)
        and _matches_optional(record.external_system_tenant, record_filter.external_system_tenant)
        and _matches_optional(record.environment, record_filter.environment)
        and _matches_optional(record.api_family, record_filter.api_family)
    )


@dataclass(slots=True)
class InMemoryCipRepositories(CipRepositories):
    tenants: MutableRepository[TenantRecord, TenantFilter]
    connector_definitions: MutableRepository[ConnectorDefinition, ConnectorDefinitionFilter]
    credential_bindings: MutableRepository[CredentialBinding, CredentialBindingFilter]
    connector_bindings: MutableRepository[ConnectorBinding, ConnectorBindingFilter]
    policy_packs: MutableRepository[PolicyPack, PolicyPackFilter]
    guardrail_definitions: MutableRepository[GuardrailDefinition, GuardrailDefinitionFilter]
    agent_blueprints: MutableRepository[AgentBlueprint, AgentBlueprintFilter]
    deployments: MutableRepository[DeploymentRecord, DeploymentFilter]
    run_sessions: MutableRepository[RunSession, RunSessionFilter]
    approval_requests: MutableRepository[ApprovalRequest, ApprovalRequestFilter]
    evidence_bundles: MutableRepository[EvidenceBundle, EvidenceBundleFilter]
    connector_rate_buckets: MutableRepository[ConnectorRateBucket, ConnectorRateBucketFilter]
    audit_events: AuditEventRepository
    run_events: RunEventRepository


def create_in_memory_cip_repositories() -> InMemoryCipRepositories:
    return InMemoryCipRepositories(
        tenants=InMemoryMutableRepository(_tenant_matches),
        connector_definitions=InMemoryMutableRepository(_connector_definition_matches),
        credential_bindings=InMemoryMutableRepository(_credential_binding_matches),
        connector_bindings=InMemoryMutableRepository(_connector_binding_matches),
        policy_packs=InMemoryMutableRepository(_policy_pack_matches),
        guardrail_definitions=InMemoryMutableRepository(_guardrail_definition_matches),
        agent_blueprints=InMemoryMutableRepository(_agent_blueprint_matches),
        deployments=InMemoryMutableRepository(_deployment_matches),
        run_sessions=InMemoryMutableRepository(_run_session_matches),
        approval_requests=InMemoryMutableRepository(_approval_request_matches),
        evidence_bundles=InMemoryMutableRepository(_evidence_bundle_matches),
        connector_rate_buckets=InMemoryMutableRepository(_connector_rate_bucket_matches),
        audit_events=InMemoryAuditEventRepository(),
        run_events=InMemoryRunEventRepository(),
    )
