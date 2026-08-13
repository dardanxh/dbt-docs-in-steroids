from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies.database import get_session
from app.domain.analytics.schemas import AnalyticsResponse
from app.domain.analytics.services import AnalyticsService

router = APIRouter(prefix="/projects/{project_id}", tags=["analytics"])


@router.get("/analytics", response_model=AnalyticsResponse)
def get_analytics(project_id: str, session: Session = Depends(get_session)) -> AnalyticsResponse:
    return AnalyticsService(session).analytics(project_id)
