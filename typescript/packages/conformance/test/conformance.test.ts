import assert from "node:assert/strict";
import test from "node:test";

import { CONFORMANCE_CHECKS } from "../src/checks.js";
import { runConformanceSuite } from "../src/runner.js";
import { createLocalTarget } from "../src/targets.js";

test("the in-memory reference implementation passes the conformance suite", async () => {
  const report = await runConformanceSuite(createLocalTarget());

  const failed = report.results.filter((result) => result.status === "failed");
  assert.deepEqual(
    failed.map((result) => `${result.id}: ${result.detail}`),
    [],
    "no check may fail against the reference implementation",
  );
  assert.equal(report.passed, true);

  const skipped = report.results.filter((result) => result.status === "skipped");
  assert.deepEqual(
    skipped.map((result) => result.id),
    ["ingest-idempotency"],
    "only the hosted-only idempotency check is skipped in-process",
  );
});

test("every check names the spec document it enforces", () => {
  for (const check of CONFORMANCE_CHECKS) {
    assert.match(check.spec, /\.md$/);
    assert.ok(check.id.length > 0);
    assert.ok(check.title.length > 0);
  }
});
