from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    # Neon closes idle connections, and Render sleeps the whole service; a probe
    # before checkout turns a stale-socket crash into a transparent reconnect.
    pool_pre_ping=True,
    pool_recycle=280,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
