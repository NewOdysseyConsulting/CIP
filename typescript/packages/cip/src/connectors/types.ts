import type {
  ConnectorRateBucket,
  Environment,
  IsoTimestamp,
} from "../domain/records.js";

export interface RateLimitPolicy {
  maxRequestsPerSecond: number;
}

export interface ConnectorToolContract {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ConnectorManifest {
  key: string;
  version: string;
  platform: string;
  description: string;
  tools: ConnectorToolContract[];
  rateLimitPolicy: RateLimitPolicy;
}

export interface ConnectorHealthcheckResult {
  connectorKey: string;
  status: "ready" | "degraded" | "not_implemented";
  checkedAt: IsoTimestamp;
  details: Record<string, unknown>;
}

export interface ConnectorQuotaRequest {
  provider: string;
  externalSystemTenant: string;
  environment: Environment;
  apiFamily: string;
  maxRequestsPerSecond: number;
}

export interface ConnectorQuotaLease {
  granted: boolean;
  bucket: ConnectorRateBucket;
  retryAfterMs: number;
}

export interface ConnectorQuotaCoordinator {
  acquire(request: ConnectorQuotaRequest): Promise<ConnectorQuotaLease>;
}

export interface ConnectorStubContext {
  tenantId: string;
  externalSystemTenant: string;
  environment: Environment;
  quotaCoordinator: ConnectorQuotaCoordinator;
}

export interface ConnectorToolExecutionResult {
  status: "not_implemented";
  connectorKey: string;
  toolName: string;
  quota: ConnectorQuotaLease;
  message: string;
  data: Record<string, unknown>;
}
