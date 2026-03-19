import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

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

export interface SecretBackendContext {
  accessPolicy?: SecretAccessPolicy;
}

export interface SecretBackend {
  key: string;
  resolve(
    reference: VaultReference,
    context?: SecretBackendContext,
  ): Promise<ResolvedSecret>;
}

export class SecretBackendRegistry {
  private readonly backends = new Map<string, SecretBackend>();

  constructor(backends: SecretBackend[] = []) {
    for (const backend of backends) {
      this.register(backend);
    }
  }

  register(backend: SecretBackend): void {
    this.backends.set(backend.key, backend);
  }

  get(key: string): SecretBackend | null {
    return this.backends.get(key) ?? null;
  }

  async resolve(
    backendKey: string,
    reference: VaultReference,
    context?: SecretBackendContext,
  ): Promise<ResolvedSecret> {
    const backend = this.get(backendKey);
    if (backend === null) {
      throw new Error(`unknown secret backend ${backendKey}`);
    }
    return backend.resolve(reference, context);
  }
}

const enforceAccessPolicy = (
  reference: VaultReference,
  accessPolicy?: SecretAccessPolicy,
): void => {
  if (
    accessPolicy !== undefined &&
    !accessPolicy.allowedProviders.includes(reference.provider)
  ) {
    throw new Error(`secret provider ${reference.provider} is not permitted`);
  }
};

export class EnvironmentSecretResolver implements SecretResolver, SecretBackend {
  readonly key = "environment";

  async resolve(
    reference: VaultReference,
    accessPolicy?: SecretAccessPolicy | SecretBackendContext,
  ): Promise<ResolvedSecret> {
    const normalizedPolicy =
      accessPolicy !== undefined && "allowedProviders" in accessPolicy
        ? accessPolicy
        : accessPolicy?.accessPolicy;

    enforceAccessPolicy(reference, normalizedPolicy);

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

export class StubVaultResolver implements SecretResolver, SecretBackend {
  readonly key = "stub";

  constructor(
    private readonly values: Record<string, string> = {},
  ) {}

  async resolve(
    reference: VaultReference,
    accessPolicy?: SecretAccessPolicy | SecretBackendContext,
  ): Promise<ResolvedSecret> {
    const normalizedPolicy =
      accessPolicy !== undefined && "allowedProviders" in accessPolicy
        ? accessPolicy
        : accessPolicy?.accessPolicy;
    enforceAccessPolicy(reference, normalizedPolicy);

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

export interface AwsSecretsManagerSecretBackendOptions {
  client?: SecretsManagerClient;
  region?: string;
  cacheTtlMs?: number;
}

interface CachedSecret {
  expiresAt: number;
  secret: ResolvedSecret;
}

export class AwsSecretsManagerSecretBackend implements SecretBackend {
  readonly key = "aws-secrets-manager";

  private readonly client: SecretsManagerClient;
  private readonly cache = new Map<string, CachedSecret>();
  private readonly cacheTtlMs: number;

  constructor(options: AwsSecretsManagerSecretBackendOptions = {}) {
    this.client =
      options.client ??
      new SecretsManagerClient({
        ...(options.region === undefined ? {} : { region: options.region }),
      });
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  async resolve(
    reference: VaultReference,
    context?: SecretBackendContext,
  ): Promise<ResolvedSecret> {
    enforceAccessPolicy(reference, context?.accessPolicy);
    const cached = this.cache.get(reference.ref);
    const now = Date.now();
    if (cached !== undefined && cached.expiresAt > now) {
      return cached.secret;
    }

    const response = await this.client.send(
      new GetSecretValueCommand({
        SecretId: reference.ref,
      }),
    );
    const value = response.SecretString ?? response.SecretBinary?.toString();
    if (value === undefined) {
      throw new Error(`secret ${reference.ref} did not contain a string value`);
    }

    const secret: ResolvedSecret = {
      value,
      metadata: {
        arn: response.ARN,
        versionId: response.VersionId,
      },
    };
    this.cache.set(reference.ref, {
      expiresAt: now + this.cacheTtlMs,
      secret,
    });
    return secret;
  }
}
