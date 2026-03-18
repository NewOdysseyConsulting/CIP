from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .connectors import dynamics365_connector_healthcheck, workday_connector_healthcheck
from .policy import PolicyEvaluationContext, PolicyEvaluator
from .repositories import (
    AuditEventFilter,
    CipRepositories,
    DeploymentFilter,
    GuardrailDefinitionFilter,
)


@dataclass(slots=True)
class AdminApiResponse:
    status: int
    data: Any


class AdminApiHandlers:
    def __init__(
        self,
        control_plane: Any,
        repositories: CipRepositories,
        policy_evaluator: PolicyEvaluator,
        connector_healthchecks: dict[str, Callable[[], Any]] | None = None,
    ) -> None:
        self._control_plane = control_plane
        self._repositories = repositories
        self._policy_evaluator = policy_evaluator
        self._connector_healthchecks = connector_healthchecks or {
            "workday": workday_connector_healthcheck,
            "dynamics365": dynamics365_connector_healthcheck,
        }

    def get_tenant(self, tenant_id: str) -> AdminApiResponse:
        return AdminApiResponse(status=200, data=self._repositories.tenants.get_by_id(tenant_id))

    def get_deployments(self, tenant_id: str | None = None) -> AdminApiResponse:
        return AdminApiResponse(
            status=200,
            data=self._repositories.deployments.list(
                None if tenant_id is None else DeploymentFilter(tenant_id=tenant_id)
            ),
        )

    def get_session(self, session_id: str) -> AdminApiResponse:
        return AdminApiResponse(status=200, data=self._control_plane.replay_run_session(session_id))

    def get_audit_events(self, tenant_id: str | None = None) -> AdminApiResponse:
        return AdminApiResponse(
            status=200,
            data=self._repositories.audit_events.list(
                None if tenant_id is None else AuditEventFilter(tenant_id=tenant_id)
            ),
        )

    def evaluate_policy(self, policy_pack_id: str, context: PolicyEvaluationContext) -> AdminApiResponse:
        policy_pack = self._repositories.policy_packs.get_by_id(policy_pack_id)
        if policy_pack is None:
            return AdminApiResponse(status=404, data={"error": f"unknown policy pack {policy_pack_id}"})
        guardrails = self._repositories.guardrail_definitions.list(
            GuardrailDefinitionFilter(status="active")
        )
        return AdminApiResponse(
            status=200,
            data=self._policy_evaluator.evaluate(policy_pack, context, guardrails),
        )

    def get_connectors(self) -> AdminApiResponse:
        return AdminApiResponse(status=200, data=self._repositories.connector_definitions.list())

    def post_connector_healthcheck(self, connector_key: str) -> AdminApiResponse:
        healthcheck = self._connector_healthchecks.get(connector_key)
        if healthcheck is None:
            return AdminApiResponse(status=404, data={"error": f"unknown connector {connector_key}"})
        return AdminApiResponse(status=200, data=healthcheck())


def create_admin_api_handlers(
    control_plane: Any,
    repositories: CipRepositories,
    policy_evaluator: PolicyEvaluator,
    connector_healthchecks: dict[str, Callable[[], Any]] | None = None,
) -> AdminApiHandlers:
    return AdminApiHandlers(control_plane, repositories, policy_evaluator, connector_healthchecks)
