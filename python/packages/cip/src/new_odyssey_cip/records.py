from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

IsoTimestamp = str
ProductTier = Literal["pegasus", "pantheon", "phoenix"]
Environment = Literal["development", "test", "sandbox", "production"]
PolicyDomain = Literal["platform", "security", "expense", "recruitment", "onboarding"]
PolicyOperator = Literal[
    "eq",
    "neq",
    "in",
    "contains",
    "exists",
    "regex",
    "gt",
    "gte",
    "lt",
    "lte",
]
PolicyRuleAction = Literal["allow", "flag", "block", "escalate"]
Severity = Literal["info", "warn", "high", "critical"]
ReleaseState = Literal["draft", "released", "deprecated"]
DeploymentStatus = Literal[
    "provisioning",
    "active",
    "paused",
    "draining",
    "failed",
    "retired",
]
RunSessionStatus = Literal[
    "queued",
    "running",
    "waiting-human",
    "completed",
    "failed",
]
ComplianceRegime = Literal["eu-ai-act"]
ComplianceRiskTier = Literal["minimal", "limited", "high-risk", "prohibited", "unclassified"]
ApprovalRequestStatus = Literal[
    "pending",
    "approved",
    "rejected",
    "expired",
    "cancelled",
]
RunEventType = Literal[
    "run_started",
    "tool_called",
    "tool_completed",
    "handoff_started",
    "handoff_completed",
    "guardrail_triggered",
    "policy_decided",
    "approval_requested",
    "approval_resolved",
    "disclosure_presented",
    "disclosure_acknowledged",
    "human_review_completed",
    "output_overridden",
    "stop_invoked",
    "run_completed",
    "run_failed",
]
ActorVerification = Literal[
    "system",
    "authenticated-sdk",
    "authenticated-operator",
    "asserted",
]
ComplianceArtifactKind = Literal[
    "technical_documentation",
    "fundamental_rights_impact_assessment",
    "conformity_assessment",
    "eu_declaration_of_conformity",
    "eu_database_registration",
    "post_market_monitoring_plan",
    "serious_incident_record",
]
ComplianceArtifactStatus = Literal["draft", "approved", "filed", "not_applicable", "expired"]
DisclosureSurface = Literal["banner", "first_message", "banner_and_first_message"]
GuardrailKey = Literal[
    "tenant_boundary",
    "pii_boundary",
    "least_privilege",
    "manual_review_required",
    "data_residency",
]


@dataclass(slots=True)
class BaseRecord:
    id: str
    created_at: IsoTimestamp
    updated_at: IsoTimestamp
    revision: int


@dataclass(slots=True)
class TraceCorrelation:
    provider: Literal["openai", "custom"]
    trace_id: str | None = None
    span_id: str | None = None
    conversation_id: str | None = None
    response_id: str | None = None


@dataclass(slots=True)
class HighRiskBasis:
    annex: Literal["annex-i", "annex-iii"]
    category: str
    rationale: str


@dataclass(slots=True)
class ComplianceTransparency:
    required: bool
    notice_text: str
    placement: Literal["banner-and-first-message"]
    requires_acknowledgement: bool


@dataclass(slots=True)
class ComplianceOversight:
    required: bool
    require_approval_before_completion: bool
    minimum_human_reviewers: int
    stop_mechanism_required: bool


@dataclass(slots=True)
class ComplianceLogging:
    require_verified_actors: bool
    retention_days: int


@dataclass(slots=True)
class TenantRecord(BaseRecord):
    slug: str
    display_name: str
    product_tier: ProductTier
    platforms: list[str]
    regions: list[str]
    status: Literal["active", "suspended", "retired"]


@dataclass(slots=True)
class ConnectorDefinition(BaseRecord):
    key: str
    version: str
    platform: str
    display_name: str
    runtime: Literal["mcp", "native", "http"]
    auth_strategy: Literal["oauth2", "api-key", "service-account", "custom"]
    source: Literal["first-party", "partner", "community"]
    capabilities: list[str]
    status: Literal["draft", "active", "deprecated"]
    driver_key: str | None = None
    driver_config: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


