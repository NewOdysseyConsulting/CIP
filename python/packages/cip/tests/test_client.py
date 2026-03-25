from __future__ import annotations

import json
import unittest
from dataclasses import asdict

import httpx

from new_odyssey_cip import (
    AuditActor,
    CipAdminClient,
    CipAuthError,
    CipClient,
    CipEventBatch,
    CipRunTracker,
    CompleteRunSessionInput,
    CreateComplianceArtifactInput,
    CreateApiKeyRequest,
    HttpCipAdminTransport,
    HttpCipControlPlaneTransport,
    LocalCipControlPlaneTransport,
    RecordDisclosureInput,
    RecordHumanReviewInput,
    RegisterTenantInput,
    RevokeApiKeyRequest,
    RotateApiKeyRequest,
    StartRunSessionInput,
    UpsertComplianceProfileInput,
)

from test_control_plane import create_workday_security_fixture


class CipClientTransportTests(unittest.TestCase):
    def test_local_transport_tracks_session_lifecycle(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        repositories = fixture["repositories"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]

        client = CipClient(
            LocalCipControlPlaneTransport(control_plane, repositories)
        )

        session = client.create_session(
            StartRunSessionInput(
                tenant_id=tenant.id,
                deployment_id=deployment.id,
                input_summary="Diagnose a local transport issue.",
            )
        )

        receipt = client.enqueue_events(
            CipEventBatch(
                tenant_id=tenant.id,
                session_id=session.id,
                events=[
                    {
                        "kind": "run_event",
                        "type": "tool_called",
                        "actor": {"type": "agent", "id": "python-sdk"},
                        "payload": {"tool": "list_security_groups"},
                    }
                ],
            )
        )

        completed = client.complete_session(
            CompleteRunSessionInput(
                session_id=session.id,
                status="completed",
                output_summary="Transport parity verified.",
            )
        )
        replay = client.get_replay(session.id)

        self.assertEqual(receipt.accepted_count, 1)
        self.assertEqual(completed.status, "completed")
        self.assertEqual(
            [event.type for event in replay.run_events],
            ["run_started", "tool_called", "run_completed"],
        )
        self.assertEqual(replay.run_events[1].actor.id, "local-cip-transport")
        self.assertEqual(replay.run_events[1].actor_verification, "asserted")
        self.assertEqual(replay.run_events[1].asserted_actor.id, "python-sdk")

    def test_http_transport_maps_remote_contracts(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]

        profile = control_plane.upsert_compliance_profile(
            UpsertComplianceProfileInput(
                deployment_id=deployment.id,
                regime="eu-ai-act",
                serves_eu_users=True,
                intended_purpose="Customer support chatbot",
                risk_tier="limited",
                transparency={
                    "required": True,
                    "notice_text": "You are interacting with AI.",
                    "placement": "banner-and-first-message",
                    "requires_acknowledgement": False,
                },
                oversight={
                    "required": False,
                    "require_approval_before_completion": False,
                    "minimum_human_reviewers": 0,
                    "stop_mechanism_required": False,
                },
                logging={
                    "require_verified_actors": True,
                    "retention_days": 365,
                },
            )
        )
        session = control_plane.start_run_session(
            StartRunSessionInput(
                tenant_id=tenant.id,
                deployment_id=deployment.id,
                input_summary="Prepare mock remote replay.",
            )
        )
        disclosure = control_plane.record_disclosure(
            RecordDisclosureInput(
                session_id=session.id,
                disclosure_version="v1",
                surface="banner_and_first_message",
                presented_at="2026-03-18T10:00:00+00:00",
            )
        )
        review = control_plane.record_human_review(
            RecordHumanReviewInput(
                session_id=session.id,
                decision="approved",
                reviewed_at="2026-03-18T10:01:00+00:00",
                comment="Reviewed for transport mapping.",
                actor=AuditActor(type="human", id="operator-1"),
            )
        )
        completed = control_plane.complete_run_session(
            CompleteRunSessionInput(
                session_id=session.id,
                status="completed",
                output_summary="Remote replay verified.",
            )
        )
        replay = control_plane.replay_run_session(session.id)
        evidence = control_plane.get_evidence_bundle(session.id)
        ingest_job = {
            "id": "job-1",
            "tenant_id": tenant.id,
            "session_id": session.id,
            "job_type": "event_batch",
            "payload": {
                "tenant_id": tenant.id,
                "session_id": session.id,
                "events": [],
            },
            "status": "completed",
            "attempt_count": 1,
            "available_at": "2026-03-18T10:00:00+00:00",
            "created_at": "2026-03-18T10:00:00+00:00",
            "updated_at": "2026-03-18T10:00:00+00:00",
        }

        def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            if path == "/v1/sessions":
                return httpx.Response(
                    200,
                    json=_camelize(asdict(session)),
                )
            if path == f"/v1/deployments/{deployment.id}/compliance-profile":
                return httpx.Response(200, json=_camelize(asdict(profile)))
            if path == f"/v1/sessions/{session.id}/replay":
                return httpx.Response(
                    200,
                    json=_camelize(
                        {
                            "session": asdict(replay.session),
                            "run_events": [asdict(event) for event in replay.run_events],
                            "approval_requests": [
                                asdict(approval) for approval in replay.approval_requests
                            ],
                            "disclosure_records": [
                                asdict(record) for record in replay.disclosure_records
                            ],
                            "human_reviews": [
                                asdict(record) for record in replay.human_reviews
                            ],
                            "compliance_profile": None
                            if replay.compliance_profile is None
                            else asdict(replay.compliance_profile),
                            "compliance_artifact_ids": replay.compliance_artifact_ids,
                            "evidence_bundle": None
                            if replay.evidence_bundle is None
                            else asdict(replay.evidence_bundle),
                            "reconstructed_status": replay.reconstructed_status,
                        }
                    ),
                )
            if path == f"/v1/sessions/{session.id}:record-disclosure":
                return httpx.Response(200, json=_camelize(asdict(disclosure)))
            if path == f"/v1/sessions/{session.id}:record-human-review":
                return httpx.Response(200, json=_camelize(asdict(review)))
            if path == f"/v1/evidence-bundles/{session.id}":
                return httpx.Response(
                    200,
                    json=None if evidence is None else _camelize(asdict(evidence)),
                )
            if path == f"/v1/sessions/{session.id}:complete":
                return httpx.Response(
                    200,
                    json=_camelize(asdict(completed)),
                )
            if path == "/v1/ingest-jobs/job-1":
                return httpx.Response(200, json=_camelize(ingest_job))
            if path == "/v1/deployments":
                return httpx.Response(
                    200,
                    json=[_camelize(asdict(deployment))],
                )
            if path == f"/v1/tenants/{tenant.id}":
                return httpx.Response(200, json=_camelize(asdict(tenant)))
            if path == "/v1/audit-events":
                return httpx.Response(200, json=[])
            raise AssertionError(f"unexpected path {path}")

        transport = HttpCipControlPlaneTransport(
            "https://cip.test",
            api_key="sdk-token",
            operator_token="operator-token",
            client=httpx.Client(
                base_url="https://cip.test",
                transport=httpx.MockTransport(handler),
            ),
        )
        client = CipClient(transport)

        remote_session = client.create_session(
            StartRunSessionInput(
                tenant_id=tenant.id,
                deployment_id=deployment.id,
                input_summary="Remote session create.",
            )
        )
        remote_profile = client.get_compliance_profile(deployment.id)
        remote_disclosure = client.record_disclosure(
            RecordDisclosureInput(
                session_id=session.id,
                disclosure_version="v1",
                surface="banner_and_first_message",
                presented_at="2026-03-18T10:00:00+00:00",
            )
        )
        remote_review = client.record_human_review(
            RecordHumanReviewInput(
                session_id=session.id,
                decision="approved",
                reviewed_at="2026-03-18T10:01:00+00:00",
                comment="Reviewed for transport mapping.",
            )
        )
        remote_completed = client.complete_session(
            CompleteRunSessionInput(
                session_id=session.id,
                status="completed",
                output_summary="Remote replay verified.",
            )
        )
        remote_replay = client.get_replay(session.id)
        remote_evidence = client.get_evidence_bundle(session.id)
        remote_job = client.get_ingest_job("job-1")
        remote_tenant = client.get_tenant(tenant.id)
        remote_deployments = client.list_deployments()
        tracker = CipRunTracker(client, poll_interval_s=0.001, max_poll_attempts=1)
        waited_job = tracker.wait_for_ingest("job-1")

        self.assertEqual(remote_session.id, session.id)
        self.assertEqual(remote_profile.id, profile.id)
        self.assertEqual(remote_disclosure.id, disclosure.id)
        self.assertEqual(remote_review.id, review.id)
        self.assertEqual(remote_completed.status, "completed")
        self.assertEqual(remote_replay.reconstructed_status, "completed")
        self.assertEqual(remote_replay.compliance_profile.id, profile.id)
        self.assertEqual(remote_replay.disclosure_records[0].id, disclosure.id)
        self.assertEqual(remote_replay.human_reviews[0].id, review.id)
        self.assertEqual(remote_evidence.agent_blueprint_version, evidence.agent_blueprint_version)
        self.assertEqual(remote_evidence.compliance_profile.id, profile.id)
        self.assertEqual(remote_job.id, "job-1")
        self.assertEqual(remote_tenant.id, tenant.id)
        self.assertEqual(remote_deployments[0].id, deployment.id)
        self.assertEqual(waited_job.status, "completed")

    def test_http_admin_transport_maps_bootstrap_contracts(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]

        profile = control_plane.upsert_compliance_profile(
            UpsertComplianceProfileInput(
                deployment_id=deployment.id,
                regime="eu-ai-act",
                serves_eu_users=True,
                intended_purpose="Legal intake workflow",
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
        artifact = control_plane.create_compliance_artifact(
            CreateComplianceArtifactInput(
                deployment_id=deployment.id,
                kind="technical_documentation",
                status="approved",
                owner="legal",
                summary="Technical documentation approved.",
            )
        )

        api_key_record = {
            "id": "api-key-1",
            "tenant_id": tenant.id,
            "name": "bootstrap key",
            "key_hash": "hash",
            "scopes": ["sessions:write"],
            "status": "active",
            "created_at": "2026-03-18T10:00:00+00:00",
            "updated_at": "2026-03-18T10:00:00+00:00",
            "description": "bootstrap",
        }

        def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            if path == "/v1/admin/tenants" and request.method == "POST":
                return httpx.Response(200, json=_camelize(asdict(tenant)))
            if path == "/v1/admin/deployments":
                return httpx.Response(200, json=[_camelize(asdict(deployment))])
            if path == f"/v1/admin/deployments/{deployment.id}/compliance-profile":
                return httpx.Response(200, json=_camelize(asdict(profile)))
            if path == f"/v1/admin/deployments/{deployment.id}/compliance-artifacts":
                if request.method == "GET":
                    return httpx.Response(200, json=[_camelize(asdict(artifact))])
                return httpx.Response(200, json=_camelize(asdict(artifact)))
            if path == "/v1/admin/api-keys" and request.method == "POST":
                return httpx.Response(
                    200,
                    json=_camelize(
                        {
                            "record": api_key_record,
                            "plain_text_key": "cip_test_secret",
                        }
                    ),
                )
            if path == "/v1/admin/api-keys/api-key-1:rotate":
                return httpx.Response(
                    200,
                    json=_camelize(
                        {
                            "record": {**api_key_record, "name": "rotated key"},
                            "plain_text_key": "cip_rotated_secret",
                        }
                    ),
                )
            if path == "/v1/admin/api-keys/api-key-1:revoke":
                return httpx.Response(
                    200,
                    json=_camelize({**api_key_record, "status": "revoked"}),
                )
            raise AssertionError(f"unexpected path {path}")

        client = CipAdminClient(
            HttpCipAdminTransport(
                "https://cip.test",
                operator_token="operator-token",
                client=httpx.Client(
                    base_url="https://cip.test",
                    transport=httpx.MockTransport(handler),
                ),
            )
        )

        created_tenant = client.create_tenant(
            RegisterTenantInput(
                slug="bootstrap-tenant",
                display_name="Bootstrap Tenant",
                product_tier="pantheon",
                platforms=["workday"],
                regions=["eu-west-2"],
            )
        )
        deployments = client.list_deployments()
        profile_response = client.get_compliance_profile(deployment.id)
        updated_profile = client.upsert_compliance_profile(
            UpsertComplianceProfileInput(
                deployment_id=deployment.id,
                regime="eu-ai-act",
                serves_eu_users=True,
                intended_purpose="Legal intake workflow",
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
        artifacts = client.list_compliance_artifacts(deployment.id)
        created_artifact = client.create_compliance_artifact(
            CreateComplianceArtifactInput(
                deployment_id=deployment.id,
                kind="technical_documentation",
                status="approved",
                owner="legal",
                summary="Technical documentation approved.",
            )
        )
        issued = client.issue_api_key(
            CreateApiKeyRequest(
                tenant_id=tenant.id,
                name="bootstrap key",
                scopes=["sessions:write"],
            )
        )
        rotated = client.rotate_api_key(RotateApiKeyRequest(api_key_id="api-key-1", name="rotated key"))
        revoked = client.revoke_api_key(RevokeApiKeyRequest(api_key_id="api-key-1"))

        self.assertEqual(created_tenant.id, tenant.id)
        self.assertEqual(deployments[0].id, deployment.id)
        self.assertEqual(profile_response.id, profile.id)
        self.assertEqual(updated_profile.id, profile.id)
        self.assertEqual(artifacts[0].id, artifact.id)
        self.assertEqual(created_artifact.id, artifact.id)
        self.assertEqual(issued.record.id, "api-key-1")
        self.assertEqual(issued.plain_text_key, "cip_test_secret")
        self.assertEqual(rotated.record.name, "rotated key")
        self.assertEqual(revoked.status, "revoked")

    def test_http_transport_raises_typed_auth_errors(self) -> None:
        transport = HttpCipControlPlaneTransport(
            "https://cip.test",
            api_key="sdk-token",
            client=httpx.Client(
                base_url="https://cip.test",
                transport=httpx.MockTransport(lambda _request: httpx.Response(401, json={"error": "unauthorized"})),
            ),
        )

        with self.assertRaises(CipAuthError):
            transport.create_session(
                StartRunSessionInput(
                    tenant_id="tenant-1",
                    deployment_id="deployment-1",
                    input_summary="unauthorized",
                )
            )


def _camelize_name(value: str) -> str:
    parts = value.split("_")
    head, *tail = parts
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _camelize(value):
    if isinstance(value, dict):
        return {
            _camelize_name(key): _camelize(item)
            for key, item in value.items()
            if item is not None
        }
    if isinstance(value, list):
        return [_camelize(item) for item in value]
    return value


if __name__ == "__main__":
    unittest.main()
