from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

import httpx

from .control_plane import (
    AppendAuditEventInput,
    AppendRunEventInput,
    CipControlPlane,
    CompleteRunSessionInput,
    ReplayedRunSession,
    RequestHumanApprovalInput,
    ResolveApprovalRequestInput,
    RollbackDeploymentInput,
    StartRunSessionInput,
    TransitionDeploymentInput,
)
from .records import (
    ApprovalRequest,
    AuditActor,
    AuditEvent,
    BlueprintDependencySnapshot,
    DependencyVersionReference,
    DeploymentRecord,
    EvidenceBundle,
    RunEvent,
    RunSession,
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
    payload = _snakify(data)
    return TraceCorrelation(**payload)


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


def _to_run_session(data: dict[str, Any]) -> RunSession:
    payload = _snakify(data)
    return RunSession(
        **{
            **payload,
            "trace_correlation": _to_trace_correlation(payload.get("trace_correlation")),
        }
    )


def _to_run_event(data: dict[str, Any]) -> RunEvent:
    payload = _snakify(data)
    return RunEvent(
        **{
            **payload,
            "actor": _to_audit_actor(payload["actor"]),
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
        }
    )


def _to_tenant_record(data: dict[str, Any]) -> TenantRecord:
    return TenantRecord(**_snakify(data))


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
        }
    )


def _to_replayed_run_session(data: dict[str, Any]) -> ReplayedRunSession:
    payload = _snakify(data)
    evidence_bundle = payload.get("evidence_bundle")
    return ReplayedRunSession(
        session=_to_run_session(payload["session"]),
        run_events=[_to_run_event(item) for item in payload["run_events"]],
        approval_requests=[_to_approval_request(item) for item in payload["approval_requests"]],
        evidence_bundle=None if evidence_bundle is None else _to_evidence_bundle(evidence_bundle),
        reconstructed_status=payload["reconstructed_status"],
    )


@dataclass(slots=True)
class CipRunEventEnvelope:
    kind: str
    type: str
    actor: dict[str, Any] | None = None
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

    def get_tenant(self, tenant_id: str) -> TenantRecord | None: ...

    def list_deployments(
        self,
        tenant_id: str | None = None,
    ) -> list[DeploymentRecord]: ...

    def list_audit_events(
        self,
        tenant_id: str | None = None,
    ) -> list[AuditEvent]: ...


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
                        actor=None if event.get("actor") is None else AuditActor(**event["actor"]),
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
                    actor=AuditActor(**event["actor"]),
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


