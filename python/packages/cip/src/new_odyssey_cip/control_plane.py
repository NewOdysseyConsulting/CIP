from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from .observability import MetricEvent, TelemetrySink
from .records import (
    AgentBlueprint,
    ApprovalRequest,
    AuditActor,
    AuditEvent,
    BaseRecord,
    BlueprintDependencySnapshot,
    ComplianceArtifact,
    ComplianceLogging,
    ComplianceOversight,
    ComplianceProfile,
    ComplianceTransparency,
    ConnectorBinding,
    ConnectorDefinition,
    CredentialBinding,
    DependencyVersionReference,
    DeploymentRecord,
    DeploymentStatus,
    DisclosureRecord,
    Environment,
    EvidenceBundle,
    GuardrailDefinition,
    HighRiskBasis,
    HumanReviewRecord,
    PolicyDomain,
    PolicyPack,
    PolicyRule,
    ProductTier,
    RunEvent,
    RunSession,
    RunSessionStatus,
    RuntimeProfile,
    TenantRecord,
    TraceCorrelation,
)
from .repositories import CipRepositories
from .runtime import HumanApprovalCheckpoint, HumanApprovalDecision


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


def _system_actor(actor_id: str = "cip-control-plane") -> AuditActor:
    return AuditActor(type="system", id=actor_id)


def _default_compliance_transparency() -> ComplianceTransparency:
    return ComplianceTransparency(
        required=False,
        notice_text="",
        placement="banner-and-first-message",
        requires_acknowledgement=False,
    )


def _default_compliance_oversight() -> ComplianceOversight:
    return ComplianceOversight(
        required=False,
        require_approval_before_completion=False,
        minimum_human_reviewers=0,
        stop_mechanism_required=False,
    )


def _default_compliance_logging() -> ComplianceLogging:
    return ComplianceLogging(require_verified_actors=False, retention_days=30)


def _parse_semver(value: str) -> tuple[int, int, int]:
    parts = value.split(".")
    major = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 1
    minor = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    patch = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
    return major, minor, patch


def _increment_patch_version(value: str | None) -> str:
    if value is None:
        return "1.0.0"
    major, minor, patch = _parse_semver(value)
    return f"{major}.{minor}.{patch + 1}"


ALLOWED_DEPLOYMENT_TRANSITIONS: dict[DeploymentStatus, tuple[DeploymentStatus, ...]] = {
    "provisioning": ("active", "failed", "retired"),
    "active": ("paused", "draining", "failed", "retired"),
    "paused": ("active", "failed", "retired"),
    "draining": ("paused", "failed", "retired"),
    "failed": ("provisioning", "retired"),
    "retired": (),
}


class _NoopTelemetrySink(TelemetrySink):
    def record(self, event: MetricEvent) -> None:
        del event


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
    version: str | None = None
    driver_key: str | None = None
    driver_config: dict[str, Any] | None = None
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
    secret_backend_key: str | None = None
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
class PublishGuardrailDefinitionInput:
    key: str
    name: str
    configuration: dict[str, Any]
    record_id: str | None = None
    version: str | None = None
    description: str | None = None
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
    version: str | None = None
    guardrail_definition_ids: list[str] | None = None
    release_state: str = "released"
    supersedes_blueprint_id: str | None = None
    handoff_targets: list[str] | None = None
    structured_output: str | None = None
    status: str | None = None


@dataclass(slots=True)
class DeployAgentInput:
    tenant_id: str
    agent_blueprint_id: str
    environment: Environment
    connector_binding_ids: list[str]
    record_id: str | None = None
    policy_pack_ids: list[str] | None = None
    tags: list[str] | None = None
    status: str = "provisioning"


@dataclass(slots=True)
class TransitionDeploymentInput:
    deployment_id: str
    target_status: DeploymentStatus
    actor: AuditActor | None = None
    reason: str | None = None


@dataclass(slots=True)
class RollbackDeploymentInput:
    deployment_id: str
    target_blueprint_id: str
    actor: AuditActor | None = None
    reason: str | None = None


@dataclass(slots=True)
class StartRunSessionInput:
    tenant_id: str
    deployment_id: str
    input_summary: str
    record_id: str | None = None
    correlation_id: str | None = None
    trace_correlation: TraceCorrelation | None = None


@dataclass(slots=True)
class CompleteRunSessionInput:
    session_id: str
    status: str
    output_summary: str | None = None


@dataclass(slots=True)
class AppendRunEventInput:
    session_id: str
    type: str
    actor: AuditActor | None = None
    asserted_actor: AuditActor | None = None
    actor_verification: str | None = None
    payload: dict[str, Any] | None = None
    trace_correlation: TraceCorrelation | None = None
    occurred_at: str | None = None


@dataclass(slots=True)
class AppendAuditEventInput:
    tenant_id: str
    category: str
    action: str
    actor: AuditActor
    payload: dict[str, Any]
    asserted_actor: AuditActor | None = None
    actor_verification: str | None = None
    deployment_id: str | None = None
    session_id: str | None = None
    severity: str = "info"
    occurred_at: str | None = None


@dataclass(slots=True)
class UpsertComplianceProfileInput:
    deployment_id: str
    regime: str
    serves_eu_users: bool
    intended_purpose: str
    risk_tier: str
    record_id: str | None = None
    high_risk_basis: Any | None = None
    transparency: dict[str, Any] | None = None
    oversight: dict[str, Any] | None = None
    logging: dict[str, Any] | None = None


