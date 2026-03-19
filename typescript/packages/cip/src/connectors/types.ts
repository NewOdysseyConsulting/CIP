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
  driverKey?: string;
  driverConfig?: Record<string, unknown>;
  tools: ConnectorToolContract[];
  rateLimitPolicy: RateLimitPolicy;
}

export interface ConnectorHealthcheckResult {
  connectorKey: string;
  status: "ready" | "degraded" | "not_implemented" | "failed";
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

export interface ConnectorInvocationContext extends ConnectorStubContext {
  endpoint: string;
  headers?: Record<string, string>;
}

export interface ConnectorToolExecutionResult {
  status: "ok" | "not_implemented" | "failed";
  connectorKey: string;
  toolName: string;
  quota: ConnectorQuotaLease;
  message: string;
  data: Record<string, unknown>;
}

export interface HttpJsonConnectorOperation {
  toolName: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  requestHeaders?: Record<string, string>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ConnectorBackend {
  key: string;
  healthcheck(
    manifest: ConnectorManifest,
    context: ConnectorInvocationContext,
  ): Promise<ConnectorHealthcheckResult>;
  invoke(
    manifest: ConnectorManifest,
    operation: HttpJsonConnectorOperation | ConnectorToolContract,
    context: ConnectorInvocationContext,
    input: Record<string, unknown>,
  ): Promise<ConnectorToolExecutionResult>;
}

export class ConnectorBackendRegistry {
  private readonly backends = new Map<string, ConnectorBackend>();

  constructor(backends: ConnectorBackend[] = []) {
    for (const backend of backends) {
      this.register(backend);
    }
  }

  register(backend: ConnectorBackend): void {
    this.backends.set(backend.key, backend);
  }

  get(key: string): ConnectorBackend | null {
    return this.backends.get(key) ?? null;
  }
}
