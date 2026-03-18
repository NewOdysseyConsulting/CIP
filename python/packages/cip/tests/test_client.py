from __future__ import annotations

import json
import unittest
from dataclasses import asdict

import httpx

from new_odyssey_cip import (
    CipClient,
    CipEventBatch,
    CompleteRunSessionInput,
    HttpCipControlPlaneTransport,
    LocalCipControlPlaneTransport,
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
        remote_tenant = client.get_tenant(tenant.id)
        remote_deployments = client.list_deployments()

        self.assertEqual(remote_session.id, session.id)
        self.assertEqual(remote_completed.status, "completed")
        self.assertEqual(remote_replay.reconstructed_status, "completed")
        self.assertEqual(remote_evidence.agent_blueprint_version, evidence.agent_blueprint_version)
        self.assertEqual(remote_tenant.id, tenant.id)
        self.assertEqual(remote_deployments[0].id, deployment.id)


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
