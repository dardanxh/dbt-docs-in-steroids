import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Import every domain so all SQLAlchemy mappers are registered before routes
# resolve. Use `from app import domain` (not `import app.domain`) so the name
# `app` stays free for the FastAPI instance below.
from app import domain  # noqa: F401
from app.core.exceptions import AppError
from app.domain.analytics.routes import router as analytics_router
from app.domain.lineage.routes import router as lineage_router
from app.domain.model_errors.routes import router as model_errors_router
from app.domain.project.routes import router as project_router
from app.settings import get_settings

logger = logging.getLogger(__name__)

_settings = get_settings()
_docs_kwargs: dict[str, Any] = (
    {} if _settings.docs_enabled else {"docs_url": None, "redoc_url": None, "openapi_url": None}
)

app = FastAPI(title="dbt-docs-in-steroids API", **_docs_kwargs)


@app.get("/health", tags=["health"], include_in_schema=False)
def health() -> dict[str, str]:
    return {"status": "ok"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

api_v1_prefix = "/api/v1"
app.include_router(project_router, prefix=api_v1_prefix)
app.include_router(lineage_router, prefix=api_v1_prefix)
app.include_router(analytics_router, prefix=api_v1_prefix)
app.include_router(model_errors_router, prefix=api_v1_prefix)


_STATUS_MAP = {"NOT_FOUND": 404, "BAD_REQUEST": 400, "CONFLICT": 409}


@app.exception_handler(AppError)
async def app_exception_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=_STATUS_MAP.get(exc.code, 400),
        content={"detail": exc.detail, "code": exc.code},
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred", "code": "INTERNAL_ERROR"},
    )
