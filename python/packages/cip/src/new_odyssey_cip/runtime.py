from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from agents import Agent

from .records import ApprovalRequestStatus, GuardrailDefinition, RunSessionStatus, RuntimeProfile, TraceCorrelation


@dataclass(slots=True)
class CipToolBinding:
    name: str
    description: str
    execute: Any
    input_schema: dict[str, Any] | None = None


@dataclass(slots=True)
class CipGuardrailBinding:
    definition: GuardrailDefinition
    mode: str = "blocking"


@dataclass(slots=True)
class HumanApprovalCheckpoint:
    checkpoint_id: str
    reason: str
    guardrail_definition_id: str | None = None
    policy_pack_id: str | None = None
    expires_at: str | None = None


@dataclass(slots=True)
class HumanApprovalDecision:
    approval_request_id: str
    decision: ApprovalRequestStatus
    resolution_comment: str | None = None


@dataclass(slots=True)
class CipSessionHandle:
    session_id: str
    conversation_id: str | None = None
    previous_response_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class CipAgentSpec:
    name: str
    instructions: str
    runtime_profile: RuntimeProfile
    tools: list[CipToolBinding]
    handoff_targets: list[str] = field(default_factory=list)
    guardrails: list[CipGuardrailBinding] = field(default_factory=list)
    structured_output: str | None = None


@dataclass(slots=True)
class CipRunRequest:
    agent: CipAgentSpec
    input: str
    session: CipSessionHandle
    context: dict[str, Any] = field(default_factory=dict)
    approval_checkpoints: list[HumanApprovalCheckpoint] = field(default_factory=list)


@dataclass(slots=True)
class CipRunResult:
    status: RunSessionStatus
    final_output: str | None = None
    trace_correlation: TraceCorrelation | None = None
    pending_approval: HumanApprovalCheckpoint | None = None
    output_items: list[dict[str, Any]] = field(default_factory=list)


class CipRuntimeAdapter(Protocol):
    name: str
    version: str

    def create_agent(self, spec: CipAgentSpec) -> Any: ...

    def run(self, request: CipRunRequest) -> CipRunResult: ...

    def create_session_handle(
        self,
        session_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> CipSessionHandle: ...

    def create_approval_checkpoint(
        self,
        checkpoint: HumanApprovalCheckpoint,
    ) -> HumanApprovalCheckpoint: ...

    def resolve_approval_decision(
        self,
        decision: HumanApprovalDecision,
    ) -> HumanApprovalDecision: ...


class OpenAIAgentsRuntimeAdapter:
    name = "openai-agents-sdk"

    def __init__(self, version: str = "0.12.4") -> None:
        self.version = version

    def create_agent(self, spec: CipAgentSpec) -> Agent[Any]:
        return Agent(name=spec.name, instructions=spec.instructions, tools=[])

    def run(self, request: CipRunRequest) -> CipRunResult:
        self.create_agent(request.agent)
        trace_correlation = TraceCorrelation(
            provider="openai",
            conversation_id=request.session.conversation_id,
            response_id=request.session.metadata.get("responseId")
            if isinstance(request.session.metadata.get("responseId"), str)
            else None,
        )
        if request.approval_checkpoints:
            return CipRunResult(
                status="waiting-human",
                pending_approval=request.approval_checkpoints[0],
                trace_correlation=trace_correlation,
            )
        return CipRunResult(
            status="completed",
            final_output=f"OpenAI Agents SDK adapter accepted input: {request.input}",
            trace_correlation=trace_correlation,
        )

    def create_session_handle(
        self,
        session_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> CipSessionHandle:
        return CipSessionHandle(session_id=session_id, metadata=metadata or {})

    def create_approval_checkpoint(
        self,
        checkpoint: HumanApprovalCheckpoint,
    ) -> HumanApprovalCheckpoint:
        return checkpoint

    def resolve_approval_decision(
        self,
        decision: HumanApprovalDecision,
    ) -> HumanApprovalDecision:
        return decision
