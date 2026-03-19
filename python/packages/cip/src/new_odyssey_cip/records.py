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
    "run_completed",
    "run_failed",
]
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
    payload: dict[str, Any]
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
    payload: dict[str, Any]
    trace_correlation: TraceCorrelation | None = None


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
    generated_at: IsoTimestamp


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
