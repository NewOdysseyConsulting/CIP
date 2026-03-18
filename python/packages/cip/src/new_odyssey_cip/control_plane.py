from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from .records import (
    AgentBlueprint,
    AuditActor,
    AuditEvent,
    BaseRecord,
    ConnectorBinding,
    ConnectorDefinition,
    CredentialBinding,
    DeploymentRecord,
    Environment,
    PolicyDomain,
    PolicyPack,
    PolicyRule,
    ProductTier,
    RunSession,
    RuntimeProfile,
    TenantRecord,
)
from .repositories import CipRepositories


class CipControlPlaneError(Exception):
    pass


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _build_record_metadata(record_id: str | None = None) -> BaseRecord:
    now = _utc_now()
    return BaseRecord(
        id=record_id or str(uuid4()),
        created_at=now,
        updated_at=now,
        revision=1,
    )


def _touch_record(record: BaseRecord) -> BaseRecord:
    return BaseRecord(
        id=record.id,
        created_at=record.created_at,
        updated_at=_utc_now(),
        revision=record.revision + 1,
    )


def _record_kwargs(record: BaseRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "revision": record.revision,
    }


@dataclass(slots=True)
class RegisterTenantInput:
    slug: str
    display_name: str
    product_tier: ProductTier
    platforms: list[str]
    regions: list[str]
    record_id: str | None = None
    status: str = "active"


@dataclass(slots=True)
class RegisterConnectorDefinitionInput:
    key: str
    platform: str
    display_name: str
    runtime: str
    auth_strategy: str
    source: str
    capabilities: list[str]
    record_id: str | None = None
    metadata: dict[str, Any] | None = None
    status: str = "active"


@dataclass(slots=True)
class CreateCredentialBindingInput:
    tenant_id: str
    name: str
    provider: str
    secret_ref: str
    scopes: list[str]
    record_id: str | None = None
    expires_at: str | None = None
    status: str = "active"


@dataclass(slots=True)
class CreateConnectorBindingInput:
    tenant_id: str
    connector_definition_id: str
    credential_binding_id: str
    environment: Environment
    alias: str
    endpoint: str
    record_id: str | None = None
    config: dict[str, Any] | None = None
    status: str = "active"


@dataclass(slots=True)
class PublishPolicyPackInput:
    key: str
    name: str
    domain: PolicyDomain
    version: str
    ownership: str
    rules: list[PolicyRule]
    record_id: str | None = None
    tenant_id: str | None = None
    guardrail_refs: list[str] | None = None
    status: str = "active"


@dataclass(slots=True)
class RegisterAgentBlueprintInput:
    key: str
    name: str
    product_tier: ProductTier
    domain: PolicyDomain
    description: str
    runtime: RuntimeProfile
    connector_definition_ids: list[str]
    policy_pack_ids: list[str]
    record_id: str | None = None
    handoff_targets: list[str] | None = None
    structured_output: str | None = None
    status: str = "active"


@dataclass(slots=True)
class DeployAgentInput:
    tenant_id: str
    agent_blueprint_id: str
    environment: Environment
    connector_binding_ids: list[str]
    record_id: str | None = None
    policy_pack_ids: list[str] | None = None
    tags: list[str] | None = None
    status: str = "active"


@dataclass(slots=True)
class StartRunSessionInput:
    tenant_id: str
    deployment_id: str
    input_summary: str
    record_id: str | None = None
    correlation_id: str | None = None


@dataclass(slots=True)
class CompleteRunSessionInput:
    session_id: str
    status: str
    output_summary: str | None = None


