export interface VaultReference {
  provider: string;
  ref: string;
}

export interface ResolvedSecret {
  value: string;
  metadata?: Record<string, unknown>;
}

export interface SecretAccessPolicy {
  allowedProviders: string[];
  requiredScopes: string[];
}

export interface SecretResolver {
  resolve(
    reference: VaultReference,
    accessPolicy?: SecretAccessPolicy,
  ): Promise<ResolvedSecret>;
}

export class EnvironmentSecretResolver implements SecretResolver {
  async resolve(
    reference: VaultReference,
    accessPolicy?: SecretAccessPolicy,
  ): Promise<ResolvedSecret> {
    if (
      accessPolicy !== undefined &&
      !accessPolicy.allowedProviders.includes(reference.provider)
    ) {
      throw new Error(`secret provider ${reference.provider} is not permitted`);
    }

    const envKey = reference.ref.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const value = process.env[envKey];

    if (value === undefined) {
      throw new Error(`missing environment secret ${envKey}`);
    }

    return {
      value,
      metadata: { envKey },
    };
  }
}

export class StubVaultResolver implements SecretResolver {
  constructor(
    private readonly values: Record<string, string> = {},
  ) {}

  async resolve(reference: VaultReference): Promise<ResolvedSecret> {
    const key = `${reference.provider}:${reference.ref}`;
    const value = this.values[key];

    if (value === undefined) {
      throw new Error(`stub secret not found for ${key}`);
    }

    return {
      value,
      metadata: { stub: true },
    };
  }
}
