import { CipControlPlane } from "@new-odyssey/cip";
import { createPostgresCipRepositories } from "@new-odyssey/romulus";
import { Pool } from "pg";

import { createControlPlaneApiApp } from "./app.js";
import { runControlPlaneMigrations } from "./migrations.js";
import { createPostgresControlPlaneServiceStore } from "./store.js";

const databaseUrl = process.env.LUPERCAL_DATABASE_URL;
const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const issuer = process.env.LUPERCAL_OPERATOR_ISSUER ?? "lupercal-control-plane";
const audience = process.env.LUPERCAL_OPERATOR_AUDIENCE ?? "lupercal-operators";
const authMode = process.env.LUPERCAL_OPERATOR_AUTH_MODE ?? "hs256";
const sharedSecret = process.env.LUPERCAL_OPERATOR_SHARED_SECRET;
const jwksUrl = process.env.LUPERCAL_OPERATOR_JWKS_URL;
const runMigrationsOnStartup =
  process.env.LUPERCAL_RUN_MIGRATIONS_ON_STARTUP === "true";

if (
  databaseUrl === undefined ||
  (authMode === "jwks-rs256" ? jwksUrl === undefined : sharedSecret === undefined)
) {
  throw new Error(
    "LUPERCAL_DATABASE_URL and the configured operator auth settings must be provided",
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
  operatorAuth:
    authMode === "jwks-rs256"
      ? {
          mode: "jwks-rs256",
          jwksUrl: jwksUrl!,
          issuer,
          audience,
        }
      : {
          mode: "hs256",
          sharedSecret: sharedSecret!,
          issuer,
          audience,
        },
  readyCheck: async () => {
    try {
      await pool.query("select 1");
      return true;
    } catch {
      return false;
    }
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
