from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    # Swagger UI / ReDoc / raw OpenAPI schema. On by default here (unlike worch)
    # because this is a local, single-user tool and the UI generates its API
    # types from /openapi.json.
    docs_enabled: bool = True

    database_url: str = "postgresql://postgres:postgres@localhost:5432/dbtsteroids"

    cors_allowed_origins: str = "http://localhost:5173"

    # Prefills the "register project" form in dev so you can ingest the local dbt
    # repo without typing the path. Optional — unset in SaaS/upload mode.
    default_dbt_project_path: str | None = None

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