@dataclass(slots=True)
class CredentialBinding(BaseRecord):
    tenant_id: str
    name: str
    provider: str
    secret_ref: str
    scopes: list[str]
    status: Literal["active", "rotated", "revoked"]
    secret_backend_key: str | None = None
    expires_at: IsoTimestamp | None = None
    rotated_at: IsoTimestamp | None = None


@dataclass(slots=True)
class ConnectorBinding(BaseRecord):
    tenant_id: str
    connector_definition_id: str
    credential_binding_id: str
    environment: Environment
    alias: str
    endpoint: str
    config: dict[str, Any]
    status: Literal["active", "disabled"]


@dataclass(slots=True)
class PolicyCondition:
    path: str
    operator: PolicyOperator
    value: Any | None = None


@dataclass(slots=True)
class PolicyClause:
    id: str
    name: str
    match: Literal["all", "any"]
    conditions: list[PolicyCondition]


@dataclass(slots=True)
class PolicyRule:
    id: str
    name: str
    severity: Severity
    action: PolicyRuleAction
    description: str | None = None
    expression: str | None = None
    clauses: list[PolicyClause] = field(default_factory=list)


@dataclass(slots=True)
class PolicyPack(BaseRecord):
    key: str
    name: str
    domain: PolicyDomain
    version: str
    ownership: Literal["shared", "tenant"]
    rules: list[PolicyRule]
    guardrail_refs: list[str]
    status: Literal["draft", "active", "retired"]
    tenant_id: str | None = None


@dataclass(slots=True)
class RuntimeProfile:
    provider: Literal["openai-agents-sdk", "anthropic", "custom"]
    model_profile: Literal["default", "reasoning", "fast"]
    adapter_version: str | None = None


@dataclass(slots=True)
class DependencyVersionReference:
    id: str
    key: str
    version: str


@dataclass(slots=True)
class BlueprintDependencySnapshot:
    policy_packs: list[DependencyVersionReference]
    guardrails: list[DependencyVersionReference]
    connector_manifests: list[DependencyVersionReference]
    runtime_adapter_version: str


@dataclass(slots=True)
class AgentBlueprint(BaseRecord):
    key: str
    version: str
    release_state: ReleaseState
    dependency_snapshot: BlueprintDependencySnapshot
    name: str
    product_tier: ProductTier
    domain: PolicyDomain
    description: str
    runtime: RuntimeProfile
    connector_definition_ids: list[str]
    policy_pack_ids: list[str]
    guardrail_definition_ids: list[str]
    handoff_targets: list[str]
    status: Literal["draft", "active", "deprecated"]
    supersedes_blueprint_id: str | None = None
    structured_output: str | None = None


@dataclass(slots=True)
class DeploymentRecord(BaseRecord):
    tenant_id: str
    agent_blueprint_id: str
    agent_blueprint_version: str
    environment: Environment
    connector_binding_ids: list[str]
    policy_pack_ids: list[str]
    status: DeploymentStatus
    tags: list[str]
    last_transition_at: IsoTimestamp
    deployed_at: IsoTimestamp | None = None


@dataclass(slots=True)
class ComplianceProfile(BaseRecord):
    tenant_id: str
    deployment_id: str
    regime: ComplianceRegime
    serves_eu_users: bool
    intended_purpose: str
    risk_tier: ComplianceRiskTier
    transparency: ComplianceTransparency
    oversight: ComplianceOversight
    logging: ComplianceLogging
    high_risk_basis: HighRiskBasis | None = None


