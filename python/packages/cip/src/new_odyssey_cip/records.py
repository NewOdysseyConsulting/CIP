from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

IsoTimestamp = str
ProductTier = Literal["pegasus", "pantheon", "phoenix"]
Environment = Literal["development", "test", "sandbox", "production"]
PolicyDomain = Literal["platform", "security", "expense", "recruitment", "onboarding"]


@dataclass(slots=True)
class BaseRecord:
    id: str
    created_at: IsoTimestamp
    updated_at: IsoTimestamp
    revision: int


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
    platform: str
    display_name: str
    runtime: Literal["mcp", "native", "http"]
    auth_strategy: Literal["oauth2", "api-key", "service-account", "custom"]
    source: Literal["first-party", "partner", "community"]
    capabilities: list[str]
    status: Literal["draft", "active", "deprecated"]
    metadata: dict[str, Any] | None = None


@dataclass(slots=True)
class CredentialBinding(BaseRecord):
    tenant_id: str
    name: str
    provider: str
    secret_ref: str
    scopes: list[str]
    status: Literal["active", "rotated", "revoked"]
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
class PolicyRule:
    id: str
    name: str
    expression: str
    severity: Literal["info", "warn", "high", "critical"]
    action: Literal["allow", "flag", "block", "escalate"]
    description: str | None = None


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


@dataclass(slots=True)
class AgentBlueprint(BaseRecord):
    key: str
    name: str
    product_tier: ProductTier
    domain: PolicyDomain
    description: str
    runtime: RuntimeProfile
    connector_definition_ids: list[str]
    policy_pack_ids: list[str]
    handoff_targets: list[str]
    status: Literal["draft", "active", "deprecated"]
    structured_output: str | None = None


@dataclass(slots=True)
class DeploymentRecord(BaseRecord):
    tenant_id: str
    agent_blueprint_id: str
    environment: Environment
    connector_binding_ids: list[str]
    policy_pack_ids: list[str]
    status: Literal["provisioning", "active", "paused", "failed", "retired"]
    tags: list[str]
    deployed_at: IsoTimestamp | None = None


@dataclass(slots=True)
class RunSession(BaseRecord):
    tenant_id: str
    deployment_id: str
    correlation_id: str
    status: Literal["queued", "running", "waiting-human", "completed", "failed"]
    started_at: IsoTimestamp
    input_summary: str
    completed_at: IsoTimestamp | None = None
    output_summary: str | None = None


@dataclass(slots=True)
class AuditActor:
    type: Literal["agent", "human", "system"]
    id: str


@dataclass(slots=True)
class AuditEvent:
    id: str
    tenant_id: str
    category: Literal["tenant", "connector", "policy", "deployment", "session", "security"]
    action: str
    severity: Literal["info", "warn", "error", "critical"]
    occurred_at: IsoTimestamp
    actor: AuditActor
    payload: dict[str, Any]
    deployment_id: str | None = None
    session_id: str | None = None
