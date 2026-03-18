import type { IsoTimestamp, TraceCorrelation } from "../domain/records.js";

export interface MetricEvent {
  name: string;
  occurredAt: IsoTimestamp;
  attributes: Record<string, unknown>;
}

export interface TelemetrySink {
  record(event: MetricEvent): Promise<void>;
}

export interface EvaluationCase {
  id: string;
  name: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

export interface EvaluationResult {
  caseId: string;
  passed: boolean;
  details: string;
}

export type { TraceCorrelation };

export class InMemoryTelemetrySink implements TelemetrySink {
  readonly events: MetricEvent[] = [];

  async record(event: MetricEvent): Promise<void> {
    this.events.push(event);
  }
}
