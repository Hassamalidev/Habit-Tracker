import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .models import User
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHORISED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHORISED
    user_id: uuid.UUID | None = decode_access_token(credentials.credentials)
    if user_id is None:
        raise _UNAUTHORISED
    user = await session.get(User, user_id)
    if user is None:
        raise _UNAUTHORISED
    return user


def user_zone(user: User) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def user_today(user: User) -> date:
    """Today as the user experiences it, not as the server clock sees it."""
    return datetime.now(timezone.utc).astimezone(user_zone(user)).date()
