from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies.database import get_session
from app.domain.lineage.schemas import (
    ColumnLineageResponse,
    ColumnLite,
    GraphResponse,
    MetricValueOut,
    NodeDetailOut,
)
from app.domain.lineage.services import LineageService

router = APIRouter(prefix="/projects/{project_id}", tags=["lineage"])


@router.get("/graph", response_model=GraphResponse)
def get_graph(project_id: str, session: Session = Depends(get_session)) -> GraphResponse:
    return LineageService(session).graph(project_id)


@router.get("/metrics", response_model=list[MetricValueOut])
def get_metrics(
    project_id: str,
    metric: str = Query("downstream_count"),
    session: Session = Depends(get_session),
) -> list[MetricValueOut]:
    return LineageService(session).metrics(project_id, metric)


@router.get("/nodes/{node_id}", response_model=NodeDetailOut)
def get_node(project_id: str, node_id: str, session: Session = Depends(get_session)) -> NodeDetailOut:
    return LineageService(session).node_detail(project_id, node_id)


@router.get("/nodes/{node_id}/columns", response_model=list[ColumnLite])
def get_node_columns(project_id: str, node_id: str, session: Session = Depends(get_session)) -> list[ColumnLite]:
    return LineageService(session).node_columns(project_id, node_id)


@router.get("/nodes/{node_id}/columns/{column}/lineage", response_model=ColumnLineageResponse)
def get_column_lineage(
    project_id: str,
    node_id: str,
    column: str,
    direction: str = Query("upstream", pattern="^(upstream|downstream|both)$"),
    session: Session = Depends(get_session),
) -> ColumnLineageResponse:
    return LineageService(session).column_lineage(project_id, node_id, column, direction)
