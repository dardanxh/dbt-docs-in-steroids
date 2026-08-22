from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.core.enums import ErrorCategory


class ErrorItem(BaseModel):
    """One error occurrence for a model (agent-supplied)."""

    occurred_at: datetime
    category: ErrorCategory  # validated against the fixed taxonomy (invalid -> 422)
    message: str
    phase: str | None = None  # run | test | build | compile | freshness | other
    details: dict[str, Any] | None = None  # freeform agent context (dag_id, task_id, run_id, ...)


class ModelErrorsForModel(BaseModel):
    model: str  # dbt unique_id (e.g. "model.dwh.merchant") or plain name (e.g. "merchant")
    errors: list[ErrorItem]


class ModelErrorsUpload(BaseModel):
    """Bulk upload payload. Replace-per-model: each listed model's errors fully
    replace whatever is stored for it."""

    models: list[ModelErrorsForModel]


class UploadResult(BaseModel):
    models_received: int
    models_matched: int
    errors_inserted: int
    unresolved: list[str]  # model identifiers that matched no node (or were ambiguous)


class ModelErrorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    occurred_at: datetime
    category: str
    message: str
    phase: str | None
    details: dict[str, Any] | None
