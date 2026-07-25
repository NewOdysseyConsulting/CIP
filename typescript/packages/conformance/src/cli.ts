#!/usr/bin/env node
import { runConformanceSuite } from "./runner.js";
import { createHttpTarget, createLocalTarget } from "./targets.js";

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const baseUrl = argValue("--base-url") ?? process.env.CIP_BASE_URL;
// Credentials are read from the environment so they never appear in
// process listings, shell history, or CI command logs. The flags remain
// as overrides for local experimentation only.
const apiKey = argValue("--api-key") ?? process.env.CIP_API_KEY;
const operatorToken =
  argValue("--operator-token") ?? process.env.CIP_OPERATOR_TOKEN;

const target =
  baseUrl === undefined
    ? createLocalTarget()
    : createHttpTarget({
        baseUrl,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(operatorToken === undefined ? {} : { operatorToken }),
        ...(argValue("--tenant-id") === undefined
          ? {}
          : { tenantId: argValue("--tenant-id")! }),
        ...(argValue("--deployment-id") === undefined
          ? {}
          : { deploymentId: argValue("--deployment-id")! }),
      });

const report = await runConformanceSuite(target);

const icon = { passed: "✔", failed: "✘", skipped: "–" } as const;
console.log(`CIP conformance: ${report.target}`);
for (const result of report.results) {
  const detail = result.detail === undefined ? "" : ` — ${result.detail}`;
  console.log(`  ${icon[result.status]} ${result.id}: ${result.title}${detail}`);
}
const counts = report.results.reduce(
  (acc, result) => ({ ...acc, [result.status]: (acc[result.status] ?? 0) + 1 }),
  {} as Record<string, number>,
);
console.log(
  `${report.passed ? "PASS" : "FAIL"} — ${counts.passed ?? 0} passed, ${counts.failed ?? 0} failed, ${counts.skipped ?? 0} skipped`,
);

process.exit(report.passed ? 0 : 1);
