# new-odyssey-lupercal

Python modules for Lupercal, the commercial control platform that implements the [CIP protocol](../../../spec/README.md).

- `new_odyssey_lupercal.romulus` — durable state: Postgres repositories and the phase-1 migration SQL.
- `new_odyssey_lupercal.remus` — policy engine: the deterministic policy evaluator and the default guardrail catalog.

Both modules implement interfaces defined by the open `new-odyssey-cip` package (`CipRepositories`, `PolicyEvaluator`). This package is staged here ahead of extraction into the private Lupercal repository and is not part of the CIP open-source surface.
