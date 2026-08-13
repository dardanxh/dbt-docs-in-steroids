"""Domain package.

Importing this package eagerly imports every domain's models module so all
SQLAlchemy mappers are registered against ``Base.metadata`` before Alembic
autogenerates or routes resolve.
"""

from app.core.db import Base
from app.domain.lineage import models as lineage_models  # noqa: F401
from app.domain.project import models as project_models  # noqa: F401

__all__ = ["Base"]
