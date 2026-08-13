from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.enums import IngestStatus, SourceType
from app.core.exceptions import NotFoundError
from app.domain.ingestion.artifacts import load_from_bytes, load_from_path
from app.domain.ingestion.services import IngestionService
from app.domain.project.models import Project
from app.domain.project.repositories import ProjectRepository
from app.domain.project.schemas import CreateProject, ProjectResult


class ProjectService:
    def __init__(self, session: Session):
        self.session = session
        self.repository = ProjectRepository(session)
        self.ingestion = IngestionService(session)

    def get(self, project_id: str) -> ProjectResult:
        entity = self.repository.get(project_id)
        if not entity:
            raise NotFoundError(f"Project {project_id} not found")
        return ProjectResult.model_validate(entity)

    def list(self) -> list[ProjectResult]:
        return [ProjectResult.model_validate(p) for p in self.repository.list()]

    def create_from_path(self, data: CreateProject) -> ProjectResult:
        # Validate the artifacts exist/parse before committing to a project row.
        load_from_path(data.path)
        entity = Project(
            name=data.name,
            source_type=SourceType.PATH,
            source_ref=data.path,
            status=IngestStatus.PENDING,
        )
        self.repository.create(entity)
        return self.ingestion.ingest_path_project(entity.id, force=True)

    def create_from_upload(self, name: str, manifest_bytes: bytes, catalog_bytes: bytes | None) -> ProjectResult:
        bundle = load_from_bytes(manifest_bytes, catalog_bytes)
        entity = Project(name=name, source_type=SourceType.UPLOAD, source_ref=None, status=IngestStatus.PENDING)
        self.repository.create(entity)
        return self.ingestion.ingest_bundle_for_project(entity.id, bundle)

    def reingest(self, project_id: str) -> ProjectResult:
        return self.ingestion.ingest_path_project(project_id, force=True)

    def delete(self, project_id: str) -> None:
        entity = self.repository.get(project_id)
        if not entity:
            raise NotFoundError(f"Project {project_id} not found")
        self.repository.delete(entity)
