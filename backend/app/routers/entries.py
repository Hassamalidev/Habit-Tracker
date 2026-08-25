import calendar
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user, user_today
from ..models import Entry, Habit, User
from ..realtime import manager
from ..schemas import (
    BulkEntryUpsert,
    BulkWriteOut,
    EntryOut,
    EntryUpsert,
    EntryWriteOut,
    GridResponse,
    HabitGridRow,
    HabitOut,
    StreakOut,
)
from ..services import schedule as sched

router = APIRouter(prefix="/api/entries", tags=["entries"])

# How far back the grid reaches when rebuilding streaks. Long enough for any
# realistic run, short enough that one request never drags a whole history.
STREAK_WINDOW_DAYS = 420


def _parse_month(month: str | None, today: date) -> tuple[date, date]:
    if not month:
        first = today.replace(day=1)
    else:
        try:
            year_s, month_s = month.split("-")
            first = date(int(year_s), int(month_s), 1)
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="month must look like 2026-08",
            )
    last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
    return first, last


async def _entries_between(
    session: AsyncSession, user: User, start: date, end: date
) -> dict[uuid.UUID, dict[date, Entry]]:
    rows = (
        await session.scalars(
            select(Entry).where(
                Entry.user_id == user.id, Entry.day >= start, Entry.day <= end
            )
        )
    ).all()
    grouped: dict[uuid.UUID, dict[date, Entry]] = {}
    for row in rows:
        grouped.setdefault(row.habit_id, {})[row.day] = row
    return grouped


async def _streak_after_write(
    session: AsyncSession, user: User, habit: Habit, today: date
) -> StreakOut:
    """Recompute one habit's streak from its recent history.

    Scoped to the same window the grid uses, so the number a tick reports and the
    number the grid shows can never disagree.
    """
    rows = (
        await session.scalars(
            select(Entry).where(
                Entry.habit_id == habit.id,
                Entry.day <= today,
                Entry.day >= today - timedelta(days=STREAK_WINDOW_DAYS),
            )
        )
    ).all()
    values = {row.day: row.value for row in rows}

    spec = sched.Spec.of(habit)
    floor = sched.floor_date(spec, values, today)
    return StreakOut(
        current=sched.current_streak(spec, values, today, user.week_start, floor),
        longest=sched.longest_streak(spec, values, today, user.week_start, floor),
        unit=sched.streak_unit(spec),
    )


@router.get("/grid", response_model=GridResponse)
async def month_grid(
    month: str | None = Query(default=None, description="YYYY-MM, defaults to now"),
    include_archived: bool = Query(default=False),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """The whole month view in one round trip: habits, ticks, notes and streaks."""
    today = user_today(user)
    first, last = _parse_month(month, today)

    stmt = select(Habit).where(Habit.user_id == user.id)
    if not include_archived:
        stmt = stmt.where(Habit.archived.is_(False))
    habits = (
        await session.scalars(stmt.order_by(Habit.position, Habit.created_at))
    ).all()

    # One query covers both jobs: painting this month, and walking far enough
    # back to know how long each streak is.
    fetch_start = min(first, today - timedelta(days=STREAK_WINDOW_DAYS))
    fetch_end = max(last, today)
    grouped = await _entries_between(session, user, fetch_start, fetch_end)

    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    rows: list[HabitGridRow] = []

    for habit in habits:
        entries = grouped.get(habit.id, {})
        values = {d: e.value for d, e in entries.items()}
        spec = sched.Spec.of(habit)

        history = {d: v for d, v in values.items() if d <= today}
        floor = sched.floor_date(spec, history, today)

        # A month still in progress is judged only on the days that have happened.
        window_end = min(last, today)
        expected = sched.expected_slots(spec, first, window_end, user.week_start)
        done = sched.completed_slots(spec, history, first, window_end, user.week_start)

        rows.append(
            HabitGridRow(
                habit=HabitOut.model_validate(habit),
                values={
                    d.isoformat(): v for d, v in values.items() if first <= d <= last
                },
                notes={
                    d.isoformat(): e.note
                    for d, e in entries.items()
                    if e.note and first <= d <= last
                },
                streak=StreakOut(
                    current=sched.current_streak(
                        spec, history, today, user.week_start, floor
                    ),
                    longest=sched.longest_streak(
                        spec, history, today, user.week_start, floor
                    ),
                    unit=sched.streak_unit(spec),
                ),
                scheduled_days=expected,
                completed_days=done,
            )
        )

    return GridResponse(
        month=first.strftime("%Y-%m"), days=days, today=today, rows=rows
    )


async def _upsert_one(
    session: AsyncSession, user: User, payload: EntryUpsert
) -> Entry | None:
    """Write one cell. Returns None when the cell was cleared away."""
    habit = await session.scalar(
        select(Habit).where(Habit.id == payload.habit_id, Habit.user_id == user.id)
    )
    if habit is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found."
        )

    entry = await session.scalar(
        select(Entry).where(
            Entry.habit_id == payload.habit_id, Entry.day == payload.day
        )
    )

    # A plain tick omits `note` entirely, and that must not erase one already
    # written. Only a request that actually carries the field may change it.
    if "note" in payload.model_fields_set:
        note = payload.note
    else:
        note = entry.note if entry is not None else None

    # An empty cell is stored as the absence of a row, so the table stays sparse
    # and a year of untouched days costs nothing.
    if payload.value <= 0 and not note:
        if entry is not None:
            await session.delete(entry)
        return None

    if entry is None:
        entry = Entry(
            habit_id=payload.habit_id,
            user_id=user.id,
            day=payload.day,
            value=payload.value,
            note=note,
        )
        session.add(entry)
    else:
        entry.value = payload.value
        entry.note = note
    return entry