class HttpCipControlPlaneTransport:
    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        operator_token: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self._api_key = api_key
        self._operator_token = operator_token
        self._client = client or httpx.Client(base_url=base_url.rstrip("/"))

    def _headers(self, auth_mode: str, idempotency_key: str | None = None) -> dict[str, str]:
        token = self._api_key if auth_mode == "sdk" else self._operator_token
        headers = {"content-type": "application/json"}
        if token is not None:
            headers["authorization"] = f"Bearer {token}"
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    @staticmethod
    def _json(response: httpx.Response) -> Any:
        response.raise_for_status()
        if response.status_code == 204:
            return None
        return response.json()

    def create_session(
        self,
        input_data: StartRunSessionInput,
        idempotency_key: str | None = None,
    ) -> RunSession:
        data = self._json(
            self._client.post(
                "/v1/sessions",
                headers=self._headers("sdk", idempotency_key),
                json=_camelize(input_data),
            )
        )
        return _to_run_session(data)

    def enqueue_events(
        self,
        batch: CipEventBatch,
        idempotency_key: str | None = None,
    ) -> CipIngestReceipt:
        data = self._json(
            self._client.post(
                f"/v1/sessions/{batch.session_id}/events:enqueue",
                headers=self._headers("sdk", idempotency_key),
                json=_camelize(batch),
            )
        )
        payload = _snakify(data)
        return CipIngestReceipt(**payload)

    def request_approval(self, input_data: RequestHumanApprovalInput) -> ApprovalRequest:
        data = self._json(
            self._client.post(
                f"/v1/sessions/{input_data.session_id}/approval-requests",
                headers=self._headers("sdk"),
                json=_camelize(input_data),
            )
        )
        return _to_approval_request(data)

    def resolve_approval(self, input_data: ResolveApprovalRequestInput) -> ApprovalRequest:
        data = self._json(
            self._client.post(
                f"/v1/approval-requests/{input_data.approval_request_id}:resolve",
                headers=self._headers("operator"),
                json=_camelize(input_data),
            )
        )
        return _to_approval_request(data)

    def complete_session(
        self,
        input_data: CompleteRunSessionInput,
        idempotency_key: str | None = None,
    ) -> RunSession:
        data = self._json(
            self._client.post(
                f"/v1/sessions/{input_data.session_id}:complete",
                headers=self._headers("sdk", idempotency_key),
                json=_camelize(input_data),
            )
        )
        return _to_run_session(data)

    def transition_deployment(self, input_data: TransitionDeploymentInput) -> DeploymentRecord:
        data = self._json(
            self._client.post(
                f"/v1/deployments/{input_data.deployment_id}:transition",
                headers=self._headers("operator"),
                json=_camelize(input_data),
            )
        )
        return _to_deployment_record(data)

    def rollback_deployment(self, input_data: RollbackDeploymentInput) -> DeploymentRecord:
        data = self._json(
            self._client.post(
                f"/v1/deployments/{input_data.deployment_id}:rollback",
                headers=self._headers("operator"),
                json=_camelize(input_data),
            )
        )
        return _to_deployment_record(data)

    def get_replay(self, session_id: str) -> ReplayedRunSession:
        data = self._json(
            self._client.get(
                f"/v1/sessions/{session_id}/replay",
                headers=self._headers("sdk"),
            )
        )
        return _to_replayed_run_session(data)

    def get_evidence_bundle(self, session_id: str) -> EvidenceBundle | None:
        data = self._json(
            self._client.get(
                f"/v1/evidence-bundles/{session_id}",
                headers=self._headers("sdk"),
            )
        )
        return None if data is None else _to_evidence_bundle(data)

    def get_tenant(self, tenant_id: str) -> TenantRecord | None:
        data = self._json(
            self._client.get(
                f"/v1/tenants/{tenant_id}",
                headers=self._headers("operator"),
            )
        )
        return None if data is None else _to_tenant_record(data)

    def list_deployments(self, tenant_id: str | None = None) -> list[DeploymentRecord]:
        data = self._json(
            self._client.get(
                "/v1/deployments",
                headers=self._headers("operator"),
                params={} if tenant_id is None else {"tenantId": tenant_id},
            )
        )
        return [_to_deployment_record(item) for item in data]

    def list_audit_events(self, tenant_id: str | None = None) -> list[AuditEvent]:
        data = self._json(
            self._client.get(
                "/v1/audit-events",
                headers=self._headers("operator"),
                params={} if tenant_id is None else {"tenantId": tenant_id},
            )
        )
        return [_to_audit_event(item) for item in data]


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

    def get_tenant(self, tenant_id: str) -> TenantRecord | None:
        return self._transport.get_tenant(tenant_id)

    def list_deployments(self, tenant_id: str | None = None) -> list[DeploymentRecord]:
        return self._transport.list_deployments(tenant_id)

    def list_audit_events(self, tenant_id: str | None = None) -> list[AuditEvent]:
        return self._transport.list_audit_events(tenant_id)


class CipRunTracker:
    def __init__(self, client: CipClient, actor: AuditActor | None = None) -> None:
        self._client = client
        self._actor = actor or AuditActor(type="agent", id="cip-run-tracker")

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

    def get_evidence_bundle(self, session_id: str) -> EvidenceBundle | None:
        return self._client.get_evidence_bundle(session_id)
