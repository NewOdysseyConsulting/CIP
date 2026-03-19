import { CipControlPlane, createPostgresCipRepositories } from "@new-odyssey/cip";
import {
  cleanupRetentionRecords,
  createPostgresControlPlaneServiceStore,
  processNextIngestJob,
} from "@new-odyssey/cip-control-plane-api";
import { Pool } from "pg";

const databaseUrl = process.env.CIP_DATABASE_URL;
const pollIntervalMs = Number.parseInt(
  process.env.CIP_WORKER_POLL_INTERVAL_MS ?? "1000",
  10,
);
const maxAttempts = Number.parseInt(process.env.CIP_WORKER_MAX_ATTEMPTS ?? "5", 10);
const retentionWindowHours = Number.parseInt(
  process.env.CIP_RETENTION_WINDOW_HOURS ?? "168",
  10,
);
const retentionSweepEveryLoops = Number.parseInt(
  process.env.CIP_RETENTION_SWEEP_EVERY_LOOPS ?? "300",
  10,
);

if (databaseUrl === undefined) {
  throw new Error("CIP_DATABASE_URL must be configured");
}

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

export const startControlPlaneWorker = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
  });
  const repositories = createPostgresCipRepositories(pool);
  const controlPlane = new CipControlPlane(repositories);
  const serviceStore = createPostgresControlPlaneServiceStore(pool);

  let running = true;
  let loopCount = 0;

  const shutdown = async (): Promise<void> => {
    running = false;
    await pool.end();
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  while (running) {
    loopCount += 1;
    const result = await processNextIngestJob({
      controlPlane,
      serviceStore,
      maxAttempts,
    });
    if (loopCount % retentionSweepEveryLoops === 0) {
      const cutoff = new Date(
        Date.now() - retentionWindowHours * 60 * 60 * 1000,
      ).toISOString();
      const cleaned = await cleanupRetentionRecords(serviceStore, cutoff);
      console.info(
        JSON.stringify({
          message: "retention.cleanup",
          ...cleaned,
          cutoff,
        }),
      );
    }
    if (result === null) {
      await sleep(pollIntervalMs);
    } else {
      console.info(
        JSON.stringify({
          message: "ingest.job.processed",
          outcome: result.outcome,
          jobId: result.job.id,
          tenantId: result.job.tenantId,
        }),
      );
    }
  }
};

await startControlPlaneWorker();
