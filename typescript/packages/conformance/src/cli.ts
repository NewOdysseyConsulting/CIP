#!/usr/bin/env node
import { runConformanceSuite } from "./runner.js";
import { createHttpTarget, createLocalTarget } from "./targets.js";

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const baseUrl = argValue("--base-url");
const target =
  baseUrl === undefined
    ? createLocalTarget()
    : createHttpTarget({
        baseUrl,
        ...(argValue("--api-key") === undefined
          ? {}
          : { apiKey: argValue("--api-key")! }),
        ...(argValue("--operator-token") === undefined
          ? {}
          : { operatorToken: argValue("--operator-token")! }),
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
