from __future__ import annotations

import os
import unittest

from new_odyssey_cip import (
    AppendRunEventInput,
    AuditActor,
    CipAgentSpec,
    CipControlPlane,
    CipControlPlaneError,
    CipRunRequest,
    CompleteRunSessionInput,
    CreateComplianceArtifactInput,
    ConnectorStubContext,
    CreateConnectorBindingInput,
    CreateCredentialBindingInput,
    DeployAgentInput,
    EnvironmentSecretResolver,
    HumanApprovalCheckpoint,
    InMemoryTelemetrySink,
    OpenAIAgentsRuntimeAdapter,
    PolicyClause,
    PolicyCondition,
    PolicyDecision,
    PolicyEvaluationContext,
    PolicyEvidenceReference,
    PolicyRule,
    PublishGuardrailDefinitionInput,
    PublishPolicyPackInput,
    RecordDisclosureInput,
    RecordHumanReviewInput,
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
    UpsertComplianceProfileInput,
    VaultReference,
    create_admin_api_handlers,
    create_cip_control_plane_agent,
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

    guardrail = control_plane.publish_guardrail_definition(
        PublishGuardrailDefinitionInput(
            key="tenant_boundary",
            version="1.0.0",
            name="Tenant Boundary",
            configuration={
                "clauses": [
                    PolicyClause(
                        id="tenant-boundary",
                        name="tenant-boundary",
                        match="all",
                        conditions=[
                            PolicyCondition(
                                path="tenant.allowed",
                                operator="eq",
                                value=True,
                            )
                        ],
                    )
                ]
            },
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

    def test_compliance_profiles_gate_activation_and_session_completion(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]

        paused = control_plane.transition_deployment(
            TransitionDeploymentInput(deployment_id=deployment.id, target_status="paused")
        )
        profile = control_plane.upsert_compliance_profile(
            UpsertComplianceProfileInput(
                deployment_id=paused.id,
                regime="eu-ai-act",
                serves_eu_users=True,
                intended_purpose="Legal intake triage",
                risk_tier="high-risk",
                transparency={
                    "required": True,
                    "notice_text": "You are interacting with AI.",
                    "placement": "banner-and-first-message",
                    "requires_acknowledgement": True,
                },
                oversight={
                    "required": True,
                    "require_approval_before_completion": True,
                    "minimum_human_reviewers": 1,
                    "stop_mechanism_required": True,
                },
                logging={
                    "require_verified_actors": True,
                    "retention_days": 3650,
                },
            )
        )

        with self.assertRaisesRegex(
            CipControlPlaneError,
            "missing required compliance artifact technical_documentation:approved",
        ):
            control_plane.transition_deployment(
                TransitionDeploymentInput(deployment_id=paused.id, target_status="active")
            )

        required_artifacts = [
            ("technical_documentation", "approved"),
            ("fundamental_rights_impact_assessment", "approved"),
            ("conformity_assessment", "approved"),
            ("eu_declaration_of_conformity", "filed"),
            ("eu_database_registration", "filed"),
            ("post_market_monitoring_plan", "approved"),
        ]
        for kind, status in required_artifacts:
            control_plane.create_compliance_artifact(
                CreateComplianceArtifactInput(
                    deployment_id=paused.id,
                    kind=kind,
                    status=status,
                    owner="compliance",
                    summary=f"{kind} is {status}.",
                )
            )

        activated = control_plane.transition_deployment(
            TransitionDeploymentInput(deployment_id=paused.id, target_status="active")
        )
        session = control_plane.start_run_session(
            StartRunSessionInput(
                tenant_id=tenant.id,
                deployment_id=activated.id,
                input_summary="Review a legal intake workflow.",
            )
        )

        with self.assertRaisesRegex(
            CipControlPlaneError,
            "requires disclosure before completion",
        ):
            control_plane.complete_run_session(
                CompleteRunSessionInput(
                    session_id=session.id,
                    status="completed",
                    output_summary="Should not complete yet.",
                )
            )

        disclosure = control_plane.record_disclosure(
            RecordDisclosureInput(
                session_id=session.id,
                disclosure_version="v1",
                surface="banner_and_first_message",
                presented_at="2026-03-18T11:00:00+00:00",
                acknowledged_at="2026-03-18T11:00:05+00:00",
            )
        )

        with self.assertRaisesRegex(
            CipControlPlaneError,
            "requires 1 approved human review\\(s\\) before completion",
        ):
            control_plane.complete_run_session(
                CompleteRunSessionInput(
                    session_id=session.id,
                    status="completed",
                    output_summary="Still awaiting review.",
                )
            )

        with self.assertRaisesRegex(
            CipControlPlaneError,
            "requires a verified human reviewer actor",
        ):
            control_plane.record_human_review(
                RecordHumanReviewInput(
                    session_id=session.id,
                    decision="approved",
                    reviewed_at="2026-03-18T11:01:00+00:00",
                    reviewer_id="spoofed-reviewer",
                )
            )

        review = control_plane.record_human_review(
            RecordHumanReviewInput(
                session_id=session.id,
                decision="approved",
                reviewed_at="2026-03-18T11:02:00+00:00",
                comment="Reviewed and approved.",
                actor=AuditActor(type="human", id="operator-1"),
            )
        )
        completed = control_plane.complete_run_session(
            CompleteRunSessionInput(
                session_id=session.id,
                status="completed",
                output_summary="Legal intake workflow approved.",
            )
        )

        replay = control_plane.replay_run_session(session.id)
        evidence = control_plane.get_evidence_bundle(session.id)

        self.assertEqual(profile.id, session.compliance_profile_snapshot.id)
        self.assertEqual(activated.status, "active")
        self.assertEqual(completed.status, "completed")
        self.assertEqual(
            [event.type for event in replay.run_events],
            [
                "run_started",
                "disclosure_presented",
                "disclosure_acknowledged",
                "human_review_completed",
                "run_completed",
            ],
        )
        self.assertEqual(replay.compliance_profile.id, profile.id)
        self.assertEqual(replay.disclosure_records[0].id, disclosure.id)
        self.assertEqual(replay.human_reviews[0].id, review.id)
        self.assertTrue(len(replay.compliance_artifact_ids) >= 6)
        self.assertEqual(evidence.compliance_profile.id, profile.id)
        self.assertIn(disclosure.id, evidence.disclosure_record_ids)
        self.assertIn(review.id, evidence.human_review_ids)
        self.assertTrue(all(artifact_id in evidence.compliance_artifact_ids for artifact_id in replay.compliance_artifact_ids))

    def test_policy_admin_runtime_and_secrets(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        repositories = fixture["repositories"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]
        policy_pack = fixture["policy_pack"]
        guardrail = fixture["guardrail"]
        credential_binding = fixture["credential_binding"]

        class StubPolicyEvaluator:
            def evaluate(self, policy_pack, context, guardrails=None):
                return PolicyDecision(
                    action="flag",
                    matched_rule_ids=["least-privilege"],
                    failed_clause_ids=[],
                    triggered_guardrail_ids=[guardrail.id],
                    explanation="Stub evaluator decision.",
                    evidence_refs=[
                        PolicyEvidenceReference(type="policy-pack", id=policy_pack.id)
                    ],
                )

        evaluator = StubPolicyEvaluator()
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
