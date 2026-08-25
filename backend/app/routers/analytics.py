import csv
import io
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user, user_today
from ..models import Entry, Habit, User
from ..services import analytics as an
from ..services import schedule as sched

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


async def build_workspace(
    session: AsyncSession,
    user: User,
    since: date,
    habit_id: uuid.UUID | None = None,
    include_archived: bool = False,
) -> an.Workspace:
    today = user_today(user)

    stmt = select(Habit).where(Habit.user_id == user.id)
    if not include_archived:
        stmt = stmt.where(Habit.archived.is_(False))
    if habit_id is not None:
        stmt = stmt.where(Habit.id == habit_id)
    habits = list(
        (await session.scalars(stmt.order_by(Habit.position, Habit.created_at))).all()
    )

    # Reach past the requested window so streak numbers are not truncated at the
    # edge of whatever range the chart happens to be showing.
    fetch_from = min(since, today - timedelta(days=sched.MAX_LOOKBACK_DAYS // 12))
    entry_stmt = select(Entry).where(
        Entry.user_id == user.id, Entry.day >= fetch_from, Entry.day <= today
    )
    if habit_id is not None:
        entry_stmt = entry_stmt.where(Entry.habit_id == habit_id)

    values: dict[uuid.UUID, dict[date, int]] = {}
    for entry in (await session.scalars(entry_stmt)).all():
        values.setdefault(entry.habit_id, {})[entry.day] = entry.value

    return an.Workspace(
        habits=habits, values=values, today=today, week_start=user.week_start
    )


@router.get("/summary")
async def summary(
    days: int = Query(default=30, ge=1, le=730),
    habit_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = user_today(user)
    start = today - timedelta(days=days - 1)
    ws = await build_workspace(session, user, start, habit_id)
    return an.summary(ws, start, today)


@router.get("/heatmap")
async def heatmap(
    days: int = Query(default=182, ge=7, le=730),
    habit_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Calendar-square data: one entry per day, already reduced to a 0-1 ratio."""
    today = user_today(user)
    start = today - timedelta(days=days - 1)
    ws = await build_workspace(session, user, start, habit_id)
    return {
        "from": start.isoformat(),
        "to": today.isoformat(),
        "week_start": user.week_start,
        "days": an.daily_series(ws, start, today),
    }


@router.get("/weekday")
async def weekday(
    days: int = Query(default=90, ge=7, le=730),
    habit_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = user_today(user)
    start = today - timedelta(days=days - 1)
    ws = await build_workspace(session, user, start, habit_id)
    return {"weekdays": an.weekday_breakdown(ws, start, today)}


@router.get("/trend")
async def trend(
    weeks: int = Query(default=12, ge=2, le=104),
    habit_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = user_today(user)
    start = today - timedelta(days=7 * weeks)
    ws = await build_workspace(session, user, start, habit_id)
    return {"weeks": an.weekly_trend(ws, weeks)}


@router.get("/insights")
async def insights(
    days: int = Query(default=30, ge=7, le=365),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    today = user_today(user)
    start = today - timedelta(days=days - 1)
    ws = await build_workspace(session, user, start)
    return {"insights": an.insights(ws, start, today)}


@router.get("/export.csv")
async def export_csv(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Every tick, as a spreadsheet. The data belongs to whoever entered it."""
    habits = list(
        (
            await session.scalars(
                select(Habit)
                .where(Habit.user_id == user.id)
                .order_by(Habit.position, Habit.created_at)
            )
        ).all()
    )
    names = {h.id: h for h in habits}

    entries = (
        await session.scalars(
            select(Entry).where(Entry.user_id == user.id).order_by(Entry.day)
        )
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["date", "habit", "value", "target", "kind", "unit", "completed", "note"]
    )
    for entry in entries:
        habit = names.get(entry.habit_id)
        if habit is None:
            continue
        spec = sched.Spec.of(habit)
        writer.writerow(
            [
                entry.day.isoformat(),
                habit.name,
                entry.value,
                habit.target_per_day,
                habit.kind,
                habit.unit or "",
                "yes" if sched.is_satisfied(spec, entry.value) else "no",
                entry.note or "",
            ]
        )

    buffer.seek(0)
    filename = f"habits-{user_today(user).isoformat()}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