@dataclass(slots=True)
class ComplianceArtifact(BaseRecord):
    tenant_id: str
    deployment_id: str
    kind: ComplianceArtifactKind
    status: ComplianceArtifactStatus
    owner: str
    summary: str
    external_ref: str | None = None
    due_at: IsoTimestamp | None = None
    completed_at: IsoTimestamp | None = None


@dataclass(slots=True)
class RunSession(BaseRecord):
    tenant_id: str
    deployment_id: str
    correlation_id: str
    status: RunSessionStatus
    started_at: IsoTimestamp
    input_summary: str
    completed_at: IsoTimestamp | None = None
    output_summary: str | None = None
    current_approval_request_id: str | None = None
    trace_correlation: TraceCorrelation | None = None
    compliance_profile_snapshot: ComplianceProfile | None = None


@dataclass(slots=True)
class AuditActor:
    type: Literal["agent", "human", "system"]
    id: str


@dataclass(slots=True)
class AuditEvent:
    id: str
    tenant_id: str
    category: Literal[
        "tenant",
        "connector",
        "policy",
        "deployment",
        "session",
        "security",
        "approval",
        "runtime",
    ]
    action: str
    severity: Literal["info", "warn", "error", "critical"]
    occurred_at: IsoTimestamp
    actor: AuditActor
    actor_verification: ActorVerification
    payload: dict[str, Any]
    asserted_actor: AuditActor | None = None
    deployment_id: str | None = None
    session_id: str | None = None


@dataclass(slots=True)
class GuardrailDefinition(BaseRecord):
    key: str
    version: str
    name: str
    configuration: dict[str, Any]
    status: Literal["draft", "active", "retired"]
    description: str | None = None


@dataclass(slots=True)
class ApprovalRequest(BaseRecord):
    tenant_id: str
    deployment_id: str
    session_id: str
    checkpoint_id: str
    reason: str
    requested_by: AuditActor
    status: ApprovalRequestStatus
    expires_at: IsoTimestamp | None = None
    resolved_at: IsoTimestamp | None = None
    resolution_comment: str | None = None
    guardrail_definition_id: str | None = None
    policy_pack_id: str | None = None


@dataclass(slots=True)
class RunEvent(BaseRecord):
    tenant_id: str
    deployment_id: str
    session_id: str
    type: RunEventType
    sequence: int
    occurred_at: IsoTimestamp
    actor: AuditActor
    actor_verification: ActorVerification
    payload: dict[str, Any]
    asserted_actor: AuditActor | None = None
    trace_correlation: TraceCorrelation | None = None


@dataclass(slots=True)
class DisclosureRecord(BaseRecord):
    tenant_id: str
    deployment_id: str
    session_id: str
    disclosure_version: str
    surface: DisclosureSurface
    presented_at: IsoTimestamp
    acknowledged_at: IsoTimestamp | None = None


@dataclass(slots=True)
class HumanReviewRecord(BaseRecord):
    tenant_id: str
    deployment_id: str
    session_id: str
    reviewer: AuditActor
    decision: Literal["approved", "rejected"]
    reviewed_at: IsoTimestamp
    comment: str | None = None


@dataclass(slots=True)
class EvidenceBundle(BaseRecord):
    tenant_id: str
    deployment_id: str
    session_id: str
    agent_blueprint_id: str
    agent_blueprint_version: str
    policy_pack_versions: list[DependencyVersionReference]
    guardrail_versions: list[DependencyVersionReference]
    summary: str
    run_event_ids: list[str]
    audit_event_ids: list[str]
    disclosure_record_ids: list[str]
    human_review_ids: list[str]
    compliance_artifact_ids: list[str]
    generated_at: IsoTimestamp
    compliance_profile: ComplianceProfile | None = None


@dataclass(slots=True)
class ConnectorRateBucket(BaseRecord):
    provider: str
    external_system_tenant: str
    environment: Environment
    api_family: str
    max_requests_per_second: int
    available_tokens: float
    last_refill_at: IsoTimestamp
    queue_depth: int
    status: Literal["active", "disabled"]
