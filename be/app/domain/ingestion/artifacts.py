"""Read + validate dbt artifacts (manifest.json, catalog.json).

Supports two sources (per product decision): a local project *path* whose
``target/`` holds the artifacts, or raw *uploaded* bytes. Everything downstream
consumes the resulting :class:`ArtifactBundle`, so the rest of ingestion is
agnostic to where the JSON came from.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.exceptions import BadRequestError


@dataclass
class ArtifactBundle:
    manifest: dict[str, Any]
    catalog: dict[str, Any] = field(default_factory=dict)
    manifest_hash: str = ""

    @property
    def dbt_version(self) -> str | None:
        value = self.manifest.get("metadata", {}).get("dbt_version")
        return value if isinstance(value, str) else None

    @property
    def adapter(self) -> str | None:
        value = self.manifest.get("metadata", {}).get("adapter_type")
        return value if isinstance(value, str) else None


def _hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_from_bytes(manifest_bytes: bytes, catalog_bytes: bytes | None) -> ArtifactBundle:
    try:
        manifest = json.loads(manifest_bytes)
    except json.JSONDecodeError as exc:
        raise BadRequestError(f"manifest.json is not valid JSON: {exc}") from exc
    if "nodes" not in manifest:
        raise BadRequestError("manifest.json is missing a 'nodes' key — is this a real dbt manifest?")

    catalog: dict[str, Any] = {}
    if catalog_bytes:
        try:
            catalog = json.loads(catalog_bytes)
        except json.JSONDecodeError as exc:
            raise BadRequestError(f"catalog.json is not valid JSON: {exc}") from exc

    return ArtifactBundle(manifest=manifest, catalog=catalog, manifest_hash=_hash(manifest_bytes))


def load_from_path(project_path: str) -> ArtifactBundle:
    """Read ``<project_path>/target/manifest.json`` (+ catalog.json if present)."""
    root = Path(project_path).expanduser()
    if not root.exists():
        raise BadRequestError(f"Project path does not exist: {project_path}")

    target = root / "target"
    manifest_file = target / "manifest.json"
    catalog_file = target / "catalog.json"

    if not manifest_file.is_file():
        raise BadRequestError(f"No manifest.json under {target}. Run `dbt docs generate` (or `dbt compile`) first.")

    manifest_bytes = manifest_file.read_bytes()
    catalog_bytes = catalog_file.read_bytes() if catalog_file.is_file() else None
    return load_from_bytes(manifest_bytes, catalog_bytes)
