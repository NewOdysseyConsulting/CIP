from __future__ import annotations

from dataclasses import asdict
from typing import Any

from agents import Agent, function_tool

from .repositories import CipRepositories, DeploymentFilter, PolicyPackFilter


DEFAULT_INSTRUCTIONS = (
    "You are the CIP control-plane assistant for New Odyssey. "
    "Use the provided tools to inspect tenants, deployments, and policy packs. "
    "Do not invent repository state."
)


def create_cip_control_plane_agent(
    repositories: CipRepositories,
    *,
    name: str = "CIP Control Plane Assistant",
    instructions: str = DEFAULT_INSTRUCTIONS,
) -> Agent[Any]:
    @function_tool
    def get_tenant(tenant_id: str) -> dict[str, Any]:
        tenant = repositories.tenants.get_by_id(tenant_id)
        return asdict(tenant) if tenant is not None else {"found": False, "tenant_id": tenant_id}

    @function_tool
    def list_deployments(
        tenant_id: str,
        environment: str | None = None,
    ) -> list[dict[str, Any]]:
        deployments = repositories.deployments.list(
            DeploymentFilter(tenant_id=tenant_id, environment=environment)
        )
        return [asdict(deployment) for deployment in deployments]

    @function_tool
    def list_policy_packs(domain: str) -> list[dict[str, Any]]:
        policy_packs = repositories.policy_packs.list(
            PolicyPackFilter(domain=domain, status="active")
        )
        return [asdict(policy_pack) for policy_pack in policy_packs]

    return Agent(
        name=name,
        instructions=instructions,
        tools=[get_tenant, list_deployments, list_policy_packs],
    )
