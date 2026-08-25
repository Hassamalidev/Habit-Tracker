from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings

settings = get_settings()

# Without a bound, an unreachable database hangs the TCP connect for minutes and
# a deploy looks stuck rather than broken. SQLite is a local file and takes no
# such argument.
connect_args = {"connect_timeout": 10} if settings.is_postgres else {}

engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    # Neon closes idle connections, and Render sleeps the whole service; a probe
    # before checkout turns a stale-socket crash into a transparent reconnect.
    pool_pre_ping=True,
    pool_recycle=280,
    connect_args=connect_args,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
