from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.project.models import Project


class ProjectRepository:
    def __init__(self, session: Session):
        self.session = session

    def get(self, project_id: str) -> Project | None:
        return self.session.get(Project, project_id)

    def create(self, project: Project) -> Project:
        self.session.add(project)
        self.session.flush()
        return project

    def list(self) -> list[Project]:
        return list(self.session.scalars(select(Project).order_by(Project.created_at.desc())))

    def delete(self, project: Project) -> None:
        self.session.delete(project)
        self.session.flush()
