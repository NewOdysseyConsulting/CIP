from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Protocol

import httpx

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
    driver_key: str | None = None
    driver_config: dict[str, Any] | None = None


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
class ConnectorInvocationContext(ConnectorStubContext):
    endpoint: str
    headers: dict[str, str] | None = None


@dataclass(slots=True)
class ConnectorToolExecutionResult:
    status: str
    connector_key: str
    tool_name: str
    quota: ConnectorQuotaLease
    message: str
    data: dict[str, Any]


@dataclass(slots=True)
class HttpJsonConnectorOperation:
    tool_name: str
    method: str
    path: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    request_headers: dict[str, str] | None = None


class ConnectorBackend(Protocol):
    key: str

    def healthcheck(
        self,
        manifest: ConnectorManifest,
        context: ConnectorInvocationContext,
    ) -> ConnectorHealthcheckResult: ...

    def invoke(
        self,
        manifest: ConnectorManifest,
        operation: HttpJsonConnectorOperation | ConnectorToolContract,
        context: ConnectorInvocationContext,
        input_data: dict[str, Any],
    ) -> ConnectorToolExecutionResult: ...


class ConnectorBackendRegistry:
    def __init__(self, backends: list[ConnectorBackend] | None = None) -> None:
        self._backends: dict[str, ConnectorBackend] = {}
        for backend in backends or []:
            self.register(backend)

    def register(self, backend: ConnectorBackend) -> None:
        self._backends[backend.key] = backend

    def get(self, key: str) -> ConnectorBackend | None:
        return self._backends.get(key)


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


def _acquire_quota_for_manifest(
    context: ConnectorInvocationContext,
    manifest: ConnectorManifest,
    provider: str,
    api_family: str = "http-json",
) -> ConnectorQuotaLease:
    return context.quota_coordinator.acquire(
        ConnectorQuotaRequest(
            provider=provider,
            external_system_tenant=context.external_system_tenant,
            environment=context.environment,
            api_family=api_family,
            max_requests_per_second=manifest.rate_limit_policy.max_requests_per_second,
        )
    )


def _interpolate_path(path: str, input_data: dict[str, Any]) -> str:
    result = path
    for key, value in input_data.items():
        result = result.replace(f"{{{key}}}", str(value))
    if "{" in result:
        raise ValueError(f"missing path parameter in {path}")
    return result


class HttpJsonConnectorBackend:
    key = "http-json"

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client()

    def healthcheck(
        self,
        manifest: ConnectorManifest,
        context: ConnectorInvocationContext,
    ) -> ConnectorHealthcheckResult:
        quota = _acquire_quota_for_manifest(context, manifest, manifest.key)
        if not quota.granted:
            return ConnectorHealthcheckResult(
                connector_key=manifest.key,
                status="degraded",
                checked_at=_now_iso(),
                details={"retry_after_ms": quota.retry_after_ms},
            )
        try:
            response = self._client.get(
                context.endpoint,
                headers=context.headers or {},
            )
            return ConnectorHealthcheckResult(
                connector_key=manifest.key,
                status="ready" if response.is_success else "failed",
                checked_at=_now_iso(),
                details={"status_code": response.status_code},
            )
        except Exception as error:
            return ConnectorHealthcheckResult(
                connector_key=manifest.key,
                status="failed",
                checked_at=_now_iso(),
                details={"error": str(error)},
            )

    def invoke(
        self,
        manifest: ConnectorManifest,
        operation: HttpJsonConnectorOperation | ConnectorToolContract,
        context: ConnectorInvocationContext,
        input_data: dict[str, Any],
    ) -> ConnectorToolExecutionResult:
        quota = _acquire_quota_for_manifest(context, manifest, manifest.key)
        tool_name = operation.name if isinstance(operation, ConnectorToolContract) else operation.tool_name
        if not quota.granted:
            return ConnectorToolExecutionResult(
                status="failed",
                connector_key=manifest.key,
                tool_name=tool_name,
                quota=quota,
                message="connector quota exhausted",
                data={"retry_after_ms": quota.retry_after_ms},
            )
        if isinstance(operation, ConnectorToolContract):
            return ConnectorToolExecutionResult(
                status="not_implemented",
                connector_key=manifest.key,
                tool_name=tool_name,
                quota=quota,
                message=f"{tool_name} is not backed by a live HTTP operation",
                data={"phase": "stub"},
            )

        url = httpx.URL(context.endpoint).join(_interpolate_path(operation.path, input_data))
        response = self._client.request(
            operation.method,
            str(url),
            headers={**(operation.request_headers or {}), **(context.headers or {})},
            json=None if operation.method in {"GET", "DELETE"} else input_data,
        )
        data: dict[str, Any]
        try:
            data = {"response": response.json()}
        except Exception:
            data = {"response": response.text}
        return ConnectorToolExecutionResult(
            status="ok" if response.is_success else "failed",
            connector_key=manifest.key,
            tool_name=tool_name,
            quota=quota,
            message="connector operation succeeded" if response.is_success else "connector operation failed",
            data={"status_code": response.status_code, **data},
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
