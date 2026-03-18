from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Protocol

from .records import ConnectorRateBucket, Environment
from .repositories import ConnectorRateBucketFilter, MutableRepository


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class RateLimitPolicy:
    max_requests_per_second: int


@dataclass(slots=True)
class ConnectorToolContract:
    name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]


@dataclass(slots=True)
class ConnectorManifest:
    key: str
    version: str
    platform: str
    description: str
    tools: list[ConnectorToolContract]
    rate_limit_policy: RateLimitPolicy


@dataclass(slots=True)
class ConnectorHealthcheckResult:
    connector_key: str
    status: str
    checked_at: str
    details: dict[str, Any]


@dataclass(slots=True)
class ConnectorQuotaRequest:
    provider: str
    external_system_tenant: str
    environment: Environment
    api_family: str
    max_requests_per_second: int


@dataclass(slots=True)
class ConnectorQuotaLease:
    granted: bool
    bucket: ConnectorRateBucket
    retry_after_ms: int


class ConnectorQuotaCoordinator(Protocol):
    def acquire(self, request: ConnectorQuotaRequest) -> ConnectorQuotaLease: ...


@dataclass(slots=True)
class ConnectorStubContext:
    tenant_id: str
    external_system_tenant: str
    environment: Environment
    quota_coordinator: ConnectorQuotaCoordinator


@dataclass(slots=True)
class ConnectorToolExecutionResult:
    status: str
    connector_key: str
    tool_name: str
    quota: ConnectorQuotaLease
    message: str
    data: dict[str, Any]


class RepositoryConnectorQuotaCoordinator:
    def __init__(
        self,
        buckets: MutableRepository[ConnectorRateBucket, ConnectorRateBucketFilter],
    ) -> None:
        self._buckets = buckets
        self._locks: dict[str, Lock] = {}

    def acquire(self, request: ConnectorQuotaRequest) -> ConnectorQuotaLease:
        bucket_key = ":".join(
            [
                request.provider,
                request.external_system_tenant,
                request.environment,
                request.api_family,
            ]
        )
        lock = self._locks.setdefault(bucket_key, Lock())
        with lock:
            existing = self._buckets.list(
                ConnectorRateBucketFilter(
                    provider=request.provider,
                    external_system_tenant=request.external_system_tenant,
                    environment=request.environment,
                    api_family=request.api_family,
                )
            )
            bucket = existing[0] if existing else ConnectorRateBucket(
                id=bucket_key,
                created_at=_now_iso(),
                updated_at=_now_iso(),
                revision=1,
                provider=request.provider,
                external_system_tenant=request.external_system_tenant,
                environment=request.environment,
                api_family=request.api_family,
                max_requests_per_second=request.max_requests_per_second,
                available_tokens=float(request.max_requests_per_second),
                last_refill_at=_now_iso(),
                queue_depth=0,
                status="active",
            )

            now = datetime.now(UTC).timestamp()
            elapsed_seconds = now - datetime.fromisoformat(bucket.last_refill_at).timestamp()
            refilled_tokens = min(
                bucket.max_requests_per_second,
                bucket.available_tokens + elapsed_seconds * bucket.max_requests_per_second,
            )
            granted = refilled_tokens >= 1
            next_bucket = ConnectorRateBucket(
                id=bucket.id,
                created_at=bucket.created_at,
                updated_at=_now_iso(),
                revision=bucket.revision + 1,
                provider=bucket.provider,
                external_system_tenant=bucket.external_system_tenant,
                environment=bucket.environment,
                api_family=bucket.api_family,
                max_requests_per_second=bucket.max_requests_per_second,
                available_tokens=refilled_tokens - 1 if granted else refilled_tokens,
                last_refill_at=_now_iso(),
                queue_depth=0 if granted else bucket.queue_depth + 1,
                status=bucket.status,
            )
            self._buckets.save(next_bucket)
            return ConnectorQuotaLease(
                granted=granted,
                bucket=next_bucket,
                retry_after_ms=0 if granted else int(1000 / bucket.max_requests_per_second),
            )


def _execute_stub_tool(
    context: ConnectorStubContext,
    *,
    connector_key: str,
    provider: str,
    api_family: str,
    max_requests_per_second: int,
    tool_name: str,
) -> ConnectorToolExecutionResult:
    quota = context.quota_coordinator.acquire(
        ConnectorQuotaRequest(
            provider=provider,
            external_system_tenant=context.external_system_tenant,
            environment=context.environment,
            api_family=api_family,
            max_requests_per_second=max_requests_per_second,
        )
    )
    return ConnectorToolExecutionResult(
        status="not_implemented",
        connector_key=connector_key,
        tool_name=tool_name,
        quota=quota,
        message=f"{tool_name} is a {connector_key} connector stub in phase 1.",
        data={
            "external_system_tenant": context.external_system_tenant,
            "tenant_id": context.tenant_id,
        },
    )


