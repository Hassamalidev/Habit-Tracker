import asyncio
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError

from .config import get_settings
from .db import Base, SessionLocal, engine
from .models import User  # noqa: F401  (imported so metadata sees every table)
from .realtime import manager
from .routers import analytics, auth, entries, groups, habits
from .security import decode_access_token

settings = get_settings()


logger = logging.getLogger("habit-tracker")


# Credentials will never come right by waiting; anything else might.
_FATAL_DB_ERRORS = (
    "password authentication failed",
    "does not exist",
    "no pg_hba.conf entry",
    "role ",
)


async def prepare_database(attempts: int = 5) -> None:
    """Create the schema, retrying while the database is merely waking up.

    Neon suspends a free database after inactivity, so the first connection of
    the day can fail before the endpoint is ready. A wrong password, though, is
    never transient - retrying that just delays the real message by half a
    minute and leaves the service down either way.
    """
    delay = 1.0
    for attempt in range(1, attempts + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            return
        except OperationalError as exc:
            detail = str(exc.orig or exc).strip().splitlines()[0]
            fatal = any(marker in detail.lower() for marker in _FATAL_DB_ERRORS)

            if fatal:
                logger.error(
                    "Database refused the connection: %s\n"
                    "This is a credentials problem, not a temporary one - check "
                    "DATABASE_URL matches the connection string in your database "
                    "dashboard, password included.",
                    detail,
                )
                raise

            if attempt == attempts:
                logger.error(
                    "Database unreachable after %d attempts: %s", attempts, detail
                )
                raise

            logger.warning(
                "Database not ready (attempt %d/%d), retrying in %.0fs: %s",
                attempt,
                attempts,
                delay,
                detail,
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, 8.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The schema is small and additive, so it is created on boot rather than
    # through a migration tool. Swap in Alembic once columns start changing shape.
    await prepare_database()

    # A browser only ever reports "CORS error" with no detail, so the origins
    # this process will actually accept are printed once, into the deploy log.
    logger.warning(
        "CORS allows: %s%s",
        ", ".join(settings.cors_origin_list) or "(nothing configured)",
        f" | regex: {settings.cors_origin_regex}"
        if settings.cors_origin_regex
        else "",
    )
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="A habit tracker: a month grid, streaks that understand schedules, "
    "and a dashboard built on top of both.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # Hosts that mint a URL per deploy (Vercel previews) need a pattern rather
    # than a list; unset by default, so it costs nothing when unused.
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(habits.router)
app.include_router(entries.router)
app.include_router(analytics.router)
app.include_router(groups.router)


@app.get("/api/health", tags=["meta"])
async def health():
    """Liveness, plus the CORS config this process is actually running with.

    Allowed origins are not secret - any browser can discover them by asking -
    and having them one request away turns a blank "CORS error" into something
    you can diagnose without shell access to the host.
    """
    return {
        "status": "ok",
        "service": settings.app_name,
        "cors": {
            "allowed_origins": settings.cors_origin_list,
            "allowed_origin_regex": settings.cors_origin_regex or None,
        },
    }


@app.get("/", include_in_schema=False)
async def root():
    return {"service": settings.app_name, "docs": "/docs", "health": "/api/health"}


@app.websocket("/api/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    client_id: str = Query(default=""),
):
    """Live sync across a user's own devices.

    The token rides in the query string because the browser WebSocket API cannot
    attach an Authorization header. It is verified before the socket is accepted,
    so an unauthenticated connection is closed during the handshake.
    """
    user_id: uuid.UUID | None = decode_access_token(token)
    if user_id is None:
        await websocket.close(code=4401)
        return

    async with SessionLocal() as session:
        if await session.get(User, user_id) is None:
            await websocket.close(code=4401)
            return

    await manager.connect(user_id, websocket, client_id or str(uuid.uuid4()))
    try:
        await websocket.send_json(
            {"type": "connected", "devices": manager.connection_count(user_id)}
        )
        while True:
            # Nothing is expected from the client; the read keeps the socket open
            # and gives us a clean disconnect signal.
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong"})
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception:
        pass
    finally:
        await manager.disconnect(user_id, websocket)
