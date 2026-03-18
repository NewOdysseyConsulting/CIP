from __future__ import annotations

import os
import unittest

from new_odyssey_cip import (
    AppendRunEventInput,
    CipAgentSpec,
    CipControlPlane,
    CipControlPlaneError,
    CipRunRequest,
    CompleteRunSessionInput,
    ConnectorStubContext,
    CreateConnectorBindingInput,
    CreateCredentialBindingInput,
    DeployAgentInput,
    DeterministicPolicyEvaluator,
    EnvironmentSecretResolver,
    HumanApprovalCheckpoint,
    InMemoryTelemetrySink,
    OpenAIAgentsRuntimeAdapter,
    PolicyClause,
    PolicyCondition,
    PolicyEvaluationContext,
    PolicyRule,
    PublishGuardrailDefinitionInput,
    PublishPolicyPackInput,
    RegisterAgentBlueprintInput,
    RegisterConnectorDefinitionInput,
    RegisterTenantInput,
    RepositoryConnectorQuotaCoordinator,
    RequestHumanApprovalInput,
    ResolveApprovalRequestInput,
    RollbackDeploymentInput,
    RuntimeProfile,
    SecretAccessPolicy,
    StartRunSessionInput,
    StubVaultResolver,
    TransitionDeploymentInput,
    VaultReference,
    create_admin_api_handlers,
    create_cip_control_plane_agent,
    create_default_guardrail_catalog,
    create_in_memory_cip_repositories,
    dynamics365_connector_manifest,
    workday_connector_manifest,
    workday_connector_stub,
)


def create_workday_security_fixture() -> dict[str, object]:
    repositories = create_in_memory_cip_repositories()
    telemetry = InMemoryTelemetrySink()
    control_plane = CipControlPlane(repositories, telemetry)

    tenant = control_plane.register_tenant(
        RegisterTenantInput(
            slug="acme-workday-security",
            display_name="Acme Workday Security",
            product_tier="pantheon",
            platforms=["workday"],
            regions=["eu-west-2"],
        )
    )

    workday_connector = control_plane.register_connector_definition(
        RegisterConnectorDefinitionInput(
            key=workday_connector_manifest.key,
            version=workday_connector_manifest.version,
            platform=workday_connector_manifest.platform,
            display_name="Workday MCP Server",
            runtime="mcp",
            auth_strategy="service-account",
            source="first-party",
            capabilities=[tool.name for tool in workday_connector_manifest.tools],
        )
    )

    control_plane.register_connector_definition(
        RegisterConnectorDefinitionInput(
            key=dynamics365_connector_manifest.key,
            version=dynamics365_connector_manifest.version,
            platform=dynamics365_connector_manifest.platform,
            display_name="Dynamics 365 MCP Server",
            runtime="mcp",
            auth_strategy="oauth2",
            source="partner",
            capabilities=[tool.name for tool in dynamics365_connector_manifest.tools],
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
            connector_definition_id=workday_connector.id,
            credential_binding_id=credential_binding.id,
            environment="production",
            alias="workday-prod",
            endpoint="https://acme.workday.com/ccx/service/customreport2",
            config={"tenantAlias": "acme_prod"},
        )
    )

    default_guardrail = create_default_guardrail_catalog()[0]
    guardrail = control_plane.publish_guardrail_definition(
        PublishGuardrailDefinitionInput(
            key=default_guardrail.key,
            version=default_guardrail.version,
            name=default_guardrail.name,
            configuration=default_guardrail.configuration,
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
                    severity="high",
                    action="flag",
                    clauses=[
                        PolicyClause(
                            id="scope-delta",
                            name="scope-delta",
                            match="all",
                            conditions=[
                                PolicyCondition(
                                    path="permissions.delta",
                                    operator="gt",
                                    value=0,
                                )
                            ],
                        )
                    ],
                )
            ],
            guardrail_refs=[guardrail.id],
        )
    )

    blueprint_v1 = control_plane.register_agent_blueprint(
        RegisterAgentBlueprintInput(
            key="security-diagnostic-agent",
            version="1.0.0",
            name="Security Diagnostic Agent",
            product_tier="pantheon",
            domain="security",
            description="Natural-language troubleshooting for Workday security and access issues.",
            runtime=RuntimeProfile(
                provider="openai-agents-sdk",
                model_profile="reasoning",
                adapter_version="0.12.4",
            ),
            connector_definition_ids=[workday_connector.id],
            policy_pack_ids=[policy_pack.id],
            guardrail_definition_ids=[guardrail.id],
            handoff_targets=["tenant-drift-detection-agent"],
        )
    )

    deployment = control_plane.deploy_agent(
        DeployAgentInput(
            tenant_id=tenant.id,
            agent_blueprint_id=blueprint_v1.id,
            environment="production",
            connector_binding_ids=[connector_binding.id],
            tags=["workday", "security"],
        )
    )
    active_deployment = control_plane.transition_deployment(
        TransitionDeploymentInput(
            deployment_id=deployment.id,
            target_status="active",
        )
    )

    return {
        "repositories": repositories,
        "telemetry": telemetry,
        "control_plane": control_plane,
        "tenant": tenant,
        "credential_binding": credential_binding,
        "connector_binding": connector_binding,
        "workday_connector": workday_connector,
        "guardrail": guardrail,
        "policy_pack": policy_pack,
        "blueprint_v1": blueprint_v1,
        "deployment": active_deployment,
    }


