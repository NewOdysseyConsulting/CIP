from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Protocol

try:
    import boto3
except Exception:  # pragma: no cover - optional at import time
    boto3 = None


@dataclass(slots=True)
class VaultReference:
    provider: str
    ref: str


@dataclass(slots=True)
class ResolvedSecret:
    value: str
    metadata: dict[str, Any] | None = None


@dataclass(slots=True)
class SecretAccessPolicy:
    allowed_providers: list[str]
    required_scopes: list[str]


class SecretResolver(Protocol):
    def resolve(
        self,
        reference: VaultReference,
        access_policy: SecretAccessPolicy | None = None,
    ) -> ResolvedSecret: ...


@dataclass(slots=True)
class SecretBackendContext:
    access_policy: SecretAccessPolicy | None = None


class SecretBackend(Protocol):
    key: str

    def resolve(
        self,
        reference: VaultReference,
        context: SecretBackendContext | None = None,
    ) -> ResolvedSecret: ...


def _enforce_access_policy(
    reference: VaultReference,
    access_policy: SecretAccessPolicy | None,
) -> None:
    if access_policy is not None and reference.provider not in access_policy.allowed_providers:
        raise ValueError(f"secret provider {reference.provider} is not permitted")


class SecretBackendRegistry:
    def __init__(self, backends: list[SecretBackend] | None = None) -> None:
        self._backends: dict[str, SecretBackend] = {}
        for backend in backends or []:
            self.register(backend)

    def register(self, backend: SecretBackend) -> None:
        self._backends[backend.key] = backend

    def get(self, key: str) -> SecretBackend | None:
        return self._backends.get(key)

    def resolve(
        self,
        backend_key: str,
        reference: VaultReference,
        context: SecretBackendContext | None = None,
    ) -> ResolvedSecret:
        backend = self.get(backend_key)
        if backend is None:
            raise ValueError(f"unknown secret backend {backend_key}")
        return backend.resolve(reference, context)


class EnvironmentSecretResolver:
    key = "environment"

    def resolve(
        self,
        reference: VaultReference,
        access_policy: SecretAccessPolicy | SecretBackendContext | None = None,
    ) -> ResolvedSecret:
        normalized_policy = (
            access_policy
            if isinstance(access_policy, SecretAccessPolicy)
            else None if access_policy is None else access_policy.access_policy
        )
        _enforce_access_policy(reference, normalized_policy)

        env_key = "".join(character if character.isalnum() else "_" for character in reference.ref.upper())
        value = os.environ.get(env_key)
        if value is None:
            raise ValueError(f"missing environment secret {env_key}")
        return ResolvedSecret(value=value, metadata={"env_key": env_key})


class StubVaultResolver:
    key = "stub"

    def __init__(self, values: dict[str, str] | None = None) -> None:
        self._values = values or {}

    def resolve(
        self,
        reference: VaultReference,
        access_policy: SecretAccessPolicy | SecretBackendContext | None = None,
    ) -> ResolvedSecret:
        normalized_policy = (
            access_policy
            if isinstance(access_policy, SecretAccessPolicy)
            else None if access_policy is None else access_policy.access_policy
        )
        _enforce_access_policy(reference, normalized_policy)

        key = f"{reference.provider}:{reference.ref}"
        if key not in self._values:
            raise ValueError(f"stub secret not found for {key}")
        return ResolvedSecret(value=self._values[key], metadata={"stub": True})


class AwsSecretsManagerSecretBackend:
    key = "aws-secrets-manager"

    def __init__(
        self,
        client: Any | None = None,
        *,
        region_name: str | None = None,
        cache_ttl_ms: int = 60_000,
    ) -> None:
        if client is None:
            if boto3 is None:
                raise RuntimeError("boto3 is required to use AwsSecretsManagerSecretBackend")
            client = boto3.client("secretsmanager", region_name=region_name)
        self._client = client
        self._cache_ttl_ms = cache_ttl_ms
        self._cache: dict[str, tuple[float, ResolvedSecret]] = {}

    def resolve(
        self,
        reference: VaultReference,
        context: SecretBackendContext | None = None,
    ) -> ResolvedSecret:
        _enforce_access_policy(reference, None if context is None else context.access_policy)
        cached = self._cache.get(reference.ref)
        now_ms = time.time() * 1000
        if cached is not None and cached[0] > now_ms:
            return cached[1]

        response = self._client.get_secret_value(SecretId=reference.ref)
        value = response.get("SecretString")
        if value is None:
            raise ValueError(f"secret {reference.ref} did not contain a string value")

        secret = ResolvedSecret(
            value=value,
            metadata={
                "arn": response.get("ARN"),
                "version_id": response.get("VersionId"),
            },
        )
        self._cache[reference.ref] = (now_ms + self._cache_ttl_ms, secret)
        return secret
