from __future__ import annotations

import unittest

from new_odyssey_cip import (
    CipControlPlane,
    CipControlPlaneError,
    CreateConnectorBindingInput,
    CreateCredentialBindingInput,
    DeployAgentInput,
    PolicyRule,
    PublishPolicyPackInput,
    RegisterAgentBlueprintInput,
    RegisterConnectorDefinitionInput,
    RegisterTenantInput,
    RuntimeProfile,
    StartRunSessionInput,
    CompleteRunSessionInput,
    create_cip_control_plane_agent,
    create_in_memory_cip_repositories,
)


class CipControlPlaneTests(unittest.TestCase):
    def test_workday_deployment_lifecycle(self) -> None:
        repositories = create_in_memory_cip_repositories()
        control_plane = CipControlPlane(repositories)

        tenant = control_plane.register_tenant(
            RegisterTenantInput(
                slug="acme-workday-security",
                display_name="Acme Workday Security",
                product_tier="pantheon",
                platforms=["workday"],
                regions=["eu-west-2"],
            )
        )

        connector_definition = control_plane.register_connector_definition(
            RegisterConnectorDefinitionInput(
                key="workday-mcp",
                platform="workday",
                display_name="Workday MCP Server",
                runtime="mcp",
                auth_strategy="service-account",
                source="first-party",
                capabilities=["security-groups", "signon-activity", "worker-data"],
            )
        )

        credential_binding = control_plane.create_credential_binding(
            CreateCredentialBindingInput(
                tenant_id=tenant.id,
                name="acme-workday-prod",
                provider="aws-secrets-manager",
                secret_ref="arn:aws:secretsmanager:eu-west-2:123456789012:secret:workday-prod",
                scopes=["tenant:prod", "workday:security"],
            )
        )

        connector_binding = control_plane.create_connector_binding(
            CreateConnectorBindingInput(
                tenant_id=tenant.id,
                connector_definition_id=connector_definition.id,
                credential_binding_id=credential_binding.id,
                environment="production",
                alias="workday-prod",
                endpoint="https://acme.workday.com/ccx/service/customreport2",
                config={"tenantAlias": "acme_prod"},
            )
        )

        policy_pack = control_plane.publish_policy_pack(
            PublishPolicyPackInput(
                key="workday-security-baseline",
                name="Workday Security Baseline",
                domain="security",
                version="1.0.0",
                ownership="shared",
                rules=[
                    PolicyRule(
                        id="least-privilege",
                        name="Least Privilege",
                        expression="isu.scope <= observed.scope",
                        severity="high",
                        action="flag",
                    )
                ],
                guardrail_refs=["pii-boundary", "sox-audit"],
            )
        )

        blueprint = control_plane.register_agent_blueprint(
            RegisterAgentBlueprintInput(
                key="security-diagnostic-agent",
                name="Security Diagnostic Agent",
                product_tier="pantheon",
                domain="security",
                description="Natural-language troubleshooting for Workday security and access issues.",
                runtime=RuntimeProfile(
                    provider="openai-agents-sdk",
                    model_profile="reasoning",
                ),
                connector_definition_ids=[connector_definition.id],
                policy_pack_ids=[policy_pack.id],
                handoff_targets=["tenant-drift-detection-agent"],
            )
        )

        deployment = control_plane.deploy_agent(
            DeployAgentInput(
                tenant_id=tenant.id,
                agent_blueprint_id=blueprint.id,
                environment="production",
                connector_binding_ids=[connector_binding.id],
                tags=["workday", "security"],
            )
        )

        session = control_plane.start_run_session(
            StartRunSessionInput(
                tenant_id=tenant.id,
                deployment_id=deployment.id,
                input_summary="Why can't Maria run the Year-End Tax Report?",
            )
        )

        completed_session = control_plane.complete_run_session(
            CompleteRunSessionInput(
                session_id=session.id,
                status="completed",
                output_summary="Maria is missing the report domain security group.",
            )
        )

        self.assertEqual(deployment.status, "active")
        self.assertEqual(completed_session.status, "completed")
        self.assertEqual(completed_session.revision, 2)

        audit_events = repositories.audit_events.list()
        session_actions = [event.action for event in audit_events if event.session_id == session.id]
        self.assertEqual(session_actions, ["session.started", "session.completed"])

    def test_deploy_agent_requires_connector_bindings(self) -> None:
        repositories = create_in_memory_cip_repositories()
        control_plane = CipControlPlane(repositories)

        tenant = control_plane.register_tenant(
            RegisterTenantInput(
                slug="acme-governance",
                display_name="Acme Governance",
                product_tier="pantheon",
                platforms=["workday"],
                regions=["eu-west-2"],
            )
        )

        connector_definition = control_plane.register_connector_definition(
            RegisterConnectorDefinitionInput(
                key="workday-mcp",
                platform="workday",
                display_name="Workday MCP Server",
                runtime="mcp",
                auth_strategy="service-account",
                source="first-party",
                capabilities=["security-groups"],
            )
        )

        policy_pack = control_plane.publish_policy_pack(
            PublishPolicyPackInput(
                key="security-baseline",
                name="Security Baseline",
                domain="security",
                version="1.0.0",
                ownership="shared",
                rules=[],
            )
        )

        blueprint = control_plane.register_agent_blueprint(
            RegisterAgentBlueprintInput(
                key="tenant-drift-agent",
                name="Tenant Drift Agent",
                product_tier="pantheon",
                domain="security",
                description="Detects security drift across Workday tenants.",
                runtime=RuntimeProfile(
                    provider="openai-agents-sdk",
                    model_profile="default",
                ),
                connector_definition_ids=[connector_definition.id],
                policy_pack_ids=[policy_pack.id],
            )
        )

        with self.assertRaisesRegex(
            CipControlPlaneError,
            f"missing required connector bindings for blueprint {blueprint.key}",
        ):
            control_plane.deploy_agent(
                DeployAgentInput(
                    tenant_id=tenant.id,
                    agent_blueprint_id=blueprint.id,
                    environment="production",
                    connector_binding_ids=[],
                )
            )

    def test_create_cip_control_plane_agent_uses_openai_agents_sdk(self) -> None:
        repositories = create_in_memory_cip_repositories()
        agent = create_cip_control_plane_agent(repositories)

        self.assertEqual(agent.name, "CIP Control Plane Assistant")
        self.assertEqual(len(agent.tools), 3)


if __name__ == "__main__":
    unittest.main()
