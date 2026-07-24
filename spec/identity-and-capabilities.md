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

### ConnectorDefinition

A versioned capability surface for one external system: `runtime` (`mcp` \| `native` \| `http`), `authStrategy`, `source` (`first-party` \| `partner` \| `community`), and a `capabilities` string list naming the callable tools. A runtime MUST NOT invoke a tool that is not listed in the capabilities of a connector bound to the current deployment.

`CredentialBinding` and `ConnectorBinding` scope a connector to a tenant and environment: credentials are referenced by `secretRef` (never inline secrets), and bindings pin `endpoint` + `config` per environment.

### DeploymentRecord

The runtime instantiation of a blueprint for one tenant and environment. A run session always names its `deploymentId`, which transitively fixes the blueprint version, connector bindings, and policy packs that govern it.

## Requirements

- Implementations MUST resolve capabilities through the deployment → blueprint → definitions chain, not from caller-supplied lists.
- Secrets MUST be exchanged as references (`secretRef`, `secretBackendKey`); the protocol never carries secret material.
- A deployment for a released blueprint MUST record `agentBlueprintVersion` so evidence can name the exact identity that acted.