class CipControlPlane:
    def __init__(self, repositories: CipRepositories) -> None:
        self.repositories = repositories

    def register_tenant(self, input_data: RegisterTenantInput) -> TenantRecord:
        metadata = _build_record_metadata(input_data.record_id)
        tenant = TenantRecord(
            **_record_kwargs(metadata),
            slug=input_data.slug,
            display_name=input_data.display_name,
            product_tier=input_data.product_tier,
            platforms=input_data.platforms,
            regions=input_data.regions,
            status=input_data.status,
        )
        self.repositories.tenants.save(tenant)
        self._record_audit_event(
            tenant_id=tenant.id,
            category="tenant",
            action="tenant.registered",
            actor=AuditActor(type="system", id="cip-control-plane"),
            payload={"slug": tenant.slug, "product_tier": tenant.product_tier},
        )
        return tenant

    def register_connector_definition(
        self,
        input_data: RegisterConnectorDefinitionInput,
    ) -> ConnectorDefinition:
        metadata = _build_record_metadata(input_data.record_id)
        connector_definition = ConnectorDefinition(
            **_record_kwargs(metadata),
            key=input_data.key,
            platform=input_data.platform,
            display_name=input_data.display_name,
            runtime=input_data.runtime,
            auth_strategy=input_data.auth_strategy,
            source=input_data.source,
            capabilities=input_data.capabilities,
            status=input_data.status,
            metadata=input_data.metadata,
        )
        return self.repositories.connector_definitions.save(connector_definition)

    def create_credential_binding(
        self,
        input_data: CreateCredentialBindingInput,
    ) -> CredentialBinding:
        self._ensure_tenant_exists(input_data.tenant_id)
        metadata = _build_record_metadata(input_data.record_id)
        credential_binding = CredentialBinding(
            **_record_kwargs(metadata),
            tenant_id=input_data.tenant_id,
            name=input_data.name,
            provider=input_data.provider,
            secret_ref=input_data.secret_ref,
            scopes=input_data.scopes,
            status=input_data.status,
            expires_at=input_data.expires_at,
        )
        self.repositories.credential_bindings.save(credential_binding)
        self._record_audit_event(
            tenant_id=input_data.tenant_id,
            category="security",
            action="credential.bound",
            actor=AuditActor(type="system", id="cip-control-plane"),
            payload={
                "provider": input_data.provider,
                "credential_binding_id": credential_binding.id,
            },
        )
        return credential_binding

    def create_connector_binding(
        self,
        input_data: CreateConnectorBindingInput,
    ) -> ConnectorBinding:
        self._ensure_tenant_exists(input_data.tenant_id)
        connector_definition = self._ensure_connector_definition_exists(
            input_data.connector_definition_id
        )
        credential_binding = self._ensure_credential_binding_exists(
            input_data.credential_binding_id
        )
        if credential_binding.tenant_id != input_data.tenant_id:
            raise CipControlPlaneError(
                "connector bindings must use credentials from the same tenant"
            )

        metadata = _build_record_metadata(input_data.record_id)
        connector_binding = ConnectorBinding(
            **_record_kwargs(metadata),
            tenant_id=input_data.tenant_id,
            connector_definition_id=input_data.connector_definition_id,
            credential_binding_id=input_data.credential_binding_id,
            environment=input_data.environment,
            alias=input_data.alias,
            endpoint=input_data.endpoint,
            config=input_data.config or {},
            status=input_data.status,
        )
        self.repositories.connector_bindings.save(connector_binding)
        self._record_audit_event(
            tenant_id=input_data.tenant_id,
            category="connector",
            action="connector.bound",
            actor=AuditActor(type="system", id="cip-control-plane"),
            payload={
                "connector_binding_id": connector_binding.id,
                "connector_definition_key": connector_definition.key,
                "environment": input_data.environment,
            },
        )
        return connector_binding

    def publish_policy_pack(self, input_data: PublishPolicyPackInput) -> PolicyPack:
        if input_data.ownership == "tenant" and input_data.tenant_id is None:
            raise CipControlPlaneError("tenant-owned policy packs require a tenant_id")
        if input_data.tenant_id is not None:
            self._ensure_tenant_exists(input_data.tenant_id)

        metadata = _build_record_metadata(input_data.record_id)
        policy_pack = PolicyPack(
            **_record_kwargs(metadata),
            key=input_data.key,
            name=input_data.name,
            domain=input_data.domain,
            version=input_data.version,
            ownership=input_data.ownership,
            tenant_id=input_data.tenant_id,
            rules=input_data.rules,
            guardrail_refs=input_data.guardrail_refs or [],
            status=input_data.status,
        )
        self.repositories.policy_packs.save(policy_pack)
        return policy_pack

    def register_agent_blueprint(
        self,
        input_data: RegisterAgentBlueprintInput,
    ) -> AgentBlueprint:
        for connector_definition_id in input_data.connector_definition_ids:
            self._ensure_connector_definition_exists(connector_definition_id)
        for policy_pack_id in input_data.policy_pack_ids:
            self._ensure_policy_pack_exists(policy_pack_id)

        metadata = _build_record_metadata(input_data.record_id)
        blueprint = AgentBlueprint(
            **_record_kwargs(metadata),
            key=input_data.key,
            name=input_data.name,
            product_tier=input_data.product_tier,
            domain=input_data.domain,
            description=input_data.description,
            runtime=input_data.runtime,
            connector_definition_ids=input_data.connector_definition_ids,
            policy_pack_ids=input_data.policy_pack_ids,
            handoff_targets=input_data.handoff_targets or [],
            structured_output=input_data.structured_output,
            status=input_data.status,
        )
        return self.repositories.agent_blueprints.save(blueprint)

    def deploy_agent(self, input_data: DeployAgentInput) -> DeploymentRecord:
        self._ensure_tenant_exists(input_data.tenant_id)
        blueprint = self._ensure_agent_blueprint_exists(input_data.agent_blueprint_id)
        connector_bindings = [
            self._ensure_connector_binding_exists(binding_id)
            for binding_id in input_data.connector_binding_ids
        ]

        for connector_binding in connector_bindings:
            if connector_binding.tenant_id != input_data.tenant_id:
                raise CipControlPlaneError(
                    "deployments may only use connector bindings from the same tenant"
                )

        supplied_connector_definition_ids = {
            binding.connector_definition_id for binding in connector_bindings
        }
        missing_connector_definitions = [
            connector_definition_id
            for connector_definition_id in blueprint.connector_definition_ids
            if connector_definition_id not in supplied_connector_definition_ids
        ]
        if missing_connector_definitions:
            raise CipControlPlaneError(
                f"missing required connector bindings for blueprint {blueprint.key}"
            )

        policy_pack_ids = input_data.policy_pack_ids or blueprint.policy_pack_ids
        policy_packs = [self._ensure_policy_pack_exists(policy_pack_id) for policy_pack_id in policy_pack_ids]
        for policy_pack in policy_packs:
            if policy_pack.ownership == "tenant" and policy_pack.tenant_id != input_data.tenant_id:
                raise CipControlPlaneError(
                    "tenant-owned policy packs must belong to the deployment tenant"
                )

        metadata = _build_record_metadata(input_data.record_id)
        deployment = DeploymentRecord(
            **_record_kwargs(metadata),
            tenant_id=input_data.tenant_id,
            agent_blueprint_id=input_data.agent_blueprint_id,
            environment=input_data.environment,
            connector_binding_ids=input_data.connector_binding_ids,
            policy_pack_ids=policy_pack_ids,
            status=input_data.status,
            deployed_at=_utc_now(),
            tags=input_data.tags or [],
        )
        self.repositories.deployments.save(deployment)
        self._record_audit_event(
            tenant_id=input_data.tenant_id,
            deployment_id=deployment.id,
            category="deployment",
            action="deployment.created",
            actor=AuditActor(type="system", id="cip-control-plane"),
            payload={
                "agent_blueprint_id": deployment.agent_blueprint_id,
                "environment": deployment.environment,
            },
        )
        return deployment

    def start_run_session(self, input_data: StartRunSessionInput) -> RunSession:
        self._ensure_tenant_exists(input_data.tenant_id)
        deployment = self._ensure_deployment_exists(input_data.deployment_id)
        if deployment.tenant_id != input_data.tenant_id:
            raise CipControlPlaneError(
                "run sessions must reference a deployment from the same tenant"
            )
        if deployment.status != "active":
            raise CipControlPlaneError(
                "run sessions can only be started against active deployments"
            )

        metadata = _build_record_metadata(input_data.record_id)
        session = RunSession(
            **_record_kwargs(metadata),
            tenant_id=input_data.tenant_id,
            deployment_id=input_data.deployment_id,
            correlation_id=input_data.correlation_id or str(uuid4()),
            status="running",
            started_at=_utc_now(),
            input_summary=input_data.input_summary,
        )
        self.repositories.run_sessions.save(session)
        self._record_audit_event(
            tenant_id=input_data.tenant_id,
            deployment_id=deployment.id,
            session_id=session.id,
            category="session",
            action="session.started",
            actor=AuditActor(type="agent", id="cip-runtime"),
            payload={
                "deployment_id": deployment.id,
                "correlation_id": session.correlation_id,
            },
        )
        return session

    def complete_run_session(self, input_data: CompleteRunSessionInput) -> RunSession:
        session = self._ensure_run_session_exists(input_data.session_id)
        metadata = _touch_record(session)
        updated_session = RunSession(
            **_record_kwargs(metadata),
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            correlation_id=session.correlation_id,
            status=input_data.status,
            started_at=session.started_at,
            input_summary=session.input_summary,
            completed_at=_utc_now(),
            output_summary=input_data.output_summary,
        )
        self.repositories.run_sessions.save(updated_session)
        self._record_audit_event(
            tenant_id=updated_session.tenant_id,
            deployment_id=updated_session.deployment_id,
            session_id=updated_session.id,
            category="session",
            action="session.completed",
            actor=AuditActor(type="agent", id="cip-runtime"),
            payload={"status": updated_session.status},
        )
        return updated_session

    def _record_audit_event(
        self,
        *,
        tenant_id: str,
        category: str,
        action: str,
        actor: AuditActor,
        payload: dict[str, Any],
        deployment_id: str | None = None,
        session_id: str | None = None,
        severity: str = "info",
    ) -> AuditEvent:
        event = AuditEvent(
            id=str(uuid4()),
            tenant_id=tenant_id,
            deployment_id=deployment_id,
            session_id=session_id,
            category=category,
            action=action,
            severity=severity,
            occurred_at=_utc_now(),
            actor=actor,
            payload=payload,
        )
        return self.repositories.audit_events.append(event)

    def _ensure_tenant_exists(self, tenant_id: str) -> TenantRecord:
        tenant = self.repositories.tenants.get_by_id(tenant_id)
        if tenant is None:
            raise CipControlPlaneError(f"unknown tenant: {tenant_id}")
        return tenant

    def _ensure_connector_definition_exists(self, connector_definition_id: str) -> ConnectorDefinition:
        connector_definition = self.repositories.connector_definitions.get_by_id(connector_definition_id)
        if connector_definition is None:
            raise CipControlPlaneError(f"unknown connector definition: {connector_definition_id}")
        return connector_definition

    def _ensure_credential_binding_exists(self, credential_binding_id: str) -> CredentialBinding:
        credential_binding = self.repositories.credential_bindings.get_by_id(credential_binding_id)
        if credential_binding is None:
            raise CipControlPlaneError(f"unknown credential binding: {credential_binding_id}")
        return credential_binding

    def _ensure_connector_binding_exists(self, connector_binding_id: str) -> ConnectorBinding:
        connector_binding = self.repositories.connector_bindings.get_by_id(connector_binding_id)
        if connector_binding is None:
            raise CipControlPlaneError(f"unknown connector binding: {connector_binding_id}")
        return connector_binding

    def _ensure_policy_pack_exists(self, policy_pack_id: str) -> PolicyPack:
        policy_pack = self.repositories.policy_packs.get_by_id(policy_pack_id)
        if policy_pack is None:
            raise CipControlPlaneError(f"unknown policy pack: {policy_pack_id}")
        return policy_pack

    def _ensure_agent_blueprint_exists(self, agent_blueprint_id: str) -> AgentBlueprint:
        agent_blueprint = self.repositories.agent_blueprints.get_by_id(agent_blueprint_id)
        if agent_blueprint is None:
            raise CipControlPlaneError(f"unknown agent blueprint: {agent_blueprint_id}")
        return agent_blueprint

    def _ensure_deployment_exists(self, deployment_id: str) -> DeploymentRecord:
        deployment = self.repositories.deployments.get_by_id(deployment_id)
        if deployment is None:
            raise CipControlPlaneError(f"unknown deployment: {deployment_id}")
        return deployment

    def _ensure_run_session_exists(self, session_id: str) -> RunSession:
        session = self.repositories.run_sessions.get_by_id(session_id)
        if session is None:
            raise CipControlPlaneError(f"unknown run session: {session_id}")
        return session
