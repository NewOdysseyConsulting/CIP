from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Protocol


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


class EnvironmentSecretResolver:
    def resolve(
        self,
        reference: VaultReference,
        access_policy: SecretAccessPolicy | None = None,
    ) -> ResolvedSecret:
        if access_policy is not None and reference.provider not in access_policy.allowed_providers:
            raise ValueError(f"secret provider {reference.provider} is not permitted")

        env_key = "".join(character if character.isalnum() else "_" for character in reference.ref.upper())
        value = os.environ.get(env_key)
        if value is None:
            raise ValueError(f"missing environment secret {env_key}")
        return ResolvedSecret(value=value, metadata={"env_key": env_key})


class StubVaultResolver:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self._values = values or {}

    def resolve(
        self,
        reference: VaultReference,
        access_policy: SecretAccessPolicy | None = None,
    ) -> ResolvedSecret:
        del access_policy
        key = f"{reference.provider}:{reference.ref}"
        if key not in self._values:
            raise ValueError(f"stub secret not found for {key}")
        return ResolvedSecret(value=self._values[key], metadata={"stub": True})
