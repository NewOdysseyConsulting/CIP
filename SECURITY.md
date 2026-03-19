# Security Policy

## Supported line

The active prerelease line is currently:

- `0.2.0-alpha.x`

Older prerelease builds may not receive fixes.

## Reporting a vulnerability

Do not open public GitHub issues for suspected security vulnerabilities.

Report privately with:

- a description of the issue
- affected component or package
- reproduction steps or proof of concept
- impact assessment if known

Until a dedicated security mailbox is published, use your existing New Odyssey private contact channel for coordinated disclosure.

## Project-specific security expectations

When contributing, treat these as high-sensitivity areas:

- auth and tenant isolation
- API key issuance, rotation, revocation, and scope enforcement
- operator JWT validation
- idempotency and queue processing
- audit provenance and replay correctness
- secret resolution and secret backend integrations
- connector quota coordination and cross-tenant isolation

## Handling secrets

- Never commit real credentials or tokens.
- Never persist resolved secret values in CIP repositories or fixtures.
- Use environment variables, test doubles, or local secret stores for development.

## Dependency posture

- Prefer official SDKs and primary integrations.
- Keep dependencies current enough to receive security updates.
- If a security issue requires a breaking change during prerelease, favor the fix over compatibility.
