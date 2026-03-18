import type { ConnectorRateBucket } from "../domain/records.js";
import type { MutableRepository } from "../repositories/ports.js";
import type { ConnectorRateBucketFilter } from "../repositories/filters.js";
import type {
  ConnectorQuotaCoordinator,
  ConnectorQuotaLease,
  ConnectorQuotaRequest,
} from "./types.js";

const nowIso = (): string => new Date().toISOString();

export class RepositoryConnectorQuotaCoordinator
  implements ConnectorQuotaCoordinator
{
  private readonly bucketLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly buckets: MutableRepository<
      ConnectorRateBucket,
      ConnectorRateBucketFilter
    >,
  ) {}

  async acquire(request: ConnectorQuotaRequest): Promise<ConnectorQuotaLease> {
    const bucketKey = [
      request.provider,
      request.externalSystemTenant,
      request.environment,
      request.apiFamily,
    ].join(":");

    return this.withBucketLock(bucketKey, async () => {
      const [existing] = await this.buckets.list({
        provider: request.provider,
        externalSystemTenant: request.externalSystemTenant,
        environment: request.environment,
        apiFamily: request.apiFamily,
      });

      const now = Date.now();
      const bucket =
        existing ??
        ({
          id: bucketKey,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          revision: 1,
          provider: request.provider,
          externalSystemTenant: request.externalSystemTenant,
          environment: request.environment,
          apiFamily: request.apiFamily,
          maxRequestsPerSecond: request.maxRequestsPerSecond,
          availableTokens: request.maxRequestsPerSecond,
          lastRefillAt: nowIso(),
          queueDepth: 0,
          status: "active",
        } satisfies ConnectorRateBucket);

      const elapsedSeconds = (now - Date.parse(bucket.lastRefillAt)) / 1000;
      const refilledTokens = Math.min(
        bucket.maxRequestsPerSecond,
        bucket.availableTokens + elapsedSeconds * bucket.maxRequestsPerSecond,
      );

      const granted = refilledTokens >= 1;
      const nextBucket: ConnectorRateBucket = {
        ...bucket,
        updatedAt: nowIso(),
        revision: bucket.revision + 1,
        lastRefillAt: nowIso(),
        availableTokens: granted ? refilledTokens - 1 : refilledTokens,
        queueDepth: granted ? 0 : bucket.queueDepth + 1,
      };

      await this.buckets.save(nextBucket);

      return {
        granted,
        bucket: nextBucket,
        retryAfterMs: granted ? 0 : Math.ceil(1000 / bucket.maxRequestsPerSecond),
      };
    });
  }

  private async withBucketLock<T>(
    bucketKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const prior = this.bucketLocks.get(bucketKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const chain = prior.then(() => current);
    this.bucketLocks.set(bucketKey, chain);
    await prior;

    try {
      return await operation();
    } finally {
      release?.();
      if (this.bucketLocks.get(bucketKey) === chain) {
        this.bucketLocks.delete(bucketKey);
      }
    }
  }
}

export class PostgresConnectorQuotaCoordinator extends RepositoryConnectorQuotaCoordinator {}
