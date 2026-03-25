from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

import httpx

from .control_plane import (
    AppendAuditEventInput,
    AppendRunEventInput,
    CipControlPlane,
    CompleteRunSessionInput,
    CreateComplianceArtifactInput,
    CreateConnectorBindingInput,
    CreateCredentialBindingInput,
    DeployAgentInput,
    PublishGuardrailDefinitionInput,
    PublishPolicyPackInput,
    RecordDisclosureInput,
    RecordHumanReviewInput,
    ReplayedRunSession,
    RegisterAgentBlueprintInput,
    RegisterConnectorDefinitionInput,
    RegisterTenantInput,
    RequestHumanApprovalInput,
    ResolveApprovalRequestInput,
    RollbackDeploymentInput,
    StartRunSessionInput,
    TransitionDeploymentInput,
    UpsertComplianceProfileInput,
)
from .records import (
    AgentBlueprint,
    ApprovalRequest,
    AuditActor,
    AuditEvent,
    BlueprintDependencySnapshot,
    ComplianceArtifact,
    ComplianceLogging,
    ComplianceOversight,
    ComplianceProfile,
    ComplianceTransparency,
    ConnectorBinding,
    ConnectorDefinition,
    CredentialBinding,
    DependencyVersionReference,
    DeploymentRecord,
    DisclosureRecord,
    EvidenceBundle,
    GuardrailDefinition,
    HighRiskBasis,
    HumanReviewRecord,
    PolicyClause,
    PolicyCondition,
    PolicyPack,
    PolicyRule,
    RunEvent,
    RunSession,
    RuntimeProfile,
    TenantRecord,
    TraceCorrelation,
)
from .repositories import AuditEventFilter, CipRepositories, DeploymentFilter
from .runtime import CipRunResult, HumanApprovalCheckpoint


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _camelize_name(value: str) -> str:
    parts = value.split("_")
    if not parts:
        return value
    head, *tail = parts
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _camelize(value: Any) -> Any:
    if is_dataclass(value):
        return _camelize(asdict(value))
    if isinstance(value, dict):
        return {_camelize_name(key): _camelize(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_camelize(item) for item in value]
    return value


def _snakify_name(value: str) -> str:
    chars: list[str] = []
    for char in value:
        if char.isupper():
            chars.append("_")
            chars.append(char.lower())
        else:
            chars.append(char)
    return "".join(chars).lstrip("_")


def _snakify(value: Any) -> Any:
    if isinstance(value, dict):
        return {_snakify_name(key): _snakify(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_snakify(item) for item in value]
    return value


def _to_trace_correlation(data: dict[str, Any] | None) -> TraceCorrelation | None:
    if data is None:
        return None
    return TraceCorrelation(**_snakify(data))


def _to_audit_actor(data: dict[str, Any]) -> AuditActor:
    return AuditActor(**_snakify(data))


def _to_dependency_reference(data: dict[str, Any]) -> DependencyVersionReference:
    return DependencyVersionReference(**_snakify(data))


def _to_blueprint_dependency_snapshot(data: dict[str, Any]) -> BlueprintDependencySnapshot:
    payload = _snakify(data)
    return BlueprintDependencySnapshot(
        policy_packs=[_to_dependency_reference(item) for item in payload["policy_packs"]],
        guardrails=[_to_dependency_reference(item) for item in payload["guardrails"]],
        connector_manifests=[_to_dependency_reference(item) for item in payload["connector_manifests"]],
        runtime_adapter_version=payload["runtime_adapter_version"],
    )


def _to_high_risk_basis(data: dict[str, Any] | None) -> HighRiskBasis | None:
    if data is None:
        return None
    return HighRiskBasis(**_snakify(data))


def _to_compliance_transparency(data: dict[str, Any]) -> ComplianceTransparency:
    return ComplianceTransparency(**_snakify(data))


def _to_compliance_oversight(data: dict[str, Any]) -> ComplianceOversight:
    return ComplianceOversight(**_snakify(data))


def _to_compliance_logging(data: dict[str, Any]) -> ComplianceLogging:
    return ComplianceLogging(**_snakify(data))


def _to_compliance_profile(data: dict[str, Any] | None) -> ComplianceProfile | None:
    if data is None:
        return None
    payload = _snakify(data)
    return ComplianceProfile(
        **{
            **payload,
            "transparency": _to_compliance_transparency(payload["transparency"]),
            "oversight": _to_compliance_oversight(payload["oversight"]),
            "logging": _to_compliance_logging(payload["logging"]),
            "high_risk_basis": _to_high_risk_basis(payload.get("high_risk_basis")),
        }
    )


def _to_compliance_artifact(data: dict[str, Any]) -> ComplianceArtifact:
    return ComplianceArtifact(**_snakify(data))


def _to_disclosure_record(data: dict[str, Any]) -> DisclosureRecord:
    return DisclosureRecord(**_snakify(data))


def _to_human_review_record(data: dict[str, Any]) -> HumanReviewRecord:
    payload = _snakify(data)
    return HumanReviewRecord(
        **{
            **payload,
            "reviewer": _to_audit_actor(payload["reviewer"]),
        }
    )


def _to_policy_condition(data: dict[str, Any]) -> PolicyCondition:
    return PolicyCondition(**_snakify(data))


def _to_policy_clause(data: dict[str, Any]) -> PolicyClause:
    payload = _snakify(data)
    return PolicyClause(
        id=payload["id"],
        name=payload["name"],
        match=payload["match"],
        conditions=[_to_policy_condition(item) for item in payload["conditions"]],
    )


def _to_policy_rule(data: dict[str, Any]) -> PolicyRule:
    payload = _snakify(data)
    return PolicyRule(
        id=payload["id"],
        name=payload["name"],
        severity=payload["severity"],
        action=payload["action"],
        description=payload.get("description"),
        expression=payload.get("expression"),
        clauses=[_to_policy_clause(item) for item in payload.get("clauses", [])],
    )


def _to_runtime_profile(data: dict[str, Any]) -> RuntimeProfile:
    return RuntimeProfile(**_snakify(data))


def _to_run_session(data: dict[str, Any]) -> RunSession:
    payload = _snakify(data)
    return RunSession(
        **{
            **payload,
            "trace_correlation": _to_trace_correlation(payload.get("trace_correlation")),
            "compliance_profile_snapshot": _to_compliance_profile(
                payload.get("compliance_profile_snapshot")
            ),
        }
    )


def _to_run_event(data: dict[str, Any]) -> RunEvent:
    payload = _snakify(data)
    return RunEvent(
        **{
            **payload,
            "actor": _to_audit_actor(payload["actor"]),
            "asserted_actor": _to_audit_actor(payload["asserted_actor"])
            if payload.get("asserted_actor") is not None
            else None,
            "trace_correlation": _to_trace_correlation(payload.get("trace_correlation")),
        }
    )


def _to_approval_request(data: dict[str, Any]) -> ApprovalRequest:
    payload = _snakify(data)
    return ApprovalRequest(
        **{
            **payload,
            "requested_by": _to_audit_actor(payload["requested_by"]),
        }
    )


def _to_audit_event(data: dict[str, Any]) -> AuditEvent:
    payload = _snakify(data)
    return AuditEvent(
        **{
            **payload,
            "actor": _to_audit_actor(payload["actor"]),
            "asserted_actor": _to_audit_actor(payload["asserted_actor"])
            if payload.get("asserted_actor") is not None
            else None,
        }
    )


def _to_tenant_record(data: dict[str, Any]) -> TenantRecord:
    return TenantRecord(**_snakify(data))


def _to_connector_definition(data: dict[str, Any]) -> ConnectorDefinition:
    return ConnectorDefinition(**_snakify(data))


def _to_credential_binding(data: dict[str, Any]) -> CredentialBinding:
    return CredentialBinding(**_snakify(data))


def _to_connector_binding(data: dict[str, Any]) -> ConnectorBinding:
    payload = _snakify(data)
    return ConnectorBinding(
        **{
            **payload,
            "config": payload.get("config") or {},
        }
    )


def _to_policy_pack(data: dict[str, Any]) -> PolicyPack:
    payload = _snakify(data)
    return PolicyPack(
        id=payload["id"],
        created_at=payload["created_at"],
        updated_at=payload["updated_at"],
        revision=payload["revision"],
        key=payload["key"],
        name=payload["name"],
        domain=payload["domain"],
        version=payload["version"],
        ownership=payload["ownership"],
        rules=[_to_policy_rule(item) for item in payload["rules"]],
        guardrail_refs=payload["guardrail_refs"],
        status=payload["status"],
        tenant_id=payload.get("tenant_id"),
    )


def _to_guardrail_definition(data: dict[str, Any]) -> GuardrailDefinition:
    return GuardrailDefinition(**_snakify(data))


def _to_agent_blueprint(data: dict[str, Any]) -> AgentBlueprint:
    payload = _snakify(data)
    return AgentBlueprint(
        **{
            **payload,
            "dependency_snapshot": _to_blueprint_dependency_snapshot(payload["dependency_snapshot"]),
            "runtime": _to_runtime_profile(payload["runtime"]),
        }
    )


def _to_deployment_record(data: dict[str, Any]) -> DeploymentRecord:
    return DeploymentRecord(**_snakify(data))


def _to_evidence_bundle(data: dict[str, Any]) -> EvidenceBundle:
    payload = _snakify(data)
    return EvidenceBundle(
        **{
            **payload,
            "policy_pack_versions": [
                _to_dependency_reference(item) for item in payload["policy_pack_versions"]
            ],
            "guardrail_versions": [
                _to_dependency_reference(item) for item in payload["guardrail_versions"]
            ],
            "compliance_profile": _to_compliance_profile(payload.get("compliance_profile")),
        }
    )


def _to_replayed_run_session(data: dict[str, Any]) -> ReplayedRunSession:
    payload = _snakify(data)
    evidence_bundle = payload.get("evidence_bundle")
    return ReplayedRunSession(
        session=_to_run_session(payload["session"]),
        run_events=[_to_run_event(item) for item in payload["run_events"]],
        approval_requests=[_to_approval_request(item) for item in payload["approval_requests"]],
        disclosure_records=[
            _to_disclosure_record(item) for item in payload.get("disclosure_records", [])
        ],
        human_reviews=[
            _to_human_review_record(item) for item in payload.get("human_reviews", [])
        ],
        compliance_profile=_to_compliance_profile(payload.get("compliance_profile")),
        compliance_artifact_ids=payload.get("compliance_artifact_ids", []),
        evidence_bundle=None if evidence_bundle is None else _to_evidence_bundle(evidence_bundle),
        reconstructed_status=payload["reconstructed_status"],
    )


@dataclass(slots=True)
class ApiKeyRecord:
    id: str
    tenant_id: str
    name: str
    key_hash: str
    scopes: list[str]
    status: str
    created_at: str
    updated_at: str
    expires_at: str | None = None
    revoked_at: str | None = None
    last_used_at: str | None = None
    rotated_from_api_key_id: str | None = None
    description: str | None = None


def _to_api_key_record(data: dict[str, Any]) -> ApiKeyRecord:
    return ApiKeyRecord(**_snakify(data))


@dataclass(slots=True)
class IssuedApiKeyResponse:
    record: ApiKeyRecord
    plain_text_key: str


def _to_issued_api_key_response(data: dict[str, Any]) -> IssuedApiKeyResponse:
    payload = _snakify(data)
    return IssuedApiKeyResponse(
        record=_to_api_key_record(payload["record"]),
        plain_text_key=payload["plain_text_key"],
    )


@dataclass(slots=True)
class CipRunEventEnvelope:
    kind: str
    type: str
    actor: dict[str, Any] | None = None
    asserted_actor: dict[str, Any] | None = None
    actor_verification: str | None = None
    payload: dict[str, Any] | None = None
    trace_correlation: dict[str, Any] | None = None
    occurred_at: str | None = None


@dataclass(slots=True)
class CipAuditEventEnvelope:
    kind: str
    category: str
    action: str
    actor: dict[str, Any]
    payload: dict[str, Any]
    asserted_actor: dict[str, Any] | None = None
    actor_verification: str | None = None
    severity: str = "info"
    deployment_id: str | None = None
    occurred_at: str | None = None


@dataclass(slots=True)
class CipEventBatch:
    tenant_id: str
    session_id: str
    events: list[dict[str, Any]]


@dataclass(slots=True)
class CipIngestReceipt:
    ingest_job_id: str
    accepted_count: int
    received_at: str


@dataclass(slots=True)
class IngestJobRecord:
    id: str
    tenant_id: str
    session_id: str
    job_type: str
    payload: CipEventBatch
    status: str
    attempt_count: int
    available_at: str
    created_at: str
    updated_at: str
    last_error: str | None = None
    idempotency_key: str | None = None


def _to_ingest_job_record(data: dict[str, Any]) -> IngestJobRecord:
    payload = _snakify(data)
    return IngestJobRecord(
        **{
            **payload,
            "payload": CipEventBatch(**payload["payload"]),
        }
    )


@dataclass(slots=True)
class DeadLetterJobRecord:
    id: str
    original_job_id: str
    tenant_id: str
    session_id: str
    job_type: str
    payload: CipEventBatch
    last_error: str
    created_at: str


def _to_dead_letter_job_record(data: dict[str, Any]) -> DeadLetterJobRecord:
    payload = _snakify(data)
    return DeadLetterJobRecord(
        **{
            **payload,
            "payload": CipEventBatch(**payload["payload"]),
        }
    )


@dataclass(slots=True)
class CipTransportRetryPolicy:
    max_attempts: int = 1
    retryable_status_codes: list[int] = field(
        default_factory=lambda: [408, 429, 500, 502, 503, 504]
    )


@dataclass(slots=True)
class CipTransportConfig:
    base_url: str
    api_key: str | None = None
    operator_token: str | None = None
    timeout_s: float = 10.0
    retry_policy: CipTransportRetryPolicy | None = None
    default_headers: dict[str, str] | None = None


class CipApiError(Exception):
    def __init__(self, message: str, status: int, details: Any | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.details = details


class CipAuthError(CipApiError):
    def __init__(self, status: int, details: Any | None = None) -> None:
        super().__init__("authentication failed", status, details)


class CipValidationError(CipApiError):
    def __init__(self, status: int, details: Any | None = None) -> None:
        super().__init__("request validation failed", status, details)


class CipConflictError(CipApiError):
    def __init__(self, status: int, details: Any | None = None) -> None:
        super().__init__("request conflict", status, details)


class CipRetryableError(CipApiError):
    def __init__(self, status: int, details: Any | None = None) -> None:
        super().__init__("retryable control plane error", status, details)


@dataclass(slots=True)
class CreateApiKeyRequest:
    tenant_id: str
    name: str
    scopes: list[str]
    description: str | None = None
    expires_at: str | None = None


@dataclass(slots=True)
class RotateApiKeyRequest:
    api_key_id: str
    name: str | None = None
    scopes: list[str] | None = None
    description: str | None = None
    expires_at: str | None = None


@dataclass(slots=True)
class RevokeApiKeyRequest:
    api_key_id: str
    reason: str | None = None


@dataclass(slots=True)
class RequeueDeadLetterJobRequest:
    dead_letter_job_id: str


class CipControlPlaneTransport(Protocol):
    def create_session(
        self,
        input_data: StartRunSessionInput,
        idempotency_key: str | None = None,
    ) -> RunSession: ...

    def enqueue_events(
        self,
        batch: CipEventBatch,
        idempotency_key: str | None = None,
    ) -> CipIngestReceipt: ...

    def request_approval(
        self,
        input_data: RequestHumanApprovalInput,
    ) -> ApprovalRequest: ...

    def resolve_approval(
        self,
        input_data: ResolveApprovalRequestInput,
    ) -> ApprovalRequest: ...

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None: ...

    def record_disclosure(self, input_data: RecordDisclosureInput) -> DisclosureRecord: ...

    def record_human_review(self, input_data: RecordHumanReviewInput) -> HumanReviewRecord: ...

    def complete_session(
        self,
        input_data: CompleteRunSessionInput,
        idempotency_key: str | None = None,
    ) -> RunSession: ...

    def transition_deployment(
        self,
        input_data: TransitionDeploymentInput,
    ) -> DeploymentRecord: ...

    def rollback_deployment(
        self,
        input_data: RollbackDeploymentInput,
    ) -> DeploymentRecord: ...

    def get_replay(self, session_id: str) -> ReplayedRunSession: ...

    def get_evidence_bundle(self, session_id: str) -> EvidenceBundle | None: ...

    def get_ingest_job(self, job_id: str) -> IngestJobRecord | None: ...

    def get_tenant(self, tenant_id: str) -> TenantRecord | None: ...

    def list_deployments(
        self,
        tenant_id: str | None = None,
    ) -> list[DeploymentRecord]: ...

    def list_audit_events(
        self,
        tenant_id: str | None = None,
    ) -> list[AuditEvent]: ...


class CipAdminTransport(Protocol):
    def create_tenant(self, input_data: RegisterTenantInput) -> TenantRecord: ...

    def list_tenants(self) -> list[TenantRecord]: ...

    def get_tenant(self, tenant_id: str) -> TenantRecord | None: ...

    def create_connector_definition(
        self,
        input_data: RegisterConnectorDefinitionInput,
    ) -> ConnectorDefinition: ...

    def list_connector_definitions(self) -> list[ConnectorDefinition]: ...

    def get_connector_definition(self, record_id: str) -> ConnectorDefinition | None: ...

    def create_credential_binding(
        self,
        input_data: CreateCredentialBindingInput,
    ) -> CredentialBinding: ...

    def list_credential_bindings(
        self,
        tenant_id: str | None = None,
    ) -> list[CredentialBinding]: ...

    def get_credential_binding(self, record_id: str) -> CredentialBinding | None: ...

    def create_connector_binding(
        self,
        input_data: CreateConnectorBindingInput,
    ) -> ConnectorBinding: ...

    def list_connector_bindings(
        self,
        tenant_id: str | None = None,
    ) -> list[ConnectorBinding]: ...

    def get_connector_binding(self, record_id: str) -> ConnectorBinding | None: ...

    def publish_policy_pack(self, input_data: PublishPolicyPackInput) -> PolicyPack: ...

    def list_policy_packs(
        self,
        tenant_id: str | None = None,
    ) -> list[PolicyPack]: ...

    def get_policy_pack(self, record_id: str) -> PolicyPack | None: ...

    def publish_guardrail_definition(
        self,
        input_data: PublishGuardrailDefinitionInput,
    ) -> GuardrailDefinition: ...

    def list_guardrail_definitions(self) -> list[GuardrailDefinition]: ...

    def get_guardrail_definition(self, record_id: str) -> GuardrailDefinition | None: ...

    def register_agent_blueprint(
        self,
        input_data: RegisterAgentBlueprintInput,
    ) -> AgentBlueprint: ...

    def list_agent_blueprints(self) -> list[AgentBlueprint]: ...

    def get_agent_blueprint(self, record_id: str) -> AgentBlueprint | None: ...

    def create_deployment(self, input_data: DeployAgentInput) -> DeploymentRecord: ...

    def list_deployments(
        self,
        tenant_id: str | None = None,
    ) -> list[DeploymentRecord]: ...

    def get_deployment(self, record_id: str) -> DeploymentRecord | None: ...

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None: ...

    def upsert_compliance_profile(
        self,
        input_data: UpsertComplianceProfileInput,
    ) -> ComplianceProfile: ...

    def list_compliance_artifacts(
        self,
        deployment_id: str,
    ) -> list[ComplianceArtifact]: ...

    def create_compliance_artifact(
        self,
        input_data: CreateComplianceArtifactInput,
    ) -> ComplianceArtifact: ...

    def issue_api_key(self, input_data: CreateApiKeyRequest) -> IssuedApiKeyResponse: ...

    def list_api_keys(self, tenant_id: str | None = None) -> list[ApiKeyRecord]: ...

    def get_api_key(self, api_key_id: str) -> ApiKeyRecord | None: ...

    def rotate_api_key(self, input_data: RotateApiKeyRequest) -> IssuedApiKeyResponse: ...

    def revoke_api_key(self, input_data: RevokeApiKeyRequest) -> ApiKeyRecord: ...

    def get_ingest_job(self, job_id: str) -> IngestJobRecord | None: ...

    def list_dead_letter_jobs(self) -> list[DeadLetterJobRecord]: ...

    def requeue_dead_letter_job(
        self,
        input_data: RequeueDeadLetterJobRequest,
    ) -> IngestJobRecord | None: ...


class LocalCipControlPlaneTransport:
    def __init__(self, control_plane: CipControlPlane, repositories: CipRepositories) -> None:
        self._control_plane = control_plane
        self._repositories = repositories

    def create_session(
        self,
        input_data: StartRunSessionInput,
        idempotency_key: str | None = None,
    ) -> RunSession:
        del idempotency_key
        return self._control_plane.start_run_session(input_data)

    def enqueue_events(
        self,
        batch: CipEventBatch,
        idempotency_key: str | None = None,
    ) -> CipIngestReceipt:
        del idempotency_key
        for event in batch.events:
            if event["kind"] == "run_event":
                self._control_plane.append_run_event(
                    AppendRunEventInput(
                        session_id=batch.session_id,
                        type=event["type"],
                        actor=AuditActor(type="agent", id="local-cip-transport"),
                        asserted_actor=None
                        if event.get("actor") is None
                        else AuditActor(**event["actor"]),
                        actor_verification=event.get("actor_verification") or "asserted",
                        payload=event.get("payload"),
                        trace_correlation=None
                        if event.get("trace_correlation") is None
                        else TraceCorrelation(**event["trace_correlation"]),
                        occurred_at=event.get("occurred_at"),
                    )
                )
                continue

            self._control_plane.append_audit_event(
                AppendAuditEventInput(
                    tenant_id=batch.tenant_id,
                    session_id=batch.session_id,
                    deployment_id=event.get("deployment_id"),
                    category=event["category"],
                    action=event["action"],
                    severity=event.get("severity", "info"),
                    actor=AuditActor(type="agent", id="local-cip-transport"),
                    asserted_actor=AuditActor(**event["actor"]),
                    actor_verification=event.get("actor_verification") or "asserted",
                    payload=event["payload"],
                    occurred_at=event.get("occurred_at"),
                )
            )

        return CipIngestReceipt(
            ingest_job_id=f"local-{uuid4()}",
            accepted_count=len(batch.events),
            received_at=_utc_now(),
        )

    def request_approval(self, input_data: RequestHumanApprovalInput) -> ApprovalRequest:
        return self._control_plane.request_human_approval(input_data)

    def resolve_approval(self, input_data: ResolveApprovalRequestInput) -> ApprovalRequest:
        return self._control_plane.resolve_approval_request(input_data)

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None:
        return self._control_plane.get_compliance_profile(deployment_id)

    def record_disclosure(self, input_data: RecordDisclosureInput) -> DisclosureRecord:
        return self._control_plane.record_disclosure(input_data)

    def record_human_review(self, input_data: RecordHumanReviewInput) -> HumanReviewRecord:
        return self._control_plane.record_human_review(input_data)

    def complete_session(
        self,
        input_data: CompleteRunSessionInput,
        idempotency_key: str | None = None,
    ) -> RunSession:
        del idempotency_key
        return self._control_plane.complete_run_session(input_data)

    def transition_deployment(self, input_data: TransitionDeploymentInput) -> DeploymentRecord:
        return self._control_plane.transition_deployment(input_data)

    def rollback_deployment(self, input_data: RollbackDeploymentInput) -> DeploymentRecord:
        return self._control_plane.rollback_deployment_to_blueprint(input_data)

    def get_replay(self, session_id: str) -> ReplayedRunSession:
        return self._control_plane.replay_run_session(session_id)

    def get_evidence_bundle(self, session_id: str) -> EvidenceBundle | None:
        return self._control_plane.get_evidence_bundle(session_id)

    def get_ingest_job(self, job_id: str) -> IngestJobRecord | None:
        del job_id
        return None

    def get_tenant(self, tenant_id: str) -> TenantRecord | None:
        return self._repositories.tenants.get_by_id(tenant_id)

    def list_deployments(self, tenant_id: str | None = None) -> list[DeploymentRecord]:
        return self._repositories.deployments.list(
            None if tenant_id is None else DeploymentFilter(tenant_id=tenant_id)
        )

    def list_audit_events(self, tenant_id: str | None = None) -> list[AuditEvent]:
        return self._repositories.audit_events.list(
            None if tenant_id is None else AuditEventFilter(tenant_id=tenant_id)
        )


class _BaseHttpTransport:
    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        operator_token: str | None = None,
        client: httpx.Client | None = None,
        timeout_s: float = 10.0,
        retry_policy: CipTransportRetryPolicy | None = None,
        default_headers: dict[str, str] | None = None,
    ) -> None:
        self._api_key = api_key
        self._operator_token = operator_token
        self._client = client or httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout_s)
        self._retry_policy = retry_policy or CipTransportRetryPolicy()
        self._default_headers = default_headers or {}

    def _headers(self, auth_mode: str, idempotency_key: str | None = None) -> dict[str, str]:
        token = self._api_key if auth_mode == "sdk" else self._operator_token
        headers = {
            "content-type": "application/json",
            **self._default_headers,
        }
        if token is not None:
            headers["authorization"] = f"Bearer {token}"
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    @staticmethod
    def _decode_response(response: httpx.Response) -> Any:
        if response.status_code == 204:
            return None
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        if not response.text:
            return None
        return response.text

    def _build_error(self, response: httpx.Response, details: Any) -> CipApiError:
        if response.status_code in (401, 403):
            return CipAuthError(response.status_code, details)
        if response.status_code in (400, 422):
            return CipValidationError(response.status_code, details)
        if response.status_code == 409:
            return CipConflictError(response.status_code, details)
        if response.status_code in self._retry_policy.retryable_status_codes:
            return CipRetryableError(response.status_code, details)
        return CipApiError("control plane request failed", response.status_code, details)

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        auth_mode: str,
        json_body: Any | None = None,
        params: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        attempt = 0
        while True:
            response = self._client.request(
                method,
                path,
                headers=self._headers(auth_mode, idempotency_key),
                json=_camelize(json_body) if json_body is not None else None,
                params=params,
            )
            if response.is_success:
                return self._decode_response(response)

            details = self._decode_response(response)
            error = self._build_error(response, details)
            is_retryable = (
                isinstance(error, CipRetryableError)
                and attempt + 1 < self._retry_policy.max_attempts
                and response.status_code in self._retry_policy.retryable_status_codes
            )
            if not is_retryable:
                raise error
            attempt += 1
            time.sleep(min(1.0, 0.1 * 2**attempt))


class HttpCipControlPlaneTransport(_BaseHttpTransport):
    def create_session(
        self,
        input_data: StartRunSessionInput,
        idempotency_key: str | None = None,
    ) -> RunSession:
        data = self._request_json(
            "POST",
            "/v1/sessions",
            auth_mode="sdk",
            json_body=input_data,
            idempotency_key=idempotency_key,
        )
        return _to_run_session(data)

    def enqueue_events(
        self,
        batch: CipEventBatch,
        idempotency_key: str | None = None,
    ) -> CipIngestReceipt:
        data = self._request_json(
            "POST",
            f"/v1/sessions/{batch.session_id}/events:enqueue",
            auth_mode="sdk",
            json_body=batch,
            idempotency_key=idempotency_key,
        )
        return CipIngestReceipt(**_snakify(data))

    def request_approval(self, input_data: RequestHumanApprovalInput) -> ApprovalRequest:
        data = self._request_json(
            "POST",
            f"/v1/sessions/{input_data.session_id}/approval-requests",
            auth_mode="sdk",
            json_body=input_data,
        )
        return _to_approval_request(data)

    def resolve_approval(self, input_data: ResolveApprovalRequestInput) -> ApprovalRequest:
        data = self._request_json(
            "POST",
            f"/v1/approval-requests/{input_data.approval_request_id}:resolve",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_approval_request(data)

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None:
        data = self._request_json(
            "GET",
            f"/v1/deployments/{deployment_id}/compliance-profile",
            auth_mode="sdk",
        )
        return None if data is None else _to_compliance_profile(data)

    def record_disclosure(self, input_data: RecordDisclosureInput) -> DisclosureRecord:
        data = self._request_json(
            "POST",
            f"/v1/sessions/{input_data.session_id}:record-disclosure",
            auth_mode="sdk",
            json_body=input_data,
        )
        return _to_disclosure_record(data)

    def record_human_review(self, input_data: RecordHumanReviewInput) -> HumanReviewRecord:
        data = self._request_json(
            "POST",
            f"/v1/sessions/{input_data.session_id}:record-human-review",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_human_review_record(data)

    def complete_session(
        self,
        input_data: CompleteRunSessionInput,
        idempotency_key: str | None = None,
    ) -> RunSession:
        data = self._request_json(
            "POST",
            f"/v1/sessions/{input_data.session_id}:complete",
            auth_mode="sdk",
            json_body=input_data,
            idempotency_key=idempotency_key,
        )
        return _to_run_session(data)

    def transition_deployment(self, input_data: TransitionDeploymentInput) -> DeploymentRecord:
        data = self._request_json(
            "POST",
            f"/v1/deployments/{input_data.deployment_id}:transition",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_deployment_record(data)

    def rollback_deployment(self, input_data: RollbackDeploymentInput) -> DeploymentRecord:
        data = self._request_json(
            "POST",
            f"/v1/deployments/{input_data.deployment_id}:rollback",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_deployment_record(data)

    def get_replay(self, session_id: str) -> ReplayedRunSession:
        data = self._request_json(
            "GET",
            f"/v1/sessions/{session_id}/replay",
            auth_mode="sdk",
        )
        return _to_replayed_run_session(data)

    def get_evidence_bundle(self, session_id: str) -> EvidenceBundle | None:
        data = self._request_json(
            "GET",
            f"/v1/evidence-bundles/{session_id}",
            auth_mode="sdk",
        )
        return None if data is None else _to_evidence_bundle(data)

    def get_ingest_job(self, job_id: str) -> IngestJobRecord | None:
        data = self._request_json(
            "GET",
            f"/v1/ingest-jobs/{job_id}",
            auth_mode="sdk",
        )
        return None if data is None else _to_ingest_job_record(data)

    def get_tenant(self, tenant_id: str) -> TenantRecord | None:
        data = self._request_json(
            "GET",
            f"/v1/tenants/{tenant_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_tenant_record(data)

    def list_deployments(self, tenant_id: str | None = None) -> list[DeploymentRecord]:
        data = self._request_json(
            "GET",
            "/v1/deployments",
            auth_mode="operator",
            params=None if tenant_id is None else {"tenantId": tenant_id},
        )
        return [_to_deployment_record(item) for item in data]

    def list_audit_events(self, tenant_id: str | None = None) -> list[AuditEvent]:
        data = self._request_json(
            "GET",
            "/v1/audit-events",
            auth_mode="operator",
            params=None if tenant_id is None else {"tenantId": tenant_id},
        )
        return [_to_audit_event(item) for item in data]


class HttpCipAdminTransport(_BaseHttpTransport):
    def create_tenant(self, input_data: RegisterTenantInput) -> TenantRecord:
        data = self._request_json(
            "POST",
            "/v1/admin/tenants",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_tenant_record(data)

    def list_tenants(self) -> list[TenantRecord]:
        data = self._request_json("GET", "/v1/admin/tenants", auth_mode="operator")
        return [_to_tenant_record(item) for item in data]

    def get_tenant(self, tenant_id: str) -> TenantRecord | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/tenants/{tenant_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_tenant_record(data)

    def create_connector_definition(
        self,
        input_data: RegisterConnectorDefinitionInput,
    ) -> ConnectorDefinition:
        data = self._request_json(
            "POST",
            "/v1/admin/connector-definitions",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_connector_definition(data)

    def list_connector_definitions(self) -> list[ConnectorDefinition]:
        data = self._request_json(
            "GET",
            "/v1/admin/connector-definitions",
            auth_mode="operator",
        )
        return [_to_connector_definition(item) for item in data]

    def get_connector_definition(self, record_id: str) -> ConnectorDefinition | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/connector-definitions/{record_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_connector_definition(data)

    def create_credential_binding(
        self,
        input_data: CreateCredentialBindingInput,
    ) -> CredentialBinding:
        data = self._request_json(
            "POST",
            "/v1/admin/credential-bindings",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_credential_binding(data)

    def list_credential_bindings(
        self,
        tenant_id: str | None = None,
    ) -> list[CredentialBinding]:
        data = self._request_json(
            "GET",
            "/v1/admin/credential-bindings",
            auth_mode="operator",
            params=None if tenant_id is None else {"tenantId": tenant_id},
        )
        return [_to_credential_binding(item) for item in data]

    def get_credential_binding(self, record_id: str) -> CredentialBinding | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/credential-bindings/{record_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_credential_binding(data)

    def create_connector_binding(
        self,
        input_data: CreateConnectorBindingInput,
    ) -> ConnectorBinding:
        data = self._request_json(
            "POST",
            "/v1/admin/connector-bindings",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_connector_binding(data)

    def list_connector_bindings(self, tenant_id: str | None = None) -> list[ConnectorBinding]:
        data = self._request_json(
            "GET",
            "/v1/admin/connector-bindings",
            auth_mode="operator",
            params=None if tenant_id is None else {"tenantId": tenant_id},
        )
        return [_to_connector_binding(item) for item in data]

    def get_connector_binding(self, record_id: str) -> ConnectorBinding | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/connector-bindings/{record_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_connector_binding(data)

    def publish_policy_pack(self, input_data: PublishPolicyPackInput) -> PolicyPack:
        data = self._request_json(
            "POST",
            "/v1/admin/policy-packs",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_policy_pack(data)

    def list_policy_packs(self, tenant_id: str | None = None) -> list[PolicyPack]:
        data = self._request_json(
            "GET",
            "/v1/admin/policy-packs",
            auth_mode="operator",
            params=None if tenant_id is None else {"tenantId": tenant_id},
        )
        return [_to_policy_pack(item) for item in data]

    def get_policy_pack(self, record_id: str) -> PolicyPack | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/policy-packs/{record_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_policy_pack(data)

    def publish_guardrail_definition(
        self,
        input_data: PublishGuardrailDefinitionInput,
    ) -> GuardrailDefinition:
        data = self._request_json(
            "POST",
            "/v1/admin/guardrail-definitions",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_guardrail_definition(data)

    def list_guardrail_definitions(self) -> list[GuardrailDefinition]:
        data = self._request_json(
            "GET",
            "/v1/admin/guardrail-definitions",
            auth_mode="operator",
        )
        return [_to_guardrail_definition(item) for item in data]

    def get_guardrail_definition(self, record_id: str) -> GuardrailDefinition | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/guardrail-definitions/{record_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_guardrail_definition(data)

    def register_agent_blueprint(
        self,
        input_data: RegisterAgentBlueprintInput,
    ) -> AgentBlueprint:
        data = self._request_json(
            "POST",
            "/v1/admin/agent-blueprints",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_agent_blueprint(data)

    def list_agent_blueprints(self) -> list[AgentBlueprint]:
        data = self._request_json(
            "GET",
            "/v1/admin/agent-blueprints",
            auth_mode="operator",
        )
        return [_to_agent_blueprint(item) for item in data]

    def get_agent_blueprint(self, record_id: str) -> AgentBlueprint | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/agent-blueprints/{record_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_agent_blueprint(data)

    def create_deployment(self, input_data: DeployAgentInput) -> DeploymentRecord:
        data = self._request_json(
            "POST",
            "/v1/admin/deployments",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_deployment_record(data)

    def list_deployments(self, tenant_id: str | None = None) -> list[DeploymentRecord]:
        data = self._request_json(
            "GET",
            "/v1/admin/deployments",
            auth_mode="operator",
            params=None if tenant_id is None else {"tenantId": tenant_id},
        )
        return [_to_deployment_record(item) for item in data]

    def get_deployment(self, record_id: str) -> DeploymentRecord | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/deployments/{record_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_deployment_record(data)

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/deployments/{deployment_id}/compliance-profile",
            auth_mode="operator",
        )
        return None if data is None else _to_compliance_profile(data)

    def upsert_compliance_profile(
        self,
        input_data: UpsertComplianceProfileInput,
    ) -> ComplianceProfile:
        data = self._request_json(
            "PUT",
            f"/v1/admin/deployments/{input_data.deployment_id}/compliance-profile",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_compliance_profile(data)

    def list_compliance_artifacts(
        self,
        deployment_id: str,
    ) -> list[ComplianceArtifact]:
        data = self._request_json(
            "GET",
            f"/v1/admin/deployments/{deployment_id}/compliance-artifacts",
            auth_mode="operator",
        )
        return [_to_compliance_artifact(item) for item in data]

    def create_compliance_artifact(
        self,
        input_data: CreateComplianceArtifactInput,
    ) -> ComplianceArtifact:
        data = self._request_json(
            "POST",
            f"/v1/admin/deployments/{input_data.deployment_id}/compliance-artifacts",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_compliance_artifact(data)

    def issue_api_key(self, input_data: CreateApiKeyRequest) -> IssuedApiKeyResponse:
        data = self._request_json(
            "POST",
            "/v1/admin/api-keys",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_issued_api_key_response(data)

    def list_api_keys(self, tenant_id: str | None = None) -> list[ApiKeyRecord]:
        data = self._request_json(
            "GET",
            "/v1/admin/api-keys",
            auth_mode="operator",
            params=None if tenant_id is None else {"tenantId": tenant_id},
        )
        return [_to_api_key_record(item) for item in data]

    def get_api_key(self, api_key_id: str) -> ApiKeyRecord | None:
        data = self._request_json(
            "GET",
            f"/v1/admin/api-keys/{api_key_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_api_key_record(data)

    def rotate_api_key(self, input_data: RotateApiKeyRequest) -> IssuedApiKeyResponse:
        data = self._request_json(
            "POST",
            f"/v1/admin/api-keys/{input_data.api_key_id}:rotate",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_issued_api_key_response(data)

    def revoke_api_key(self, input_data: RevokeApiKeyRequest) -> ApiKeyRecord:
        data = self._request_json(
            "POST",
            f"/v1/admin/api-keys/{input_data.api_key_id}:revoke",
            auth_mode="operator",
            json_body=input_data,
        )
        return _to_api_key_record(data)

    def get_ingest_job(self, job_id: str) -> IngestJobRecord | None:
        data = self._request_json(
            "GET",
            f"/v1/ingest-jobs/{job_id}",
            auth_mode="operator",
        )
        return None if data is None else _to_ingest_job_record(data)

    def list_dead_letter_jobs(self) -> list[DeadLetterJobRecord]:
        data = self._request_json(
            "GET",
            "/v1/admin/dead-letter-jobs",
            auth_mode="operator",
        )
        return [_to_dead_letter_job_record(item) for item in data]

    def requeue_dead_letter_job(
        self,
        input_data: RequeueDeadLetterJobRequest,
    ) -> IngestJobRecord | None:
        data = self._request_json(
            "POST",
            f"/v1/admin/dead-letter-jobs/{input_data.dead_letter_job_id}:requeue",
            auth_mode="operator",
            json_body=input_data,
        )
        return None if data is None else _to_ingest_job_record(data)


class CipClient:
    def __init__(self, transport: CipControlPlaneTransport) -> None:
        self._transport = transport

    def create_session(self, input_data: StartRunSessionInput, idempotency_key: str | None = None) -> RunSession:
        return self._transport.create_session(input_data, idempotency_key)

    def enqueue_events(self, batch: CipEventBatch, idempotency_key: str | None = None) -> CipIngestReceipt:
        return self._transport.enqueue_events(batch, idempotency_key)

    def request_approval(self, input_data: RequestHumanApprovalInput) -> ApprovalRequest:
        return self._transport.request_approval(input_data)

    def resolve_approval(self, input_data: ResolveApprovalRequestInput) -> ApprovalRequest:
        return self._transport.resolve_approval(input_data)

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None:
        return self._transport.get_compliance_profile(deployment_id)

    def record_disclosure(self, input_data: RecordDisclosureInput) -> DisclosureRecord:
        return self._transport.record_disclosure(input_data)

    def record_human_review(self, input_data: RecordHumanReviewInput) -> HumanReviewRecord:
        return self._transport.record_human_review(input_data)

    def complete_session(self, input_data: CompleteRunSessionInput, idempotency_key: str | None = None) -> RunSession:
        return self._transport.complete_session(input_data, idempotency_key)

    def transition_deployment(self, input_data: TransitionDeploymentInput) -> DeploymentRecord:
        return self._transport.transition_deployment(input_data)

    def rollback_deployment(self, input_data: RollbackDeploymentInput) -> DeploymentRecord:
        return self._transport.rollback_deployment(input_data)

    def get_replay(self, session_id: str) -> ReplayedRunSession:
        return self._transport.get_replay(session_id)

    def get_evidence_bundle(self, session_id: str) -> EvidenceBundle | None:
        return self._transport.get_evidence_bundle(session_id)

    def get_ingest_job(self, job_id: str) -> IngestJobRecord | None:
        return self._transport.get_ingest_job(job_id)

    def get_tenant(self, tenant_id: str) -> TenantRecord | None:
        return self._transport.get_tenant(tenant_id)

    def list_deployments(self, tenant_id: str | None = None) -> list[DeploymentRecord]:
        return self._transport.list_deployments(tenant_id)

    def list_audit_events(self, tenant_id: str | None = None) -> list[AuditEvent]:
        return self._transport.list_audit_events(tenant_id)


class CipAdminClient:
    def __init__(self, transport: CipAdminTransport) -> None:
        self._transport = transport

    def create_tenant(self, input_data: RegisterTenantInput) -> TenantRecord:
        return self._transport.create_tenant(input_data)

    def list_tenants(self) -> list[TenantRecord]:
        return self._transport.list_tenants()

    def get_tenant(self, tenant_id: str) -> TenantRecord | None:
        return self._transport.get_tenant(tenant_id)

    def create_connector_definition(
        self,
        input_data: RegisterConnectorDefinitionInput,
    ) -> ConnectorDefinition:
        return self._transport.create_connector_definition(input_data)

    def list_connector_definitions(self) -> list[ConnectorDefinition]:
        return self._transport.list_connector_definitions()

    def get_connector_definition(self, record_id: str) -> ConnectorDefinition | None:
        return self._transport.get_connector_definition(record_id)

    def create_credential_binding(
        self,
        input_data: CreateCredentialBindingInput,
    ) -> CredentialBinding:
        return self._transport.create_credential_binding(input_data)

    def list_credential_bindings(
        self,
        tenant_id: str | None = None,
    ) -> list[CredentialBinding]:
        return self._transport.list_credential_bindings(tenant_id)

    def get_credential_binding(self, record_id: str) -> CredentialBinding | None:
        return self._transport.get_credential_binding(record_id)

    def create_connector_binding(
        self,
        input_data: CreateConnectorBindingInput,
    ) -> ConnectorBinding:
        return self._transport.create_connector_binding(input_data)

    def list_connector_bindings(
        self,
        tenant_id: str | None = None,
    ) -> list[ConnectorBinding]:
        return self._transport.list_connector_bindings(tenant_id)

    def get_connector_binding(self, record_id: str) -> ConnectorBinding | None:
        return self._transport.get_connector_binding(record_id)

    def publish_policy_pack(self, input_data: PublishPolicyPackInput) -> PolicyPack:
        return self._transport.publish_policy_pack(input_data)

    def list_policy_packs(self, tenant_id: str | None = None) -> list[PolicyPack]:
        return self._transport.list_policy_packs(tenant_id)

    def get_policy_pack(self, record_id: str) -> PolicyPack | None:
        return self._transport.get_policy_pack(record_id)

    def publish_guardrail_definition(
        self,
        input_data: PublishGuardrailDefinitionInput,
    ) -> GuardrailDefinition:
        return self._transport.publish_guardrail_definition(input_data)

    def list_guardrail_definitions(self) -> list[GuardrailDefinition]:
        return self._transport.list_guardrail_definitions()

    def get_guardrail_definition(self, record_id: str) -> GuardrailDefinition | None:
        return self._transport.get_guardrail_definition(record_id)

    def register_agent_blueprint(
        self,
        input_data: RegisterAgentBlueprintInput,
    ) -> AgentBlueprint:
        return self._transport.register_agent_blueprint(input_data)

    def list_agent_blueprints(self) -> list[AgentBlueprint]:
        return self._transport.list_agent_blueprints()

    def get_agent_blueprint(self, record_id: str) -> AgentBlueprint | None:
        return self._transport.get_agent_blueprint(record_id)

    def create_deployment(self, input_data: DeployAgentInput) -> DeploymentRecord:
        return self._transport.create_deployment(input_data)

    def list_deployments(self, tenant_id: str | None = None) -> list[DeploymentRecord]:
        return self._transport.list_deployments(tenant_id)

    def get_deployment(self, record_id: str) -> DeploymentRecord | None:
        return self._transport.get_deployment(record_id)

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None:
        return self._transport.get_compliance_profile(deployment_id)

    def upsert_compliance_profile(
        self,
        input_data: UpsertComplianceProfileInput,
    ) -> ComplianceProfile:
        return self._transport.upsert_compliance_profile(input_data)

    def list_compliance_artifacts(
        self,
        deployment_id: str,
    ) -> list[ComplianceArtifact]:
        return self._transport.list_compliance_artifacts(deployment_id)

    def create_compliance_artifact(
        self,
        input_data: CreateComplianceArtifactInput,
    ) -> ComplianceArtifact:
        return self._transport.create_compliance_artifact(input_data)

    def issue_api_key(self, input_data: CreateApiKeyRequest) -> IssuedApiKeyResponse:
        return self._transport.issue_api_key(input_data)

    def list_api_keys(self, tenant_id: str | None = None) -> list[ApiKeyRecord]:
        return self._transport.list_api_keys(tenant_id)

    def get_api_key(self, api_key_id: str) -> ApiKeyRecord | None:
        return self._transport.get_api_key(api_key_id)

    def rotate_api_key(self, input_data: RotateApiKeyRequest) -> IssuedApiKeyResponse:
        return self._transport.rotate_api_key(input_data)

    def revoke_api_key(self, input_data: RevokeApiKeyRequest) -> ApiKeyRecord:
        return self._transport.revoke_api_key(input_data)

    def get_ingest_job(self, job_id: str) -> IngestJobRecord | None:
        return self._transport.get_ingest_job(job_id)

    def list_dead_letter_jobs(self) -> list[DeadLetterJobRecord]:
        return self._transport.list_dead_letter_jobs()

    def requeue_dead_letter_job(
        self,
        input_data: RequeueDeadLetterJobRequest,
    ) -> IngestJobRecord | None:
        return self._transport.requeue_dead_letter_job(input_data)


class CipRunTracker:
    def __init__(
        self,
        client: CipClient,
        actor: AuditActor | None = None,
        *,
        poll_interval_s: float = 0.2,
        max_poll_attempts: int = 20,
    ) -> None:
        self._client = client
        self._actor = actor or AuditActor(type="agent", id="cip-run-tracker")
        self._poll_interval_s = poll_interval_s
        self._max_poll_attempts = max_poll_attempts

    def create_session(self, input_data: StartRunSessionInput, idempotency_key: str | None = None) -> RunSession:
        return self._client.create_session(input_data, idempotency_key)

    def enqueue_run_event(
        self,
        tenant_id: str,
        session_id: str,
        *,
        event_type: str,
        payload: dict[str, Any] | None = None,
        trace_correlation: TraceCorrelation | None = None,
        occurred_at: str | None = None,
        idempotency_key: str | None = None,
    ) -> CipIngestReceipt:
        return self._client.enqueue_events(
            CipEventBatch(
                tenant_id=tenant_id,
                session_id=session_id,
                events=[
                    {
                        "kind": "run_event",
                        "type": event_type,
                        "actor": asdict(self._actor),
                        "payload": payload,
                        "trace_correlation": None if trace_correlation is None else asdict(trace_correlation),
                        "occurred_at": occurred_at,
                    }
                ],
            ),
            idempotency_key,
        )

    def enqueue_audit_event(
        self,
        tenant_id: str,
        session_id: str,
        *,
        category: str,
        action: str,
        payload: dict[str, Any],
        severity: str = "info",
        deployment_id: str | None = None,
        occurred_at: str | None = None,
        idempotency_key: str | None = None,
    ) -> CipIngestReceipt:
        return self._client.enqueue_events(
            CipEventBatch(
                tenant_id=tenant_id,
                session_id=session_id,
                events=[
                    {
                        "kind": "audit_event",
                        "category": category,
                        "action": action,
                        "actor": asdict(self._actor),
                        "payload": payload,
                        "severity": severity,
                        "deployment_id": deployment_id,
                        "occurred_at": occurred_at,
                    }
                ],
            ),
            idempotency_key,
        )

    def request_approval(self, session_id: str, checkpoint: HumanApprovalCheckpoint) -> ApprovalRequest:
        return self._client.request_approval(
            RequestHumanApprovalInput(
                session_id=session_id,
                checkpoint=checkpoint,
                actor=self._actor,
            )
        )

    def track_runtime_result(
        self,
        *,
        session_id: str,
        result: CipRunResult,
        approval_checkpoint: HumanApprovalCheckpoint | None = None,
    ) -> ApprovalRequest | RunSession:
        checkpoint = result.pending_approval or approval_checkpoint
        if checkpoint is not None:
            return self.request_approval(session_id, checkpoint)
        return self._client.complete_session(
            CompleteRunSessionInput(
                session_id=session_id,
                status="failed" if result.status == "failed" else "completed",
                output_summary=result.final_output,
            )
        )

    def get_replay(self, session_id: str) -> ReplayedRunSession:
        return self._client.get_replay(session_id)

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None:
        return self._client.get_compliance_profile(deployment_id)

    def record_disclosure(self, input_data: RecordDisclosureInput) -> DisclosureRecord:
        return self._client.record_disclosure(input_data)

    def record_human_review(self, input_data: RecordHumanReviewInput) -> HumanReviewRecord:
        return self._client.record_human_review(input_data)

    def get_evidence_bundle(self, session_id: str) -> EvidenceBundle | None:
        return self._client.get_evidence_bundle(session_id)

    def wait_for_ingest(self, job_id: str) -> IngestJobRecord | None:
        for _ in range(self._max_poll_attempts):
            job = self._client.get_ingest_job(job_id)
            if job is None or job.status in ("completed", "failed", "dead_letter"):
                return job
            time.sleep(self._poll_interval_s)
        return self._client.get_ingest_job(job_id)

    def wait_for_replay_status(
        self,
        session_id: str,
        status: str,
    ) -> ReplayedRunSession:
        for _ in range(self._max_poll_attempts):
            replay = self._client.get_replay(session_id)
            if replay.reconstructed_status == status:
                return replay
            time.sleep(self._poll_interval_s)
        return self._client.get_replay(session_id)

    def run_started(self, payload: dict[str, Any] | None = None, occurred_at: str | None = None) -> dict[str, Any]:
        return {
            "type": "run_started",
            "actor": asdict(self._actor),
            "payload": payload or {},
            "occurred_at": occurred_at,
        }

    def tool_called(self, payload: dict[str, Any], occurred_at: str | None = None) -> dict[str, Any]:
        return {
            "type": "tool_called",
            "actor": asdict(self._actor),
            "payload": payload,
            "occurred_at": occurred_at,
        }

    def tool_completed(self, payload: dict[str, Any], occurred_at: str | None = None) -> dict[str, Any]:
        return {
            "type": "tool_completed",
            "actor": asdict(self._actor),
            "payload": payload,
            "occurred_at": occurred_at,
        }

    def guardrail_triggered(self, payload: dict[str, Any], occurred_at: str | None = None) -> dict[str, Any]:
        return {
            "type": "guardrail_triggered",
            "actor": asdict(self._actor),
            "payload": payload,
            "occurred_at": occurred_at,
        }

    def policy_decided(self, payload: dict[str, Any], occurred_at: str | None = None) -> dict[str, Any]:
        return {
            "type": "policy_decided",
            "actor": asdict(self._actor),
            "payload": payload,
            "occurred_at": occurred_at,
        }

    def approval_requested(self, payload: dict[str, Any], occurred_at: str | None = None) -> dict[str, Any]:
        return {
            "type": "approval_requested",
            "actor": asdict(self._actor),
            "payload": payload,
            "occurred_at": occurred_at,
        }

    def run_completed(self, payload: dict[str, Any] | None = None, occurred_at: str | None = None) -> dict[str, Any]:
        return {
            "type": "run_completed",
            "actor": asdict(self._actor),
            "payload": payload or {},
            "occurred_at": occurred_at,
        }

    def run_failed(self, payload: dict[str, Any] | None = None, occurred_at: str | None = None) -> dict[str, Any]:
        return {
            "type": "run_failed",
            "actor": asdict(self._actor),
            "payload": payload or {},
            "occurred_at": occurred_at,
        }
