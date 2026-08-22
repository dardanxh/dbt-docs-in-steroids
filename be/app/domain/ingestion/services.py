"""Orchestrates artifact → graph → column-lineage → Postgres for one project."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import IngestStatus, ParseStatus
from app.core.exceptions import BadRequestError, NotFoundError
from app.domain.ingestion import git_ownership
from app.domain.ingestion.artifacts import ArtifactBundle, load_from_path
from app.domain.ingestion.column_lineage import build_column_edges
from app.domain.ingestion.graph_builder import build_graph
from app.domain.ingestion.repositories import LineagePersistenceRepository
from app.domain.ingestion.specs import BuiltGraph, DiagnosticSpec
from app.domain.project.models import Project
from app.domain.project.repositories import ProjectRepository
from app.domain.project.schemas import ProjectResult

logger = logging.getLogger(__name__)


class IngestionService:
    def __init__(self, session: Session):
        self.session = session
        self.projects = ProjectRepository(session)
        self.persistence = LineagePersistenceRepository(session)

    def ingest_path_project(self, project_id: str, force: bool = False) -> ProjectResult:
        project = self.projects.get(project_id)
        if not project:
            raise NotFoundError(f"Project {project_id} not found")
        if not project.source_ref:
            raise BadRequestError("This project has no path to re-read; re-upload its artifacts to refresh.")
        bundle = load_from_path(project.source_ref)
        return self._ingest_bundle(project, bundle, force=force)

    def ingest_bundle_for_project(self, project_id: str, bundle: ArtifactBundle) -> ProjectResult:
        project = self.projects.get(project_id)
        if not project:
            raise NotFoundError(f"Project {project_id} not found")
        return self._ingest_bundle(project, bundle, force=True)

    def _ingest_bundle(self, project: Project, bundle: ArtifactBundle, force: bool) -> ProjectResult:
        if not force and project.status == IngestStatus.READY and project.manifest_hash == bundle.manifest_hash:
            return ProjectResult.model_validate(project)

        project_id = project.id
        project.status = IngestStatus.RUNNING
        project.error = None
        self.session.commit()  # persist RUNNING so a failed parse can be recorded against a live row

        try:
            graph = build_graph(bundle)
            column_edges, diagnostics = build_column_edges(graph)
            self._attach_ownership(project.source_ref, graph)
            self.persistence.persist(project_id, graph, column_edges, diagnostics)

            project.manifest_hash = bundle.manifest_hash
            project.status = IngestStatus.READY
            project.ingested_at = func.now()
            project.stats = self._build_stats(bundle, graph, diagnostics, len(column_edges))
            self.session.commit()
        except Exception as exc:  # noqa: BLE001 — record failure on the project, then re-raise
            logger.exception("Ingestion failed for project %s", project_id)
            self.session.rollback()  # clear the aborted transaction before writing the failure
            failed = self.projects.get(project_id)
            if failed is not None:
                failed.status = IngestStatus.FAILED
                failed.error = str(exc)
                self.session.commit()
            raise

        self.session.refresh(project)
        return ProjectResult.model_validate(project)

    @staticmethod
    def _attach_ownership(source_ref: str | None, graph: BuiltGraph) -> None:
        """Populate git-ownership fields on each node's spec (best-effort).

        No-op for upload-mode / non-git projects (compute returns ``{}``).
        """
        ownership = git_ownership.compute(source_ref)
        if not ownership:
            return
        for node in graph.nodes.values():
            info = ownership.get(node.file_path) if node.file_path else None
            if info is None:
                continue
            node.owner = info.owner
            node.owner_share = info.owner_share
            node.contributor_count = info.contributor_count
            node.last_author = info.last_author
            node.last_modified_at = info.last_modified_at

    @staticmethod
    def _build_stats(
        bundle: ArtifactBundle,
        graph: BuiltGraph,
        diagnostics: list[DiagnosticSpec],
        column_edge_count: int,
    ) -> dict[str, Any]:
        manifest = bundle.manifest
        raw_nodes = manifest.get("nodes", {})
        test_count = sum(1 for n in raw_nodes.values() if n.get("resource_type") in ("test", "unit_test"))

        counts_by_resource: dict[str, int] = {}
        counts_by_layer: dict[str, int] = {}
        for node in graph.nodes.values():
            counts_by_resource[node.resource_type.value] = counts_by_resource.get(node.resource_type.value, 0) + 1
            counts_by_layer[node.layer.value] = counts_by_layer.get(node.layer.value, 0) + 1

        cl = {status.value: 0 for status in ParseStatus}
        for diag in diagnostics:
            cl[diag.status.value] += 1
        cl["total_models"] = len(diagnostics)

        return {
            "dbt_version": bundle.dbt_version,
            "adapter": bundle.adapter,
            "counts": {**counts_by_resource, "test": test_count, "macro": len(manifest.get("macros", {}))},
            "by_layer": counts_by_layer,
            "column_lineage": cl,
            "node_edges": len(graph.edges),
            "column_edges": column_edge_count,
        }