@dataclass(slots=True)
class CreateComplianceArtifactInput:
    deployment_id: str
    kind: str
    status: str
    owner: str
    summary: str
    record_id: str | None = None
    external_ref: str | None = None
    due_at: str | None = None
    completed_at: str | None = None


@dataclass(slots=True)
class RecordDisclosureInput:
    session_id: str
    disclosure_version: str
    surface: str
    presented_at: str
    record_id: str | None = None
    acknowledged_at: str | None = None


@dataclass(slots=True)
class RecordHumanReviewInput:
    session_id: str
    decision: str
    reviewed_at: str
    record_id: str | None = None
    reviewer_id: str | None = None
    comment: str | None = None
    actor: AuditActor | None = None


@dataclass(slots=True)
class RequestHumanApprovalInput:
    session_id: str
    checkpoint: HumanApprovalCheckpoint
    actor: AuditActor | None = None


@dataclass(slots=True)
class ResolveApprovalRequestInput:
    approval_request_id: str
    decision: str
    resolution_comment: str | None = None
    actor: AuditActor | None = None


@dataclass(slots=True)
class ReplayedRunSession:
    session: RunSession
    run_events: list[RunEvent]
    approval_requests: list[ApprovalRequest]
    disclosure_records: list[DisclosureRecord]
    human_reviews: list[HumanReviewRecord]
    compliance_profile: ComplianceProfile | None
    compliance_artifact_ids: list[str]
    evidence_bundle: EvidenceBundle | None
    reconstructed_status: RunSessionStatus


