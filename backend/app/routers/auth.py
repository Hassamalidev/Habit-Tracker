from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user
from ..models import User
from ..schemas import TokenOut, UserCreate, UserLogin, UserOut, UserUpdate
from ..security import (
    create_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, session: AsyncSession = Depends(get_session)):
    email = payload.email.lower().strip()

    existing = await session.scalar(
        select(User).where(func.lower(User.email) == email)
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists.",
        )

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        timezone=payload.timezone or "UTC",
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # Two registrations for the same address can race past the check above;
        # the unique index is the real arbiter.
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists.",
        )
    await session.refresh(user)

    return TokenOut(
        access_token=create_access_token(user.id), user=UserOut.model_validate(user)
    )


@router.post("/login", response_model=TokenOut)
async def login(payload: UserLogin, session: AsyncSession = Depends(get_session)):
    email = payload.email.lower().strip()
    user = await session.scalar(select(User).where(func.lower(User.email) == email))

    if user is None or not verify_password(payload.password, user.password_hash):
        # Same message either way, so the response cannot be used to enumerate
        # which addresses have accounts.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
        await session.commit()

    return TokenOut(
        access_token=create_access_token(user.id), user=UserOut.model_validate(user)
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
async def update_me(
    payload: UserUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if value is not None:
            setattr(user, field, value)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return UserOut.model_validate(user)
