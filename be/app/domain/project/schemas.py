from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.core.enums import IngestStatus, SourceType


class CreateProject(BaseModel):
    name: str
    path: str  # local dbt project directory (its target/ holds the artifacts)


class ProjectResult(BaseModel):
    id: str
    name: str
    source_type: SourceType
    source_ref: str | None
    manifest_hash: str | None
    status: IngestStatus
    error: str | None
    ingested_at: datetime | None
    stats: dict[str, Any] | None

    model_config = {"from_attributes": True}
