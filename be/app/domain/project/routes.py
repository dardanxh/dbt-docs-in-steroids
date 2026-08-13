from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.dependencies.database import get_session
from app.domain.project.schemas import CreateProject, ProjectResult
from app.domain.project.services import ProjectService
from app.settings import get_settings

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/", response_model=list[ProjectResult])
def list_projects(session: Session = Depends(get_session)) -> list[ProjectResult]:
    return ProjectService(session).list()


@router.get("/defaults", response_model=dict)
def project_defaults() -> dict[str, str | None]:
    """Prefill values for the 'register project' form (dev convenience)."""
    return {"default_path": get_settings().default_dbt_project_path}


@router.get("/{project_id}", response_model=ProjectResult)
def get_project(project_id: str, session: Session = Depends(get_session)) -> ProjectResult:
    return ProjectService(session).get(project_id)


@router.post("/", response_model=ProjectResult, status_code=201)
def create_project(data: CreateProject, session: Session = Depends(get_session)) -> ProjectResult:
    return ProjectService(session).create_from_path(data)


@router.post("/upload", response_model=ProjectResult, status_code=201)
async def upload_project(
    name: str = Form(...),
    manifest: UploadFile = File(...),
    catalog: UploadFile | None = File(None),
    session: Session = Depends(get_session),
) -> ProjectResult:
    manifest_bytes = await manifest.read()
    catalog_bytes = await catalog.read() if catalog is not None else None
    return ProjectService(session).create_from_upload(name, manifest_bytes, catalog_bytes)


@router.post("/{project_id}/ingest", response_model=ProjectResult)
def reingest_project(project_id: str, session: Session = Depends(get_session)) -> ProjectResult:
    return ProjectService(session).reingest(project_id)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, session: Session = Depends(get_session)) -> None:
    ProjectService(session).delete(project_id)
    session.commit()