workday_connector_manifest = ConnectorManifest(
    key="workday",
    version="1.0.0",
    platform="workday",
    description="Workday connector stub for CIP phase 1.",
    rate_limit_policy=RateLimitPolicy(max_requests_per_second=10),
    tools=[
        ConnectorToolContract(
            name="list_security_groups",
            description="List security groups for a Workday tenant.",
            input_schema={"type": "object", "properties": {}},
            output_schema={"type": "object", "properties": {"groups": {"type": "array"}}},
        ),
        ConnectorToolContract(
            name="get_worker",
            description="Get worker details by worker id.",
            input_schema={
                "type": "object",
                "required": ["workerId"],
                "properties": {"workerId": {"type": "string"}},
            },
            output_schema={"type": "object", "properties": {"worker": {"type": "object"}}},
        ),
        ConnectorToolContract(
            name="list_signon_activity",
            description="List signon activity for a Workday tenant.",
            input_schema={"type": "object", "properties": {}},
            output_schema={"type": "object", "properties": {"activity": {"type": "array"}}},
        ),
        ConnectorToolContract(
            name="list_domain_policies",
            description="List domain security policies for a Workday tenant.",
            input_schema={"type": "object", "properties": {}},
            output_schema={"type": "object", "properties": {"policies": {"type": "array"}}},
        ),
    ],
)


def workday_connector_healthcheck() -> ConnectorHealthcheckResult:
    return ConnectorHealthcheckResult(
        connector_key="workday",
        status="not_implemented",
        checked_at=_now_iso(),
        details={"phase": "stub"},
    )


class WorkdayConnectorStub:
    manifest = workday_connector_manifest

    @staticmethod
    def healthcheck() -> ConnectorHealthcheckResult:
        return workday_connector_healthcheck()

    @staticmethod
    def list_security_groups(context: ConnectorStubContext) -> ConnectorToolExecutionResult:
        return _execute_stub_tool(
            context,
            connector_key="workday",
            provider="workday",
            api_family="rest",
            max_requests_per_second=10,
            tool_name="list_security_groups",
        )

    @staticmethod
    def get_worker(context: ConnectorStubContext) -> ConnectorToolExecutionResult:
        return _execute_stub_tool(
            context,
            connector_key="workday",
            provider="workday",
            api_family="rest",
            max_requests_per_second=10,
            tool_name="get_worker",
        )

    @staticmethod
    def list_signon_activity(context: ConnectorStubContext) -> ConnectorToolExecutionResult:
        return _execute_stub_tool(
            context,
            connector_key="workday",
            provider="workday",
            api_family="rest",
            max_requests_per_second=10,
            tool_name="list_signon_activity",
        )

    @staticmethod
    def list_domain_policies(context: ConnectorStubContext) -> ConnectorToolExecutionResult:
        return _execute_stub_tool(
            context,
            connector_key="workday",
            provider="workday",
            api_family="rest",
            max_requests_per_second=10,
            tool_name="list_domain_policies",
        )


workday_connector_stub = WorkdayConnectorStub()


dynamics365_connector_manifest = ConnectorManifest(
    key="dynamics365",
    version="1.0.0",
    platform="dynamics365",
    description="Dynamics 365 connector stub for CIP phase 1.",
    rate_limit_policy=RateLimitPolicy(max_requests_per_second=25),
    tools=[
        ConnectorToolContract(
            name="list_users",
            description="List users for a Dynamics 365 tenant.",
            input_schema={"type": "object", "properties": {}},
            output_schema={"type": "object", "properties": {"users": {"type": "array"}}},
        ),
        ConnectorToolContract(
            name="get_account",
            description="Get an account by id.",
            input_schema={
                "type": "object",
                "required": ["accountId"],
                "properties": {"accountId": {"type": "string"}},
            },
            output_schema={"type": "object", "properties": {"account": {"type": "object"}}},
        ),
        ConnectorToolContract(
            name="list_integrations",
            description="List configured integrations.",
            input_schema={"type": "object", "properties": {}},
            output_schema={"type": "object", "properties": {"integrations": {"type": "array"}}},
        ),
        ConnectorToolContract(
            name="list_audit_events",
            description="List Dynamics 365 audit events.",
            input_schema={"type": "object", "properties": {}},
            output_schema={"type": "object", "properties": {"auditEvents": {"type": "array"}}},
        ),
    ],
)


def dynamics365_connector_healthcheck() -> ConnectorHealthcheckResult:
    return ConnectorHealthcheckResult(
        connector_key="dynamics365",
        status="not_implemented",
        checked_at=_now_iso(),
        details={"phase": "stub"},
    )


class Dynamics365ConnectorStub:
    manifest = dynamics365_connector_manifest

    @staticmethod
    def healthcheck() -> ConnectorHealthcheckResult:
        return dynamics365_connector_healthcheck()

    @staticmethod
    def list_users(context: ConnectorStubContext) -> ConnectorToolExecutionResult:
        return _execute_stub_tool(
            context,
            connector_key="dynamics365",
            provider="dynamics365",
            api_family="odata",
            max_requests_per_second=25,
            tool_name="list_users",
        )

    @staticmethod
    def get_account(context: ConnectorStubContext) -> ConnectorToolExecutionResult:
        return _execute_stub_tool(
            context,
            connector_key="dynamics365",
            provider="dynamics365",
            api_family="odata",
            max_requests_per_second=25,
            tool_name="get_account",
        )

    @staticmethod
    def list_integrations(context: ConnectorStubContext) -> ConnectorToolExecutionResult:
        return _execute_stub_tool(
            context,
            connector_key="dynamics365",
            provider="dynamics365",
            api_family="odata",
            max_requests_per_second=25,
            tool_name="list_integrations",
        )

    @staticmethod
    def list_audit_events(context: ConnectorStubContext) -> ConnectorToolExecutionResult:
        return _execute_stub_tool(
            context,
            connector_key="dynamics365",
            provider="dynamics365",
            api_family="odata",
            max_requests_per_second=25,
            tool_name="list_audit_events",
        )


dynamics365_connector_stub = Dynamics365ConnectorStub()
