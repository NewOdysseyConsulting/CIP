# Agent Identity and Capabilities

CIP identifies *who* is acting and *what it is allowed to reach* through four layered objects. Identity is declarative: a platform grants capabilities by binding versioned definitions to a tenant, never by trusting what a runtime asserts at call time.

## Objects

### TenantRecord

The isolation boundary. Every other object hangs off a `tenantId`.

| Field | Meaning |
| --- | --- |
| `slug`, `displayName` | Stable handle and human name |
| `productTier` | Consumer product line (`pegasus`, `pantheon`, `phoenix`) |
| `platforms` | External systems the tenant integrates (e.g. `workday`) |
| `regions` | Data-residency regions |
| `status` | `active` \| `suspended` \| `retired` |

### AgentBlueprint

The versioned identity of an agent: what it is, which runtime executes it, and which policy surface governs it. Blueprints are immutable per `key`+`version` and carry a `dependencySnapshot` pinning the exact policy-pack, guardrail, and connector-manifest versions in force when the blueprint was released. `releaseState` moves `draft` → `released` → `deprecated`; a released blueprint's dependencies MUST NOT change.

Capabilities are expressed by reference: `connectorDefinitionIds`, `policyPackIds`, `guardrailDefinitionIds`, and `handoffTargets` (the blueprint keys this agent may delegate to — see [task-delegation.md](task-delegation.md)).

Handoff targets are deliberately named by key, not version. Delegation resolves to the target key's *active deployment* for the same tenant and environment at delegation time — so where a released blueprint delegates can change when the tenant deploys a new target version. This is by design: which version of a target is active is the tenant's governance decision, made through the audited deployment lifecycle, and statically pinned delegation would let an older upstream blueprint keep routing work to a target version the tenant has since paused or retired. Two obligations keep this dynamic resolution accountable: the implementation MUST record the resolved target blueprint version in the `handoff_started` event payload so evidence pins the exact identity that received each delegation, and target deployment transitions MUST emit audit events like any other ([workflow-state.md](workflow-state.md)). Implementations MAY additionally offer per-tenant pinning of handoff targets to specific versions; a future draft may standardize `{ key, version }` references for that.

### ConnectorDefinition

A versioned capability surface for one external system: `runtime` (`mcp` \| `native` \| `http`), `authStrategy`, `source` (`first-party` \| `partner` \| `community`), and a `capabilities` string list naming the callable tools. A runtime MUST NOT invoke a tool that is not listed in the capabilities of a connector bound to the current deployment.

`CredentialBinding` and `ConnectorBinding` scope a connector to a tenant and environment: credentials are referenced by `secretRef` (never inline secrets), and bindings pin `endpoint` + `config` per environment.

### DeploymentRecord

The runtime instantiation of a blueprint for one tenant and environment. A run session always names its `deploymentId`, which transitively fixes the blueprint version, connector bindings, and policy packs that govern it.

## Requirements

- Implementations MUST resolve capabilities through the deployment → blueprint → definitions chain, not from caller-supplied lists.
- Secrets MUST be exchanged as references (`secretRef`, `secretBackendKey`); the protocol never carries secret material.
- A deployment for a released blueprint MUST record `agentBlueprintVersion` so evidence can name the exact identity that acted.
