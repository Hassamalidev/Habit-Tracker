import os
import tempfile
import uuid
from pathlib import Path

# Point the app at a throwaway SQLite file before anything imports the engine,
# which is built at module load from these settings.
_TMP_DB = Path(tempfile.gettempdir()) / f"habits-test-{uuid.uuid4().hex}.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP_DB.as_posix()}"
os.environ["JWT_SECRET"] = "test-secret"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
async def _schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()
    _TMP_DB.unlink(missing_ok=True)


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client):
    """A registered user plus a client that is already carrying their token."""
    email = f"user-{uuid.uuid4().hex[:10]}@example.com"
    response = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "correct-horse-battery",
            "display_name": "Test User",
            "timezone": "UTC",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    client.headers["Authorization"] = f"Bearer {body['access_token']}"
    return {"client": client, "user": body["user"], "email": email}
