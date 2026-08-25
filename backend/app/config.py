from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./habits.db"
    jwt_secret: str = "dev-only-secret-change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 24 * 14  # two weeks
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Optional. A regex matched against the Origin header, for hosts that hand out
    # a new URL per deploy: Vercel previews are `https://.*\.vercel\.app`.
    cors_origin_regex: str = ""
    app_name: str = "Habit Tracker API"

    @property
    def async_database_url(self) -> str:
        """Normalise whatever the host handed us into an async SQLAlchemy URL.

        Neon and Render both hand out plain libpq strings like
        `postgresql://...?sslmode=require`. psycopg speaks libpq, so the query
        string is passed through untouched and only the driver name is added.
        """
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        return url

    @property
    def is_postgres(self) -> bool:
        return "postgresql" in self.async_database_url

    @property
    def cors_origin_list(self) -> list[str]:
        """Allowed origins, normalised to the exact form a browser sends.

        An `Origin` header is only ever scheme + host + port — never a trailing
        slash, never quoted. Pasting a URL straight from the address bar gives
        you `https://example.com/`, which then silently matches nothing, so the
        usual copy-paste damage is stripped here rather than left to fail at
        request time.
        """
        cleaned: list[str] = []
        for raw in self.cors_origins.split(","):
            origin = raw.strip().strip("\"'").rstrip("/").strip()
            if origin:
                cleaned.append(origin)
        return cleaned


@lru_cache
def get_settings() -> Settings:
    return Settings()
