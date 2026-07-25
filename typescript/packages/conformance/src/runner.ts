import { CONFORMANCE_CHECKS } from "./checks.js";
import type {
  CheckResult,
  ConformanceCheck,
  ConformanceReport,
  ConformanceTarget,
} from "./types.js";

export const runConformanceSuite = async (
  target: ConformanceTarget,
  checks: ConformanceCheck[] = CONFORMANCE_CHECKS,
): Promise<ConformanceReport> => {
  const startedAt = new Date().toISOString();
  const fixture = await target.setup();
  const results: CheckResult[] = [];

  try {
    for (const check of checks) {
      const skipReason = check.skip?.(fixture);
      if (skipReason !== undefined) {
        results.push({
          id: check.id,
          title: check.title,
          status: "skipped",
          detail: skipReason,
        });
        continue;
      }

      try {
        await check.run(fixture);
        results.push({ id: check.id, title: check.title, status: "passed" });
      } catch (error) {
        results.push({
          id: check.id,
          title: check.title,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await fixture.teardown?.();
  }

  return {
    target: target.name,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    passed: results.every((result) => result.status !== "failed"),
  };
};
