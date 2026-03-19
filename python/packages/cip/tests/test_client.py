from __future__ import annotations

import json
import unittest
from dataclasses import asdict

import httpx

from new_odyssey_cip import (
    CipAdminClient,
    CipAuthError,
    CipClient,
    CipEventBatch,
    CipRunTracker,
    CompleteRunSessionInput,
    CreateApiKeyRequest,
    HttpCipAdminTransport,
    HttpCipControlPlaneTransport,
    LocalCipControlPlaneTransport,
    RegisterTenantInput,
    RevokeApiKeyRequest,
    RotateApiKeyRequest,
    StartRunSessionInput,
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

    def test_http_transport_maps_remote_contracts(self) -> None:
        fixture = create_workday_security_fixture()
        control_plane = fixture["control_plane"]
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]

        session = control_plane.start_run_session(
            StartRunSessionInput(
                tenant_id=tenant.id,
                deployment_id=deployment.id,
                input_summary="Prepare mock remote replay.",
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
                            "evidence_bundle": None
                            if replay.evidence_bundle is None
                            else asdict(replay.evidence_bundle),
                            "reconstructed_status": replay.reconstructed_status,
                        }
                    ),
                )
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
        self.assertEqual(remote_completed.status, "completed")
        self.assertEqual(remote_replay.reconstructed_status, "completed")
        self.assertEqual(remote_evidence.agent_blueprint_version, evidence.agent_blueprint_version)
        self.assertEqual(remote_job.id, "job-1")
        self.assertEqual(remote_tenant.id, tenant.id)
        self.assertEqual(remote_deployments[0].id, deployment.id)
        self.assertEqual(waited_job.status, "completed")

    def test_http_admin_transport_maps_bootstrap_contracts(self) -> None:
        fixture = create_workday_security_fixture()
        tenant = fixture["tenant"]
        deployment = fixture["deployment"]

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
