import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user
from ..models import Habit, User
from ..realtime import manager
from ..schemas import HabitCreate, HabitOut, HabitUpdate, ReorderRequest

router = APIRouter(prefix="/api/habits", tags=["habits"])


async def _load_habit(
    habit_id: uuid.UUID, user: User, session: AsyncSession
) -> Habit:
    habit = await session.scalar(
        select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id)
    )
    if habit is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found."
        )
    return habit


@router.get("", response_model=list[HabitOut])
async def list_habits(
    include_archived: bool = Query(default=False),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Habit).where(Habit.user_id == user.id)
    if not include_archived:
        stmt = stmt.where(Habit.archived.is_(False))
    stmt = stmt.order_by(Habit.position, Habit.created_at)
    habits = (await session.scalars(stmt)).all()
    return [HabitOut.model_validate(h) for h in habits]


@router.post("", response_model=HabitOut, status_code=status.HTTP_201_CREATED)
async def create_habit(
    payload: HabitCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None),
):
    highest = await session.scalar(
        select(func.max(Habit.position)).where(Habit.user_id == user.id)
    )
    habit = Habit(
        user_id=user.id,
        position=(highest or 0) + 1,
        **payload.model_dump(),
    )
    session.add(habit)
    await session.commit()
    await session.refresh(habit)

    out = HabitOut.model_validate(habit)
    await manager.broadcast(
        user.id,
        {"type": "habit.created", "habit": out.model_dump(mode="json")},
        exclude=x_client_id,
    )
    return out


@router.get("/{habit_id}", response_model=HabitOut)
async def get_habit(
    habit_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    return HabitOut.model_validate(await _load_habit(habit_id, user, session))


@router.patch("/{habit_id}", response_model=HabitOut)
async def update_habit(
    habit_id: uuid.UUID,
    payload: HabitUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None),
):
    habit = await _load_habit(habit_id, user, session)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(habit, field, value)

    if habit.kind == "binary":
        habit.target_per_day = 1
    if habit.schedule_type == "weekdays" and not habit.weekdays:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A weekday schedule needs at least one weekday.",
        )

    session.add(habit)
    await session.commit()
    await session.refresh(habit)

    out = HabitOut.model_validate(habit)
    await manager.broadcast(
        user.id,
        {"type": "habit.updated", "habit": out.model_dump(mode="json")},
        exclude=x_client_id,
    )
    return out


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_habit(
    habit_id: uuid.UUID,
    hard: bool = Query(
        default=False,
        description="Erase the habit and its history. Default is a reversible archive.",
    ),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None),
):
    habit = await _load_habit(habit_id, user, session)
    if hard:
        await session.delete(habit)
    else:
        habit.archived = True
        session.add(habit)
    await session.commit()

    await manager.broadcast(
        user.id,
        {
            "type": "habit.deleted" if hard else "habit.archived",
            "habit_id": str(habit_id),
        },
        exclude=x_client_id,
    )


@router.post("/reorder", response_model=list[HabitOut])
async def reorder_habits(
    payload: ReorderRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None),
):
    habits = (
        await session.scalars(select(Habit).where(Habit.user_id == user.id))
    ).all()
    by_id = {h.id: h for h in habits}

    unknown = [str(hid) for hid in payload.habit_ids if hid not in by_id]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown habit ids: {', '.join(unknown)}",
        )

    for index, habit_id in enumerate(payload.habit_ids):
        by_id[habit_id].position = index

    # Anything the client did not mention keeps its relative order behind the
    # explicitly ordered block.
    tail = [h for h in habits if h.id not in set(payload.habit_ids)]
    for offset, habit in enumerate(sorted(tail, key=lambda h: h.position)):
        habit.position = len(payload.habit_ids) + offset

    await session.commit()

    ordered = sorted(habits, key=lambda h: h.position)
    out = [HabitOut.model_validate(h) for h in ordered if not h.archived]
    await manager.broadcast(
        user.id,
        {"type": "habits.reordered", "habit_ids": [str(h.id) for h in ordered]},
        exclude=x_client_id,
    )
    return out
