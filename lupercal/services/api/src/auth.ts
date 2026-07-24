import { TextEncoder } from "node:util";

import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

import { hashApiKey, touchApiKeyLastUsed } from "./store.js";
import type { ApiKeyRecord, ApiKeyScope, ControlPlaneServiceStore } from "./types.js";

export type OperatorScope =
  | "control-plane:admin"
  | "tenants:read"
  | "tenants:write"
  | "connectors:read"
  | "connectors:write"
  | "credentials:read"
  | "credentials:write"
  | "policies:read"
  | "policies:write"
  | "blueprints:read"
  | "blueprints:write"
  | "deployments:read"
  | "deployments:write"
  | "api-keys:read"
  | "api-keys:write"
  | "ingest:read"
  | "ingest:write"
  | "audit:read"
  | "approvals:resolve";

export interface OperatorClaims {
  sub: string;
  scope: string;
  tenantId?: string;
}

export type OperatorAuthConfig =
  | {
      mode?: "hs256";
      sharedSecret: string;
      issuer: string;
      audience: string;
    }
  | {
      mode: "jwks-rs256";
      jwksUrl: string;
      issuer: string;
      audience: string;
    };

const encoder = new TextEncoder();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const parseScopes = (scope: string): Set<string> =>
  new Set(
    scope
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );

export const extractBearerToken = (
  authorizationHeader: string | undefined,
): string | null => {
  if (authorizationHeader === undefined) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || token === undefined) {
    return null;
  }

  return token;
};

export const authenticateSdkApiKey = async (
  store: ControlPlaneServiceStore,
  authorizationHeader: string | undefined,
  requiredScope: ApiKeyScope,
): Promise<ApiKeyRecord | null> => {
  const token = extractBearerToken(authorizationHeader);
  if (token === null) {
    return null;
  }

  const record = await store.apiKeys.getByHash(hashApiKey(token));
  if (record === null || record.status !== "active") {
    return null;
  }
  if (record.expiresAt !== undefined && record.expiresAt <= new Date().toISOString()) {
    return null;
  }

  if (!record.scopes.includes(requiredScope)) {
    throw new Error(`api key is missing required scope ${requiredScope}`);
  }

  await touchApiKeyLastUsed(store, record);
  return record;
};

const getJwks = (jwksUrl: string) => {
  const cached = jwksCache.get(jwksUrl);
  if (cached !== undefined) {
    return cached;
  }
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  jwksCache.set(jwksUrl, jwks);
  return jwks;
};

export const verifyOperatorToken = async (
  authorizationHeader: string | undefined,
  config: OperatorAuthConfig,
): Promise<OperatorClaims | null> => {
  const token = extractBearerToken(authorizationHeader);
  if (token === null) {
    return null;
  }

  const verified =
    config.mode === "jwks-rs256"
      ? await jwtVerify(token, getJwks(config.jwksUrl), {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["RS256"],
        })
      : await jwtVerify(token, encoder.encode(config.sharedSecret), {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["HS256"],
        });

  const scope = verified.payload.scope;
  const sub = verified.payload.sub;

  if (typeof scope !== "string" || typeof sub !== "string") {
    throw new Error("operator token is missing required claims");
  }

  const tenantId =
    typeof verified.payload.tenantId === "string"
      ? verified.payload.tenantId
      : undefined;

  return {
    sub,
    scope,
    ...(tenantId === undefined ? {} : { tenantId }),
  };
};

export const requireOperatorScope = (
  claims: OperatorClaims,
  requiredScope: OperatorScope,
  tenantId?: string,
): void => {
  const scopes = parseScopes(claims.scope);
  if (!scopes.has("control-plane:admin") && !scopes.has(requiredScope)) {
    throw new Error(`operator token is missing required scope ${requiredScope}`);
  }

  if (claims.tenantId !== undefined && tenantId !== undefined && claims.tenantId !== tenantId) {
    throw new Error("operator token is not authorized for this tenant");
  }
};

export const signOperatorToken = async (
  claims: OperatorClaims,
  config: Extract<OperatorAuthConfig, { mode?: "hs256" }>,
): Promise<string> =>
  new SignJWT({
    scope: claims.scope,
    ...(claims.tenantId === undefined ? {} : { tenantId: claims.tenantId }),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(encoder.encode(config.sharedSecret));
