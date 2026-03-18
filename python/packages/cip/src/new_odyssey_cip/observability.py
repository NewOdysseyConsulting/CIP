from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from .records import IsoTimestamp


@dataclass(slots=True)
class MetricEvent:
    name: str
    occurred_at: IsoTimestamp
    attributes: dict[str, Any]


class TelemetrySink(Protocol):
    def record(self, event: MetricEvent) -> None: ...


@dataclass(slots=True)
class EvaluationCase:
    id: str
    name: str
    input: dict[str, Any]
    expected: dict[str, Any]


@dataclass(slots=True)
class EvaluationResult:
    case_id: str
    passed: bool
    details: str


@dataclass(slots=True)
class InMemoryTelemetrySink(TelemetrySink):
    events: list[MetricEvent] = field(default_factory=list)

    def record(self, event: MetricEvent) -> None:
        self.events.append(event)