@router.put("", response_model=EntryWriteOut)
async def upsert_entry(
    payload: EntryUpsert,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None),
):
    entry = await _upsert_one(session, user, payload)
    try:
        await session.commit()
    except IntegrityError:
        # Two devices ticking the same cell at once: the unique index rejects the
        # loser, so re-read and apply the value on top of the winner's row.
        await session.rollback()
        entry = await session.scalar(
            select(Entry).where(
                Entry.habit_id == payload.habit_id, Entry.day == payload.day
            )
        )
        if entry is not None:
            entry.value = payload.value
            entry.note = payload.note
            await session.commit()

    out = None
    if entry is not None:
        await session.refresh(entry)
        out = EntryOut.model_validate(entry)

    habit = await session.get(Habit, payload.habit_id)
    streak = await _streak_after_write(session, user, habit, user_today(user))

    await manager.broadcast(
        user.id,
        {
            "type": "entry.updated",
            "habit_id": str(payload.habit_id),
            "day": payload.day.isoformat(),
            "value": payload.value,
            "note": payload.note,
        },
        exclude=x_client_id,
    )
    return EntryWriteOut(entry=out, habit_id=payload.habit_id, streak=streak)


@router.post("/bulk", response_model=BulkWriteOut)
async def bulk_upsert(
    payload: BulkEntryUpsert,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None),
):
    """Backs drag-to-fill across a row and the undo of that same drag."""
    written: list[Entry] = []
    for item in payload.entries:
        entry = await _upsert_one(session, user, item)
        if entry is not None:
            written.append(entry)
    await session.commit()

    for entry in written:
        await session.refresh(entry)

    today = user_today(user)
    streaks: dict[str, StreakOut] = {}
    for habit_id in {item.habit_id for item in payload.entries}:
        habit = await session.get(Habit, habit_id)
        if habit is not None:
            streaks[str(habit_id)] = await _streak_after_write(
                session, user, habit, today
            )

    await manager.broadcast(
        user.id,
        {
            "type": "entries.bulk",
            "entries": [
                {
                    "habit_id": str(i.habit_id),
                    "day": i.day.isoformat(),
                    "value": i.value,
                    "note": i.note,
                }
                for i in payload.entries
            ],
        },
        exclude=x_client_id,
    )
    return BulkWriteOut(
        entries=[EntryOut.model_validate(e) for e in written], streaks=streaks
    )


@router.get("", response_model=list[EntryOut])
async def list_entries(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    habit_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Entry).where(
        Entry.user_id == user.id, Entry.day >= date_from, Entry.day <= date_to
    )
    if habit_id is not None:
        stmt = stmt.where(Entry.habit_id == habit_id)
    rows = (await session.scalars(stmt.order_by(Entry.day))).all()
    return [EntryOut.model_validate(r) for r in rows]


@router.delete("/{habit_id}/{day}", status_code=status.HTTP_204_NO_CONTENT)
async def clear_entry(
    habit_id: uuid.UUID,
    day: date,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None),
):
    await session.execute(
        sql_delete(Entry).where(
            Entry.user_id == user.id, Entry.habit_id == habit_id, Entry.day == day
        )
    )
    await session.commit()
    await manager.broadcast(
        user.id,
        {
            "type": "entry.updated",
            "habit_id": str(habit_id),
            "day": day.isoformat(),
            "value": 0,
            "note": None,
        },
        exclude=x_client_id,
    )
