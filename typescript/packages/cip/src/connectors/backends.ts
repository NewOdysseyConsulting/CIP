import type {
  ConnectorBackend,
  ConnectorHealthcheckResult,
  ConnectorInvocationContext,
  ConnectorManifest,
  ConnectorQuotaRequest,
  ConnectorToolContract,
  ConnectorToolExecutionResult,
  HttpJsonConnectorOperation,
} from "./types.js";

const nowIso = (): string => new Date().toISOString();

const acquireQuota = async (
  context: ConnectorInvocationContext,
  manifest: ConnectorManifest,
  provider: string,
  apiFamily = "http-json",
) =>
  context.quotaCoordinator.acquire({
    provider,
    externalSystemTenant: context.externalSystemTenant,
    environment: context.environment,
    apiFamily,
    maxRequestsPerSecond: manifest.rateLimitPolicy.maxRequestsPerSecond,
  } satisfies ConnectorQuotaRequest);

const ensureOperation = (
  operation: HttpJsonConnectorOperation | ConnectorToolContract,
): operation is HttpJsonConnectorOperation =>
  "method" in operation && "path" in operation;

const operationName = (
  operation: HttpJsonConnectorOperation | ConnectorToolContract,
): string => ("toolName" in operation ? operation.toolName : operation.name);

const interpolatePath = (
  path: string,
  input: Record<string, unknown>,
): string =>
  path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = input[key];
    if (value === undefined) {
      throw new Error(`missing path parameter ${key}`);
    }
    return encodeURIComponent(String(value));
  });

export class HttpJsonConnectorBackend implements ConnectorBackend {
  readonly key = "http-json";

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async healthcheck(
    manifest: ConnectorManifest,
    context: ConnectorInvocationContext,
  ): Promise<ConnectorHealthcheckResult> {
    const quota = await acquireQuota(context, manifest, manifest.key);
    if (!quota.granted) {
      return {
        connectorKey: manifest.key,
        status: "degraded",
        checkedAt: nowIso(),
        details: {
          message: "connector quota not available",
          retryAfterMs: quota.retryAfterMs,
        },
      };
    }

    try {
      const response = await this.fetchImpl(context.endpoint, {
        method: "GET",
        headers: {
          ...(context.headers ?? {}),
        },
      });
      return {
        connectorKey: manifest.key,
        status: response.ok ? "ready" : "failed",
        checkedAt: nowIso(),
        details: {
          statusCode: response.status,
        },
      };
    } catch (error) {
      return {
        connectorKey: manifest.key,
        status: "failed",
        checkedAt: nowIso(),
        details: {
          error: error instanceof Error ? error.message : "unknown healthcheck error",
        },
      };
    }
  }

  async invoke(
    manifest: ConnectorManifest,
    operation: HttpJsonConnectorOperation | ConnectorToolContract,
    context: ConnectorInvocationContext,
    input: Record<string, unknown>,
  ): Promise<ConnectorToolExecutionResult> {
    const quota = await acquireQuota(context, manifest, manifest.key);
    const toolName = operationName(operation);
    if (!quota.granted) {
      return {
        status: "failed",
        connectorKey: manifest.key,
        toolName,
        quota,
        message: "connector quota exhausted",
        data: {
          retryAfterMs: quota.retryAfterMs,
        },
      };
    }

    if (!ensureOperation(operation)) {
      return {
        status: "not_implemented",
        connectorKey: manifest.key,
        toolName,
        quota,
        message: `${toolName} is not backed by a live HTTP operation`,
        data: {
          phase: "stub",
        },
      };
    }

    const url = new URL(interpolatePath(operation.path, input), context.endpoint);
    const headers = {
      "content-type": "application/json",
      ...(operation.requestHeaders ?? {}),
      ...(context.headers ?? {}),
    };
    const response = await this.fetchImpl(url.toString(), {
      method: operation.method,
      headers,
      ...(operation.method === "GET" || operation.method === "DELETE"
        ? {}
        : { body: JSON.stringify(input) }),
    });

    const data =
      response.headers.get("content-type")?.includes("application/json") === true
        ? ((await response.json()) as Record<string, unknown>)
        : { body: await response.text() };

    return {
      status: response.ok ? "ok" : "failed",
      connectorKey: manifest.key,
      toolName,
      quota,
      message: response.ok ? "connector operation succeeded" : "connector operation failed",
      data: {
        statusCode: response.status,
        response: data,
      },
    };
  }
}
