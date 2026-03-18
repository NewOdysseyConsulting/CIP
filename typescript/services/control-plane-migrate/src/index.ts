import { runControlPlaneMigrations } from "@new-odyssey/cip-control-plane-api";
import { Pool } from "pg";

const databaseUrl = process.env.CIP_DATABASE_URL;

if (databaseUrl === undefined) {
  throw new Error("CIP_DATABASE_URL must be configured");
}

const pool = new Pool({
  connectionString: databaseUrl,
});

try {
  await runControlPlaneMigrations(pool);
} finally {
  await pool.end();
}
