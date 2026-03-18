import { CipControlPlane, createPostgresCipRepositories } from "@new-odyssey/cip";
import {
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
    const result = await processNextIngestJob({
      controlPlane,
      serviceStore,
      maxAttempts,
    });
    if (result === null) {
      await sleep(pollIntervalMs);
    }
  }
};

await startControlPlaneWorker();
