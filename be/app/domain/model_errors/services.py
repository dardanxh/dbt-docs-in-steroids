from __future__ import annotations

from collections import defaultdict

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.domain.lineage.repositories import LineageReadRepository
from app.domain.model_errors.repositories import ModelErrorsRepository
from app.domain.model_errors.schemas import ModelErrorOut, ModelErrorsUpload, UploadResult
from app.domain.project.repositories import ProjectRepository


class ModelErrorsService:
    def __init__(self, session: Session):
        self.session = session
        self.repo = ModelErrorsRepository(session)
        self.projects = ProjectRepository(session)
        self.lineage = LineageReadRepository(session)

    def upload(self, project_id: str, payload: ModelErrorsUpload) -> UploadResult:
        if not self.projects.get(project_id):
            raise NotFoundError(f"Project {project_id} not found")

        by_uid, by_name = self._resolver(project_id)

        matched = 0
        inserted = 0
        unresolved: list[str] = []
        for entry in payload.models:
            node_uid = self._resolve(entry.model, by_uid, by_name)
            if node_uid is None:
                unresolved.append(entry.model)
                continue
            matched += 1
            rows = [
                {
                    "project_id": project_id,
                    "node_unique_id": node_uid,
                    "occurred_at": e.occurred_at,
                    "category": e.category.value,
                    "message": e.message,
                    "phase": e.phase,
                    "details": e.details,
                }
                for e in entry.errors
            ]
            inserted += self.repo.replace_for_node(project_id, node_uid, rows)

        self.session.flush()
        return UploadResult(
            models_received=len(payload.models),
            models_matched=matched,
            errors_inserted=inserted,
            unresolved=unresolved,
        )

    def by_node(self, project_id: str, node_unique_id: str) -> list[ModelErrorOut]:
        return [ModelErrorOut.model_validate(e) for e in self.repo.by_node(project_id, node_unique_id)]

    def clear(self, project_id: str) -> None:
        self.repo.clear(project_id)

    def _resolver(self, project_id: str) -> tuple[set[str], dict[str, list[str]]]:
        """Build lookup structures for matching an uploaded ``model`` identifier:
        the set of valid unique_ids, and name -> [unique_ids] (models/seeds only,
        so an ambiguous name maps to more than one)."""
        by_uid: set[str] = set()
        by_name: dict[str, list[str]] = defaultdict(list)
        for n in self.lineage.nodes(project_id):
            by_uid.add(n.unique_id)
            if n.resource_type in ("model", "seed"):
                by_name[n.name].append(n.unique_id)
        return by_uid, by_name

    @staticmethod
    def _resolve(model: str, by_uid: set[str], by_name: dict[str, list[str]]) -> str | None:
        if model in by_uid:  # exact unique_id
            return model
        candidates = by_name.get(model)
        if candidates and len(candidates) == 1:  # unambiguous name match
            return candidates[0]
        return None  # missing or ambiguous
