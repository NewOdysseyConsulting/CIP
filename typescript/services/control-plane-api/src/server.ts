import { CipControlPlane, createPostgresCipRepositories } from "@new-odyssey/cip";
import { Pool } from "pg";

import { createControlPlaneApiApp } from "./app.js";
import { runControlPlaneMigrations } from "./migrations.js";
import { createPostgresControlPlaneServiceStore } from "./store.js";

const databaseUrl = process.env.CIP_DATABASE_URL;
const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const sharedSecret = process.env.CIP_OPERATOR_SHARED_SECRET;
const issuer = process.env.CIP_OPERATOR_ISSUER ?? "cip-control-plane";
const audience = process.env.CIP_OPERATOR_AUDIENCE ?? "cip-operators";
const runMigrationsOnStartup =
  process.env.CIP_RUN_MIGRATIONS_ON_STARTUP === "true";

if (databaseUrl === undefined || sharedSecret === undefined) {
  throw new Error(
    "CIP_DATABASE_URL and CIP_OPERATOR_SHARED_SECRET must be configured",
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
});

const repositories = createPostgresCipRepositories(pool);
const controlPlane = new CipControlPlane(repositories);
const serviceStore = createPostgresControlPlaneServiceStore(pool);

const app = createControlPlaneApiApp({
  controlPlane,
  repositories,
  serviceStore,
  operatorAuth: {
    sharedSecret,
    issuer,
    audience,
  },
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await pool.end();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

if (runMigrationsOnStartup) {
  await runControlPlaneMigrations(pool);
}
await app.listen({ host, port });
