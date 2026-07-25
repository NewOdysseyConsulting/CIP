import type {
  CipClient,
  DeploymentRecord,
  TenantRecord,
} from "@new-odyssey/cip";

export interface ConformanceFixture {
  client: CipClient;
  tenant: TenantRecord;
  deployment: DeploymentRecord;
  /** Hosted transports honor batch idempotency keys; in-process transports may not. */
  supportsIngestIdempotency: boolean;
  teardown?: () => Promise<void>;
}

export interface ConformanceTarget {
  name: string;
  setup(): Promise<ConformanceFixture>;
}

export type CheckStatus = "passed" | "failed" | "skipped";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
}

export interface ConformanceCheck {
  id: string;
  title: string;
  /** Spec document the check enforces. */
  spec: string;
  run(fixture: ConformanceFixture): Promise<void>;
  /** Return a reason string to skip the check for this fixture. */
  skip?(fixture: ConformanceFixture): string | undefined;
}

export interface ConformanceReport {
  target: string;
  startedAt: string;
  finishedAt: string;
  results: CheckResult[];
  passed: boolean;
}

export class ConformanceViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConformanceViolation";
  }
}
