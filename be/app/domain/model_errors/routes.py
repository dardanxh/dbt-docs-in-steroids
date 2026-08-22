from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies.database import get_session
from app.domain.model_errors.schemas import ModelErrorOut, ModelErrorsUpload, UploadResult
from app.domain.model_errors.services import ModelErrorsService

router = APIRouter(prefix="/projects/{project_id}", tags=["model-errors"])


@router.post("/errors", response_model=UploadResult, status_code=201)
def upload_errors(project_id: str, payload: ModelErrorsUpload, session: Session = Depends(get_session)) -> UploadResult:
    result = ModelErrorsService(session).upload(project_id, payload)
    session.commit()  # write endpoint owns its commit (like delete_project)
    return result


@router.get("/nodes/{node_id}/errors", response_model=list[ModelErrorOut])
def get_node_errors(project_id: str, node_id: str, session: Session = Depends(get_session)) -> list[ModelErrorOut]:
    return ModelErrorsService(session).by_node(project_id, node_id)


@router.delete("/errors", status_code=204)
def clear_errors(project_id: str, session: Session = Depends(get_session)) -> None:
    ModelErrorsService(session).clear(project_id)
    session.commit()