class CipControlPlaneTests(unittest.TestCase):
    def test_phase1_lifecycle_persists_blueprint_versions_and_evidence(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]
        blueprint_v1 = fixture["blueprint_v1"]
        repositories = fixture["repositories"]
        telemetry = fixture["telemetry"]

        session = control_plane.start_run_session(
            StartRunSessionInput(
                tenant_id=tenant.id,
                deployment_id=deployment.id,
                input_summary="Why can't Maria run the Year-End Tax Report?",
            )
        )
        control_plane.append_run_event(
            AppendRunEventInput(
                session_id=session.id,
                type="tool_called",
                payload={"tool": "list_security_groups"},
            )
        )
        completed_session = control_plane.complete_run_session(
            CompleteRunSessionInput(
                session_id=session.id,
                status="completed",
                output_summary="Maria is missing the report domain security group.",
            )
        )

        replay = control_plane.replay_run_session(session.id)
        audit_events = repositories.audit_events.list()

        self.assertEqual(deployment.status, "active")
        self.assertEqual(completed_session.status, "completed")
        self.assertEqual(blueprint_v1.dependency_snapshot.policy_packs[0].version, "1.0.0")
        self.assertEqual([event.type for event in replay.run_events], ["run_started", "tool_called", "run_completed"])
        self.assertEqual(replay.reconstructed_status, "completed")
        self.assertEqual(replay.evidence_bundle.agent_blueprint_version, "1.0.0")
        self.assertEqual(
            [event.action for event in audit_events if event.session_id == session.id],
            ["session.started", "session.completed"],
        )
        self.assertTrue(any(event.name == "run_event.run_completed" for event in telemetry.events))

    def test_deployment_state_machine_and_rollback(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        workday_connector = fixture["workday_connector"]
        policy_pack = fixture["policy_pack"]
        guardrail = fixture["guardrail"]
        blueprint_v1 = fixture["blueprint_v1"]
        deployment = fixture["deployment"]

        blueprint_v2 = control_plane.register_agent_blueprint(
            RegisterAgentBlueprintInput(
                key="security-diagnostic-agent",
                version="1.1.0",
                name="Security Diagnostic Agent",
                product_tier="pantheon",
                domain="security",
                description="Updated release for rollback tests.",
                runtime=RuntimeProfile(
                    provider="openai-agents-sdk",
                    model_profile="reasoning",
                    adapter_version="0.12.4",
                ),
                connector_definition_ids=[workday_connector.id],
                policy_pack_ids=[policy_pack.id],
                guardrail_definition_ids=[guardrail.id],
                supersedes_blueprint_id=blueprint_v1.id,
            )
        )

        redeployed = control_plane.rollback_deployment_to_blueprint(
            RollbackDeploymentInput(
                deployment_id=deployment.id,
                target_blueprint_id=blueprint_v2.id,
            )
        )
        paused = control_plane.transition_deployment(
            TransitionDeploymentInput(deployment_id=redeployed.id, target_status="paused")
        )
        resumed = control_plane.transition_deployment(
            TransitionDeploymentInput(deployment_id=paused.id, target_status="active")
        )
        rolled_back = control_plane.rollback_deployment_to_blueprint(
            RollbackDeploymentInput(
                deployment_id=resumed.id,
                target_blueprint_id=blueprint_v1.id,
            )
        )

        self.assertEqual(redeployed.agent_blueprint_version, "1.1.0")
        self.assertEqual(rolled_back.agent_blueprint_version, "1.0.0")

        with self.assertRaisesRegex(
            CipControlPlaneError,
            "invalid deployment transition: active -> provisioning",
        ):
            control_plane.transition_deployment(
                TransitionDeploymentInput(
                    deployment_id=resumed.id,
                    target_status="provisioning",
                )
            )

    def test_human_approval_rejection_fails_session(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]
        guardrail = fixture["guardrail"]
        policy_pack = fixture["policy_pack"]

        session = control_plane.start_run_session(
            StartRunSessionInput(
                tenant_id=tenant.id,
                deployment_id=deployment.id,
                input_summary="Approve cross-tenant access evidence export.",
            )
        )

        approval_request = control_plane.request_human_approval(
            RequestHumanApprovalInput(
                session_id=session.id,
                checkpoint=HumanApprovalCheckpoint(
                    checkpoint_id="export-evidence",
                    reason="Evidence export crosses a compliance boundary.",
                    guardrail_definition_id=guardrail.id,
                    policy_pack_id=policy_pack.id,
                ),
            )
        )

        resolved = control_plane.resolve_approval_request(
            ResolveApprovalRequestInput(
                approval_request_id=approval_request.id,
                decision="rejected",
                resolution_comment="Operator rejected export until manual review completes.",
            )
        )

        replay = control_plane.replay_run_session(session.id)
        self.assertEqual(resolved.status, "rejected")
        self.assertEqual(replay.session.status, "failed")
        self.assertEqual(
            [event.type for event in replay.run_events],
            ["run_started", "approval_requested", "approval_resolved", "run_failed"],
        )
        self.assertEqual(replay.evidence_bundle.guardrail_versions[0].version, "1.0.0")

    def test_policy_admin_runtime_and_secrets(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        repositories = fixture["repositories"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]
        policy_pack = fixture["policy_pack"]
        guardrail = fixture["guardrail"]
        credential_binding = fixture["credential_binding"]

        evaluator = DeterministicPolicyEvaluator()
        handlers = create_admin_api_handlers(control_plane, repositories, evaluator)
        runtime = OpenAIAgentsRuntimeAdapter()

        os.environ["CIP_LOCAL_SECRET"] = "super-secret-value"
        env_resolver = EnvironmentSecretResolver()
        stub_resolver = StubVaultResolver({"aws:test/secret": "stubbed-secret"})

        evaluation = evaluator.evaluate(
            policy_pack,
            PolicyEvaluationContext(
                tenant_id=tenant.id,
                deployment_id=deployment.id,
                facts={"permissions": {"delta": 2}, "tenant": {"allowed": True}},
            ),
            [guardrail],
        )

        healthcheck = handlers.post_connector_healthcheck("workday")
        policy_result = handlers.evaluate_policy(
            policy_pack.id,
            PolicyEvaluationContext(
                tenant_id=tenant.id,
                facts={"permissions": {"delta": 2}, "tenant": {"allowed": True}},
            ),
        )

        run_result = runtime.run(
            CipRunRequest(
                agent=CipAgentSpec(
                    name="Phase 1 Runtime",
                    instructions="Operate safely.",
                    runtime_profile=RuntimeProfile(
                        provider="openai-agents-sdk",
                        model_profile="default",
                    ),
                    tools=[],
                ),
                input="Export evidence bundle",
                session=runtime.create_session_handle("session-1", {"responseId": "resp_123"}),
                approval_checkpoints=[
                    runtime.create_approval_checkpoint(
                        HumanApprovalCheckpoint(
                            checkpoint_id="manual-review",
                            reason="Human approval is required.",
                        )
                    )
                ],
            )
        )

        env_secret = env_resolver.resolve(
            reference=VaultReference(provider="env", ref="cip_local_secret"),
            access_policy=SecretAccessPolicy(allowed_providers=["env"], required_scopes=[]),
        )
        stub_secret = stub_resolver.resolve(reference=VaultReference(provider="aws", ref="test/secret"))

        self.assertEqual(evaluation.action, "flag")
        self.assertEqual(evaluation.triggered_guardrail_ids[0], guardrail.id)
        self.assertEqual(healthcheck.status, 200)
        self.assertEqual(policy_result.status, 200)
        self.assertEqual(run_result.status, "waiting-human")
        self.assertEqual(env_secret.value, "super-secret-value")
        self.assertEqual(stub_secret.value, "stubbed-secret")
        self.assertIn("secret", credential_binding.secret_ref)

    def test_connector_quota_and_agent_tools(self) -> None:
        repositories = create_in_memory_cip_repositories()
        quota_coordinator = RepositoryConnectorQuotaCoordinator(repositories.connector_rate_buckets)
        results = [
            workday_connector_stub.list_security_groups(
                ConnectorStubContext(
                    tenant_id="tenant-1",
                    external_system_tenant="workday-acme-prod",
                    environment="production",
                    quota_coordinator=quota_coordinator,
                )
            )
            for _ in range(11)
        ]

        self.assertEqual(len([result for result in results if result.quota.granted]), 10)
        self.assertEqual(len([result for result in results if not result.quota.granted]), 1)

        agent = create_cip_control_plane_agent(repositories)
        self.assertEqual(agent.name, "CIP Control Plane Assistant")
        self.assertEqual(len(agent.tools), 3)


if __name__ == "__main__":
    unittest.main()
