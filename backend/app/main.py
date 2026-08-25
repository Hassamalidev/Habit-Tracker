import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import Base, SessionLocal, engine
from .models import User  # noqa: F401  (imported so metadata sees every table)
from .realtime import manager
from .routers import analytics, auth, entries, groups, habits
from .security import decode_access_token

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The schema is small and additive, so it is created on boot rather than
    # through a migration tool. Swap in Alembic once columns start changing shape.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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
    return {"status": "ok", "service": settings.app_name}


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