class CipControlPlane:
    def __init__(
        self,
        repositories: CipRepositories,
        telemetry_sink: TelemetrySink | None = None,
    ) -> None:
        self.repositories = repositories
        self._telemetry_sink = telemetry_sink or _NoopTelemetrySink()

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
            actor=_system_actor(),
            actor_verification="system",
            payload={"slug": tenant.slug, "product_tier": tenant.product_tier},
        )
        return tenant

    def register_connector_definition(
        self,
        input_data: RegisterConnectorDefinitionInput,
    ) -> ConnectorDefinition:
        existing = self.repositories.connector_definitions.list()
        existing_versions = [record.version for record in existing if record.key == input_data.key]
        metadata = _build_record_metadata(input_data.record_id)
        connector_definition = ConnectorDefinition(
            **_record_kwargs(metadata),
            key=input_data.key,
            version=input_data.version or _increment_patch_version(max(existing_versions) if existing_versions else None),
            platform=input_data.platform,
            display_name=input_data.display_name,
            driver_key=input_data.driver_key,
            driver_config=input_data.driver_config,
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
            secret_backend_key=input_data.secret_backend_key,
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
            actor=_system_actor(),
            actor_verification="system",
            payload={"provider": input_data.provider, "credential_binding_id": credential_binding.id},
        )
        return credential_binding

    def create_connector_binding(
        self,
        input_data: CreateConnectorBindingInput,
    ) -> ConnectorBinding:
        self._ensure_tenant_exists(input_data.tenant_id)
        connector_definition = self._ensure_connector_definition_exists(input_data.connector_definition_id)
        credential_binding = self._ensure_credential_binding_exists(input_data.credential_binding_id)
        if credential_binding.tenant_id != input_data.tenant_id:
            raise CipControlPlaneError("connector bindings must use credentials from the same tenant")

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
            actor=_system_actor(),
            actor_verification="system",
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
        self._record_audit_event(
            tenant_id=input_data.tenant_id or "shared",
            category="policy",
            action="policy_pack.published",
            actor=_system_actor(),
            actor_verification="system",
            payload={"policy_pack_id": policy_pack.id, "key": policy_pack.key, "version": policy_pack.version},
        )
        return policy_pack

    def publish_guardrail_definition(
        self,
        input_data: PublishGuardrailDefinitionInput,
    ) -> GuardrailDefinition:
        existing = self.repositories.guardrail_definitions.list()
        existing_versions = [record.version for record in existing if record.key == input_data.key]
        metadata = _build_record_metadata(input_data.record_id)
        guardrail_definition = GuardrailDefinition(
            **_record_kwargs(metadata),
            key=input_data.key,
            version=input_data.version or _increment_patch_version(max(existing_versions) if existing_versions else None),
            name=input_data.name,
            description=input_data.description,
            configuration=input_data.configuration,
            status=input_data.status,
        )
        self.repositories.guardrail_definitions.save(guardrail_definition)
        self._record_audit_event(
            tenant_id="shared",
            category="policy",
            action="guardrail_definition.published",
            actor=_system_actor(),
            actor_verification="system",
            payload={"guardrail_definition_id": guardrail_definition.id, "key": guardrail_definition.key, "version": guardrail_definition.version},
        )
        return guardrail_definition

    def register_agent_blueprint(
        self,
        input_data: RegisterAgentBlueprintInput,
    ) -> AgentBlueprint:
        connector_definitions = [
            self._ensure_connector_definition_exists(connector_definition_id)
            for connector_definition_id in input_data.connector_definition_ids
        ]
        policy_packs = [self._ensure_policy_pack_exists(policy_pack_id) for policy_pack_id in input_data.policy_pack_ids]
        guardrail_definition_ids = input_data.guardrail_definition_ids or []
        guardrail_definitions = [
            self._ensure_guardrail_definition_exists(guardrail_definition_id)
            for guardrail_definition_id in guardrail_definition_ids
        ]
        if input_data.supersedes_blueprint_id is not None:
            self._ensure_agent_blueprint_exists(input_data.supersedes_blueprint_id)

        existing = self.repositories.agent_blueprints.list()
        key_versions = [record.version for record in existing if record.key == input_data.key]
        version = input_data.version or _increment_patch_version(max(key_versions) if key_versions else None)
        if any(record.key == input_data.key and record.version == version for record in existing):
            raise CipControlPlaneError(f"agent blueprint {input_data.key}@{version} already exists")

        metadata = _build_record_metadata(input_data.record_id)
        dependency_snapshot = BlueprintDependencySnapshot(
            policy_packs=[DependencyVersionReference(id=record.id, key=record.key, version=record.version) for record in policy_packs],
            guardrails=[DependencyVersionReference(id=record.id, key=record.key, version=record.version) for record in guardrail_definitions],
            connector_manifests=[DependencyVersionReference(id=record.id, key=record.key, version=record.version) for record in connector_definitions],
            runtime_adapter_version=input_data.runtime.adapter_version or "unspecified",
        )
        blueprint = AgentBlueprint(
            **_record_kwargs(metadata),
            key=input_data.key,
            version=version,
            release_state=input_data.release_state,
            dependency_snapshot=dependency_snapshot,
            name=input_data.name,
            product_tier=input_data.product_tier,
            domain=input_data.domain,
            description=input_data.description,
            runtime=input_data.runtime,
            connector_definition_ids=input_data.connector_definition_ids,
            policy_pack_ids=input_data.policy_pack_ids,
            guardrail_definition_ids=guardrail_definition_ids,
            handoff_targets=input_data.handoff_targets or [],
            structured_output=input_data.structured_output,
            supersedes_blueprint_id=input_data.supersedes_blueprint_id,
            status=input_data.status or ("active" if input_data.release_state == "released" else "draft"),
        )
        self.repositories.agent_blueprints.save(blueprint)
        self._record_audit_event(
            tenant_id="shared",
            category="deployment",
            action="agent_blueprint.released",
            actor=_system_actor(),
            actor_verification="system",
            payload={"agent_blueprint_id": blueprint.id, "key": blueprint.key, "version": blueprint.version, "release_state": blueprint.release_state},
        )
        return blueprint

    def deploy_agent(self, input_data: DeployAgentInput) -> DeploymentRecord:
        self._ensure_tenant_exists(input_data.tenant_id)
        blueprint = self._ensure_agent_blueprint_exists(input_data.agent_blueprint_id)
        connector_bindings = [self._ensure_connector_binding_exists(binding_id) for binding_id in input_data.connector_binding_ids]
        for connector_binding in connector_bindings:
            if connector_binding.tenant_id != input_data.tenant_id:
                raise CipControlPlaneError("deployments may only use connector bindings from the same tenant")
        supplied_connector_definition_ids = {binding.connector_definition_id for binding in connector_bindings}
        missing_connector_definitions = [
            connector_definition_id
            for connector_definition_id in blueprint.connector_definition_ids
            if connector_definition_id not in supplied_connector_definition_ids
        ]
        if missing_connector_definitions:
            raise CipControlPlaneError(f"missing required connector bindings for blueprint {blueprint.key}")

        policy_pack_ids = input_data.policy_pack_ids or blueprint.policy_pack_ids
        policy_packs = [self._ensure_policy_pack_exists(policy_pack_id) for policy_pack_id in policy_pack_ids]
        for policy_pack in policy_packs:
            if policy_pack.ownership == "tenant" and policy_pack.tenant_id != input_data.tenant_id:
                raise CipControlPlaneError("tenant-owned policy packs must belong to the deployment tenant")

        metadata = _build_record_metadata(input_data.record_id)
        deployment = DeploymentRecord(
            **_record_kwargs(metadata),
            tenant_id=input_data.tenant_id,
            agent_blueprint_id=input_data.agent_blueprint_id,
            agent_blueprint_version=blueprint.version,
            environment=input_data.environment,
            connector_binding_ids=input_data.connector_binding_ids,
            policy_pack_ids=policy_pack_ids,
            status=input_data.status,
            tags=input_data.tags or [],
            deployed_at=_utc_now(),
            last_transition_at=_utc_now(),
        )
        self.repositories.deployments.save(deployment)
        self._record_audit_event(
            tenant_id=input_data.tenant_id,
            deployment_id=deployment.id,
            category="deployment",
            action="deployment.created",
            actor=_system_actor(),
            actor_verification="system",
            payload={"agent_blueprint_id": deployment.agent_blueprint_id, "agent_blueprint_version": deployment.agent_blueprint_version, "environment": deployment.environment, "status": deployment.status},
        )
        return deployment

    def transition_deployment(self, input_data: TransitionDeploymentInput) -> DeploymentRecord:
        deployment = self._ensure_deployment_exists(input_data.deployment_id)
        allowed = ALLOWED_DEPLOYMENT_TRANSITIONS[deployment.status]
        if input_data.target_status not in allowed:
            raise CipControlPlaneError(f"invalid deployment transition: {deployment.status} -> {input_data.target_status}")
        if input_data.target_status == "active":
            self._ensure_deployment_compliance_ready(deployment.id)
        metadata = _touch_record(deployment)
        updated = DeploymentRecord(
            **_record_kwargs(metadata),
            tenant_id=deployment.tenant_id,
            agent_blueprint_id=deployment.agent_blueprint_id,
            agent_blueprint_version=deployment.agent_blueprint_version,
            environment=deployment.environment,
            connector_binding_ids=deployment.connector_binding_ids,
            policy_pack_ids=deployment.policy_pack_ids,
            status=input_data.target_status,
            tags=deployment.tags,
            deployed_at=deployment.deployed_at,
            last_transition_at=_utc_now(),
        )
        self.repositories.deployments.save(updated)
        self._record_audit_event(
            tenant_id=updated.tenant_id,
            deployment_id=updated.id,
            category="deployment",
            action="deployment.transitioned",
            actor=input_data.actor or _system_actor(),
            actor_verification="system",
            payload={"from": deployment.status, "to": input_data.target_status, "reason": input_data.reason},
        )
        return updated

    def rollback_deployment_to_blueprint(self, input_data: RollbackDeploymentInput) -> DeploymentRecord:
        deployment = self._ensure_deployment_exists(input_data.deployment_id)
        blueprint = self._ensure_agent_blueprint_exists(input_data.target_blueprint_id)
        metadata = _touch_record(deployment)
        updated = DeploymentRecord(
            **_record_kwargs(metadata),
            tenant_id=deployment.tenant_id,
            agent_blueprint_id=blueprint.id,
            agent_blueprint_version=blueprint.version,
            environment=deployment.environment,
            connector_binding_ids=deployment.connector_binding_ids,
            policy_pack_ids=deployment.policy_pack_ids,
            status=deployment.status,
            tags=deployment.tags,
            deployed_at=deployment.deployed_at,
            last_transition_at=_utc_now(),
        )
        self.repositories.deployments.save(updated)
        self._record_audit_event(
            tenant_id=updated.tenant_id,
            deployment_id=updated.id,
            category="deployment",
            action="deployment.blueprint.rollback",
            actor=input_data.actor or _system_actor(),
            actor_verification="system",
            payload={"target_blueprint_id": blueprint.id, "target_blueprint_version": blueprint.version, "reason": input_data.reason},
        )
        return updated

    def get_compliance_profile(self, deployment_id: str) -> ComplianceProfile | None:
        self._ensure_deployment_exists(deployment_id)
        return next(
            (
                profile
                for profile in self.repositories.compliance_profiles.list()
                if profile.deployment_id == deployment_id
            ),
            None,
        )

    def upsert_compliance_profile(
        self,
        input_data: UpsertComplianceProfileInput,
    ) -> ComplianceProfile:
        deployment = self._ensure_deployment_exists(input_data.deployment_id)
        existing = self.get_compliance_profile(deployment.id)
        metadata = (
            _build_record_metadata(input_data.record_id)
            if existing is None
            else _touch_record(existing)
        )
        transparency_data = {
            **(
                asdict(_default_compliance_transparency())
                if existing is None
                else asdict(existing.transparency)
            ),
            **(input_data.transparency or {}),
        }
        oversight_data = {
            **(
                asdict(_default_compliance_oversight())
                if existing is None
                else asdict(existing.oversight)
            ),
            **(input_data.oversight or {}),
        }
        logging_data = {
            **(
                asdict(_default_compliance_logging())
                if existing is None
                else asdict(existing.logging)
            ),
            **(input_data.logging or {}),
        }
        profile = ComplianceProfile(
            **_record_kwargs(metadata),
            tenant_id=deployment.tenant_id,
            deployment_id=deployment.id,
            regime=input_data.regime,
            serves_eu_users=input_data.serves_eu_users,
            intended_purpose=input_data.intended_purpose,
            risk_tier=input_data.risk_tier,
            transparency=ComplianceTransparency(**transparency_data),
            oversight=ComplianceOversight(**oversight_data),
            logging=ComplianceLogging(**logging_data),
            high_risk_basis=(
                None
                if input_data.high_risk_basis is None
                else input_data.high_risk_basis
                if isinstance(input_data.high_risk_basis, HighRiskBasis)
                else HighRiskBasis(**input_data.high_risk_basis)
            ),
        )
        self.repositories.compliance_profiles.save(profile)
        return profile

    def list_compliance_artifacts(self, deployment_id: str) -> list[ComplianceArtifact]:
        self._ensure_deployment_exists(deployment_id)
        return [
            artifact
            for artifact in self.repositories.compliance_artifacts.list()
            if artifact.deployment_id == deployment_id
        ]

    def create_compliance_artifact(
        self,
        input_data: CreateComplianceArtifactInput,
    ) -> ComplianceArtifact:
        deployment = self._ensure_deployment_exists(input_data.deployment_id)
        metadata = _build_record_metadata(input_data.record_id)
        artifact = ComplianceArtifact(
            **_record_kwargs(metadata),
            tenant_id=deployment.tenant_id,
            deployment_id=deployment.id,
            kind=input_data.kind,
            status=input_data.status,
            owner=input_data.owner,
            summary=input_data.summary,
            external_ref=input_data.external_ref,
            due_at=input_data.due_at,
            completed_at=input_data.completed_at,
        )
        self.repositories.compliance_artifacts.save(artifact)
        return artifact

    def start_run_session(self, input_data: StartRunSessionInput) -> RunSession:
        self._ensure_tenant_exists(input_data.tenant_id)
        deployment = self._ensure_deployment_exists(input_data.deployment_id)
        if deployment.tenant_id != input_data.tenant_id:
            raise CipControlPlaneError("run sessions must reference a deployment from the same tenant")
        if deployment.status != "active":
            raise CipControlPlaneError("run sessions can only be started against active deployments")
        compliance_profile = self.get_compliance_profile(input_data.deployment_id)

        metadata = _build_record_metadata(input_data.record_id)
        session = RunSession(
            **_record_kwargs(metadata),
            tenant_id=input_data.tenant_id,
            deployment_id=input_data.deployment_id,
            correlation_id=input_data.correlation_id or str(uuid4()),
            status="running",
            started_at=_utc_now(),
            input_summary=input_data.input_summary,
            trace_correlation=input_data.trace_correlation,
            compliance_profile_snapshot=compliance_profile,
        )
        self.repositories.run_sessions.save(session)
        self.append_run_event(
            AppendRunEventInput(
                session_id=session.id,
                type="run_started",
                actor=AuditActor(type="agent", id="cip-runtime"),
                actor_verification="system",
                payload={"correlation_id": session.correlation_id, "input_summary": session.input_summary},
                trace_correlation=session.trace_correlation,
            )
        )
        self._record_audit_event(
            tenant_id=input_data.tenant_id,
            deployment_id=deployment.id,
            session_id=session.id,
            category="session",
            action="session.started",
            actor=AuditActor(type="agent", id="cip-runtime"),
            actor_verification="system",
            payload={
                "deployment_id": deployment.id,
                "correlation_id": session.correlation_id,
                "compliance_profile_id": None
                if compliance_profile is None
                else compliance_profile.id,
            },
        )
        return session

    def complete_run_session(self, input_data: CompleteRunSessionInput) -> RunSession:
        session = self._ensure_run_session_exists(input_data.session_id)
        if session.status in ("completed", "failed"):
            raise CipControlPlaneError(f"session {session.id} is already terminal")
        self._ensure_session_completion_requirements(session)
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
            trace_correlation=session.trace_correlation,
            compliance_profile_snapshot=session.compliance_profile_snapshot,
        )
        self.repositories.run_sessions.save(updated_session)
        self.append_run_event(
            AppendRunEventInput(
                session_id=session.id,
                type="run_completed" if input_data.status == "completed" else "run_failed",
                actor=AuditActor(type="agent", id="cip-runtime"),
                actor_verification="system",
                payload={"output_summary": input_data.output_summary},
                trace_correlation=session.trace_correlation,
            )
        )
        self._record_audit_event(
            tenant_id=updated_session.tenant_id,
            deployment_id=updated_session.deployment_id,
            session_id=updated_session.id,
            category="session",
            action="session.completed",
            actor=AuditActor(type="agent", id="cip-runtime"),
            actor_verification="system",
            payload={"status": updated_session.status},
        )
        self._persist_evidence_bundle(updated_session)
        return updated_session

    def append_run_event(self, input_data: AppendRunEventInput) -> RunEvent:
        session = self._ensure_run_session_exists(input_data.session_id)
        prior_events = [
            event for event in self.repositories.run_events.list() if event.session_id == session.id
        ]
        metadata = _build_record_metadata()
        event = RunEvent(
            **_record_kwargs(metadata),
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            session_id=session.id,
            type=input_data.type,
            sequence=len(prior_events) + 1,
            occurred_at=input_data.occurred_at or _utc_now(),
            actor=input_data.actor or AuditActor(type="agent", id="cip-runtime"),
            asserted_actor=input_data.asserted_actor,
            actor_verification=input_data.actor_verification or "asserted",
            payload=input_data.payload or {},
            trace_correlation=input_data.trace_correlation,
        )
        self.repositories.run_events.append(event)
        self._telemetry_sink.record(
            MetricEvent(
                name=f"run_event.{event.type}",
                occurred_at=event.occurred_at,
                attributes={"tenant_id": event.tenant_id, "deployment_id": event.deployment_id, "session_id": event.session_id, "sequence": event.sequence},
            )
        )
        return event

    def append_audit_event(self, input_data: AppendAuditEventInput) -> AuditEvent:
        return self._record_audit_event(
            tenant_id=input_data.tenant_id,
            deployment_id=input_data.deployment_id,
            session_id=input_data.session_id,
            category=input_data.category,
            action=input_data.action,
            actor=input_data.actor,
            asserted_actor=input_data.asserted_actor,
            actor_verification=input_data.actor_verification or "asserted",
            payload=input_data.payload,
            severity=input_data.severity,
            occurred_at=input_data.occurred_at,
        )

    def get_evidence_bundle(self, session_id: str) -> EvidenceBundle | None:
        return next(
            (
                bundle
                for bundle in self.repositories.evidence_bundles.list()
                if bundle.session_id == session_id
            ),
            None,
        )

    def record_disclosure(self, input_data: RecordDisclosureInput) -> DisclosureRecord:
        session = self._ensure_run_session_exists(input_data.session_id)
        metadata = _build_record_metadata(input_data.record_id)
        disclosure = DisclosureRecord(
            **_record_kwargs(metadata),
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            session_id=session.id,
            disclosure_version=input_data.disclosure_version,
            surface=input_data.surface,
            presented_at=input_data.presented_at,
            acknowledged_at=input_data.acknowledged_at,
        )
        self.repositories.disclosure_records.save(disclosure)
        self.append_run_event(
            AppendRunEventInput(
                session_id=session.id,
                type="disclosure_presented",
                actor=AuditActor(type="system", id="cip-control-plane"),
                actor_verification="system",
                payload={
                    "disclosure_record_id": disclosure.id,
                    "disclosure_version": disclosure.disclosure_version,
                    "surface": disclosure.surface,
                },
                occurred_at=disclosure.presented_at,
                trace_correlation=session.trace_correlation,
            )
        )
        if disclosure.acknowledged_at is not None:
            self.append_run_event(
                AppendRunEventInput(
                    session_id=session.id,
                    type="disclosure_acknowledged",
                    actor=AuditActor(type="system", id="cip-control-plane"),
                    actor_verification="system",
                    payload={
                        "disclosure_record_id": disclosure.id,
                        "disclosure_version": disclosure.disclosure_version,
                    },
                    occurred_at=disclosure.acknowledged_at,
                    trace_correlation=session.trace_correlation,
                )
            )
        self._record_audit_event(
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            session_id=session.id,
            category="session",
            action="disclosure.recorded",
            actor=AuditActor(type="system", id="cip-control-plane"),
            actor_verification="system",
            payload={
                "disclosure_record_id": disclosure.id,
                "disclosure_version": disclosure.disclosure_version,
                "acknowledged": disclosure.acknowledged_at is not None,
            },
            occurred_at=disclosure.presented_at,
        )
        return disclosure

    def record_human_review(
        self,
        input_data: RecordHumanReviewInput,
    ) -> HumanReviewRecord:
        session = self._ensure_run_session_exists(input_data.session_id)
        if (
            session.compliance_profile_snapshot is not None
            and session.compliance_profile_snapshot.logging.require_verified_actors
            and input_data.actor is None
        ):
            raise CipControlPlaneError(
                f"session {session.id} requires a verified human reviewer actor"
            )
        metadata = _build_record_metadata(input_data.record_id)
        reviewer = input_data.actor or AuditActor(
            type="human", id=input_data.reviewer_id or "reviewer"
        )
        review = HumanReviewRecord(
            **_record_kwargs(metadata),
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            session_id=session.id,
            reviewer=reviewer,
            decision=input_data.decision,
            reviewed_at=input_data.reviewed_at,
            comment=input_data.comment,
        )
        self.repositories.human_review_records.save(review)
        actor_verification = (
            "authenticated-operator" if input_data.actor is not None else "asserted"
        )
        self.append_run_event(
            AppendRunEventInput(
                session_id=session.id,
                type="human_review_completed",
                actor=reviewer,
                actor_verification=actor_verification,
                payload={
                    "human_review_id": review.id,
                    "decision": review.decision,
                    "comment": review.comment,
                },
                occurred_at=review.reviewed_at,
                trace_correlation=session.trace_correlation,
            )
        )
        self._record_audit_event(
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            session_id=session.id,
            category="approval",
            action="human_review.recorded",
            actor=reviewer,
            actor_verification=actor_verification,
            payload={
                "human_review_id": review.id,
                "decision": review.decision,
            },
            occurred_at=review.reviewed_at,
        )
        return review

    def request_human_approval(
        self,
        input_data: RequestHumanApprovalInput,
    ) -> ApprovalRequest:
        session = self._ensure_run_session_exists(input_data.session_id)
        if session.status != "running":
            raise CipControlPlaneError("human approval can only be requested for running sessions")

        metadata = _build_record_metadata()
        approval_request = ApprovalRequest(
            **_record_kwargs(metadata),
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            session_id=session.id,
            checkpoint_id=input_data.checkpoint.checkpoint_id,
            reason=input_data.checkpoint.reason,
            requested_by=input_data.actor or AuditActor(type="agent", id="cip-runtime"),
            status="pending",
            expires_at=input_data.checkpoint.expires_at,
            guardrail_definition_id=input_data.checkpoint.guardrail_definition_id,
            policy_pack_id=input_data.checkpoint.policy_pack_id,
        )
        self.repositories.approval_requests.save(approval_request)

        session_metadata = _touch_record(session)
        updated_session = RunSession(
            **_record_kwargs(session_metadata),
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            correlation_id=session.correlation_id,
            status="waiting-human",
            started_at=session.started_at,
            input_summary=session.input_summary,
            completed_at=session.completed_at,
            output_summary=session.output_summary,
            current_approval_request_id=approval_request.id,
            trace_correlation=session.trace_correlation,
            compliance_profile_snapshot=session.compliance_profile_snapshot,
        )
        self.repositories.run_sessions.save(updated_session)
        self.append_run_event(
            AppendRunEventInput(
                session_id=session.id,
                type="approval_requested",
                actor=approval_request.requested_by,
                actor_verification="authenticated-sdk",
                payload={"approval_request_id": approval_request.id, "checkpoint_id": approval_request.checkpoint_id, "reason": approval_request.reason},
                trace_correlation=session.trace_correlation,
            )
        )
        self._record_audit_event(
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            session_id=session.id,
            category="approval",
            action="approval.requested",
            actor=approval_request.requested_by,
            actor_verification="authenticated-sdk",
            payload={"approval_request_id": approval_request.id, "checkpoint_id": approval_request.checkpoint_id},
        )
        return approval_request

    def resolve_approval_request(
        self,
        input_data: ResolveApprovalRequestInput,
    ) -> ApprovalRequest:
        approval_request = self._ensure_approval_request_exists(input_data.approval_request_id)
        if approval_request.status != "pending":
            raise CipControlPlaneError(f"approval request {approval_request.id} is already {approval_request.status}")

        metadata = _touch_record(approval_request)
        resolved = ApprovalRequest(
            **_record_kwargs(metadata),
            tenant_id=approval_request.tenant_id,
            deployment_id=approval_request.deployment_id,
            session_id=approval_request.session_id,
            checkpoint_id=approval_request.checkpoint_id,
            reason=approval_request.reason,
            requested_by=approval_request.requested_by,
            status=input_data.decision,
            expires_at=approval_request.expires_at,
            resolved_at=_utc_now(),
            resolution_comment=input_data.resolution_comment,
            guardrail_definition_id=approval_request.guardrail_definition_id,
            policy_pack_id=approval_request.policy_pack_id,
        )
        self.repositories.approval_requests.save(resolved)

        session = self._ensure_run_session_exists(approval_request.session_id)
        next_status: RunSessionStatus = "running" if input_data.decision == "approved" else "failed"
        session_metadata = _touch_record(session)
        updated_session = RunSession(
            **_record_kwargs(session_metadata),
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            correlation_id=session.correlation_id,
            status=next_status,
            started_at=session.started_at,
            input_summary=session.input_summary,
            completed_at=_utc_now() if next_status == "failed" else session.completed_at,
            output_summary=session.output_summary,
            trace_correlation=session.trace_correlation,
            compliance_profile_snapshot=session.compliance_profile_snapshot,
        )
        self.repositories.run_sessions.save(updated_session)

        actor = input_data.actor or AuditActor(type="human", id="operator")
        self.append_run_event(
            AppendRunEventInput(
                session_id=session.id,
                type="approval_resolved",
                actor=actor,
                actor_verification="authenticated-operator",
                payload={"approval_request_id": resolved.id, "decision": resolved.status, "resolution_comment": resolved.resolution_comment},
                trace_correlation=session.trace_correlation,
            )
        )
        if input_data.decision != "approved":
            self.append_run_event(
                AppendRunEventInput(
                    session_id=session.id,
                    type="run_failed",
                    actor=actor,
                    actor_verification="authenticated-operator",
                    payload={"approval_request_id": resolved.id, "decision": resolved.status},
                    trace_correlation=session.trace_correlation,
                )
            )
            self._persist_evidence_bundle(updated_session)

        self._record_audit_event(
            tenant_id=updated_session.tenant_id,
            deployment_id=updated_session.deployment_id,
            session_id=updated_session.id,
            category="approval",
            action="approval.resolved",
            actor=actor,
            actor_verification="authenticated-operator",
            payload={"approval_request_id": resolved.id, "decision": resolved.status},
        )
        return resolved

    def replay_run_session(self, session_id: str) -> ReplayedRunSession:
        session = self._ensure_run_session_exists(session_id)
        run_events = [event for event in self.repositories.run_events.list() if event.session_id == session_id]
        approval_requests = [request for request in self.repositories.approval_requests.list() if request.session_id == session_id]
        disclosure_records = [record for record in self.repositories.disclosure_records.list() if record.session_id == session_id]
        human_reviews = [review for review in self.repositories.human_review_records.list() if review.session_id == session_id]
        compliance_artifact_ids = [artifact.id for artifact in self.repositories.compliance_artifacts.list() if artifact.deployment_id == session.deployment_id]
        evidence_bundle = next(
            (bundle for bundle in self.repositories.evidence_bundles.list() if bundle.session_id == session_id),
            None,
        )

        reconstructed_status: RunSessionStatus = "queued"
        for event in run_events:
            if event.type == "run_started":
                reconstructed_status = "running"
            elif event.type == "approval_requested":
                reconstructed_status = "waiting-human"
            elif event.type == "approval_resolved":
                reconstructed_status = "running" if event.payload.get("decision") == "approved" else "failed"
            elif event.type == "run_completed":
                reconstructed_status = "completed"
            elif event.type == "run_failed":
                reconstructed_status = "failed"

        return ReplayedRunSession(
            session=session,
            run_events=run_events,
            approval_requests=approval_requests,
            disclosure_records=disclosure_records,
            human_reviews=human_reviews,
            compliance_profile=session.compliance_profile_snapshot,
            compliance_artifact_ids=compliance_artifact_ids,
            evidence_bundle=evidence_bundle,
            reconstructed_status=reconstructed_status,
        )

    def _record_audit_event(
        self,
        *,
        tenant_id: str,
        category: str,
        action: str,
        actor: AuditActor,
        asserted_actor: AuditActor | None = None,
        actor_verification: str | None,
        payload: dict[str, Any],
        deployment_id: str | None = None,
        session_id: str | None = None,
        severity: str = "info",
        occurred_at: str | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            id=str(uuid4()),
            tenant_id=tenant_id,
            deployment_id=deployment_id,
            session_id=session_id,
            category=category,
            action=action,
            severity=severity,
            occurred_at=occurred_at or _utc_now(),
            actor=actor,
            asserted_actor=asserted_actor,
            actor_verification=actor_verification or "asserted",
            payload=payload,
        )
        self.repositories.audit_events.append(event)
        self._telemetry_sink.record(
            MetricEvent(
                name=f"audit_event.{event.action}",
                occurred_at=event.occurred_at,
                attributes={"tenant_id": event.tenant_id, "deployment_id": event.deployment_id, "session_id": event.session_id, "category": event.category},
            )
        )
        return event

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

    def _ensure_guardrail_definition_exists(self, guardrail_definition_id: str) -> GuardrailDefinition:
        guardrail_definition = self.repositories.guardrail_definitions.get_by_id(guardrail_definition_id)
        if guardrail_definition is None:
            raise CipControlPlaneError(f"unknown guardrail definition: {guardrail_definition_id}")
        return guardrail_definition

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

    def _ensure_approval_request_exists(self, approval_request_id: str) -> ApprovalRequest:
        approval_request = self.repositories.approval_requests.get_by_id(approval_request_id)
        if approval_request is None:
            raise CipControlPlaneError(f"unknown approval request: {approval_request_id}")
        return approval_request

    def _ensure_deployment_compliance_ready(self, deployment_id: str) -> None:
        profile = self.get_compliance_profile(deployment_id)
        if profile is None or profile.risk_tier != "high-risk":
            return
        required = {
            "technical_documentation": "approved",
            "fundamental_rights_impact_assessment": "approved",
            "conformity_assessment": "approved",
            "eu_declaration_of_conformity": "filed",
            "eu_database_registration": "filed",
            "post_market_monitoring_plan": "approved",
        }
        artifacts = self.list_compliance_artifacts(deployment_id)
        for kind, status in required.items():
            if not any(
                artifact.kind == kind and artifact.status == status
                for artifact in artifacts
            ):
                raise CipControlPlaneError(
                    f"deployment {deployment_id} is missing required compliance artifact {kind}:{status}"
                )

    def _ensure_session_completion_requirements(self, session: RunSession) -> None:
        profile = session.compliance_profile_snapshot
        if profile is None:
            return
        if profile.transparency.required:
            disclosures = [
                record
                for record in self.repositories.disclosure_records.list()
                if record.session_id == session.id
            ]
            if not disclosures:
                raise CipControlPlaneError(
                    f"session {session.id} requires disclosure before completion"
                )
            if profile.transparency.requires_acknowledgement and not any(
                record.acknowledged_at is not None for record in disclosures
            ):
                raise CipControlPlaneError(
                    f"session {session.id} requires disclosure acknowledgement before completion"
                )
        if profile.oversight.require_approval_before_completion:
            approvals = [
                review
                for review in self.repositories.human_review_records.list()
                if review.session_id == session.id and review.decision == "approved"
            ]
            if len(approvals) < profile.oversight.minimum_human_reviewers:
                raise CipControlPlaneError(
                    f"session {session.id} requires {profile.oversight.minimum_human_reviewers} approved human review(s) before completion"
                )

    def _persist_evidence_bundle(self, session: RunSession) -> EvidenceBundle:
        deployment = self._ensure_deployment_exists(session.deployment_id)
        blueprint = self._ensure_agent_blueprint_exists(deployment.agent_blueprint_id)
        run_events = [event for event in self.repositories.run_events.list() if event.session_id == session.id]
        audit_events = [event for event in self.repositories.audit_events.list() if event.session_id == session.id]
        disclosure_records = [record for record in self.repositories.disclosure_records.list() if record.session_id == session.id]
        human_reviews = [review for review in self.repositories.human_review_records.list() if review.session_id == session.id]
        compliance_artifacts = [artifact for artifact in self.repositories.compliance_artifacts.list() if artifact.deployment_id == session.deployment_id]
        existing = next(
            (bundle for bundle in self.repositories.evidence_bundles.list() if bundle.session_id == session.id),
            None,
        )
        metadata = _build_record_metadata() if existing is None else _touch_record(existing)
        bundle = EvidenceBundle(
            **_record_kwargs(metadata),
            tenant_id=session.tenant_id,
            deployment_id=session.deployment_id,
            session_id=session.id,
            agent_blueprint_id=blueprint.id,
            agent_blueprint_version=blueprint.version,
            policy_pack_versions=blueprint.dependency_snapshot.policy_packs,
            guardrail_versions=blueprint.dependency_snapshot.guardrails,
            summary=session.output_summary or f"Evidence bundle for {blueprint.key}@{blueprint.version}",
            run_event_ids=[event.id for event in run_events],
            audit_event_ids=[event.id for event in audit_events],
            disclosure_record_ids=[record.id for record in disclosure_records],
            human_review_ids=[review.id for review in human_reviews],
            compliance_artifact_ids=[artifact.id for artifact in compliance_artifacts],
            generated_at=_utc_now(),
            compliance_profile=session.compliance_profile_snapshot,
        )
        self.repositories.evidence_bundles.save(bundle)
        return bundle
