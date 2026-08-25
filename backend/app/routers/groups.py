import re
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user, user_today
from ..models import Entry, Group, GroupMember, Habit, Message, User
from ..realtime import manager
from ..schemas import (
    DiscoverOut,
    GroupCreate,
    GroupDetail,
    GroupOut,
    GroupSummary,
    MemberOut,
    MessageCreate,
    MessageOut,
    MessagePage,
    ShareProgress,
)
from ..services import schedule as sched

router = APIRouter(prefix="/api/groups", tags=["groups"])

DISCOVER_LIMIT = 40
PAGE_SIZE = 50

# A light in-process guard against a runaway client. Real abuse control would
# live at the edge; this only stops one tab flooding the room.
_RATE_WINDOW = 60.0
_RATE_LIMIT = 25
_recent: dict[uuid.UUID, list[float]] = defaultdict(list)


def normalise_topic(text: str) -> str:
    """Reduce a name to the thing it is about, so habits and groups can match."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:70] or "group"


def topics_align(a: str, b: str) -> bool:
    """"Read" should find "Reading", but "run" must not match "running errands"."""
    if not a or not b:
        return False
    if a == b:
        return True
    if min(len(a), len(b)) < 3:
        return False
    return a.startswith(b) or b.startswith(a)


def _check_rate(user_id: uuid.UUID) -> None:
    now = time.monotonic()
    hits = [t for t in _recent[user_id] if now - t < _RATE_WINDOW]
    if len(hits) >= _RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You are sending messages too quickly. Give it a moment.",
        )
    hits.append(now)
    _recent[user_id] = hits


async def _load_group(group_id: uuid.UUID, session: AsyncSession) -> Group:
    group = await session.get(Group, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found."
        )
    return group


async def _membership(
    group_id: uuid.UUID, user: User, session: AsyncSession
) -> GroupMember | None:
    return await session.scalar(
        select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user.id
        )
    )


async def _require_membership(
    group_id: uuid.UUID, user: User, session: AsyncSession
) -> GroupMember:
    member = await _membership(group_id, user, session)
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Join the group to read or post in it.",
        )
    return member


async def _member_ids(group_id: uuid.UUID, session: AsyncSession) -> list[uuid.UUID]:
    return list(
        (
            await session.scalars(
                select(GroupMember.user_id).where(GroupMember.group_id == group_id)
            )
        ).all()
    )


async def _summarise(
    session: AsyncSession, user: User, groups: list[Group]
) -> list[GroupSummary]:
    """Everything the group cards need, in a fixed number of queries."""
    if not groups:
        return []
    ids = [g.id for g in groups]

    rows = (
        await session.execute(
            select(GroupMember.group_id, GroupMember.user_id).where(
                GroupMember.group_id.in_(ids)
            )
        )
    ).all()
    members: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for group_id, member_id in rows:
        members[group_id].append(member_id)

    mine = {
        m.group_id: m
        for m in (
            await session.scalars(
                select(GroupMember).where(
                    GroupMember.group_id.in_(ids), GroupMember.user_id == user.id
                )
            )
        ).all()
    }

    # The newest message per group, in one pass rather than a query per card.
    newest = (
        select(Message.group_id, func.max(Message.created_at).label("ts"))
        .where(Message.group_id.in_(ids))
        .group_by(Message.group_id)
        .subquery()
    )
    latest = {
        m.group_id: m
        for m in (
            await session.scalars(
                select(Message).join(
                    newest,
                    and_(
                        Message.group_id == newest.c.group_id,
                        Message.created_at == newest.c.ts,
                    ),
                )
            )
        ).all()
    }

    unread_rows = (
        await session.execute(
            select(Message.group_id, func.count())
            .join(
                GroupMember,
                and_(
                    GroupMember.group_id == Message.group_id,
                    GroupMember.user_id == user.id,
                ),
            )
            .where(
                Message.group_id.in_(ids),
                Message.created_at > GroupMember.last_read_at,
                Message.user_id != user.id,
            )
            .group_by(Message.group_id)
        )
    ).all()
    unread = {group_id: count for group_id, count in unread_rows}

    out: list[GroupSummary] = []
    for group in groups:
        people = members.get(group.id, [])
        last = latest.get(group.id)
        out.append(
            GroupSummary(
                group=GroupOut.model_validate(group),
                member_count=len(people),
                online_count=sum(1 for p in people if manager.is_online(p)),
                is_member=group.id in mine,
                unread=unread.get(group.id, 0) if group.id in mine else 0,
                last_message_at=last.created_at if last else None,
                last_message_preview=(last.body[:90] if last else None),
            )
        )
    return out


# ------------------------------------------------------------------- browsing


@router.get("", response_model=list[GroupSummary])
async def my_groups(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    groups = list(
        (
            await session.scalars(
                select(Group)
                .join(GroupMember, GroupMember.group_id == Group.id)
                .where(GroupMember.user_id == user.id)
                .order_by(Group.name)
            )
        ).all()
    )
    summaries = await _summarise(session, user, groups)
    # Rooms with something new float to the top, then the most recently active.
    summaries.sort(
        key=lambda s: (
            -s.unread,
            -(s.last_message_at.timestamp() if s.last_message_at else 0),
        )
    )
    return summaries


@router.get("/discover", response_model=DiscoverOut)
async def discover(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Groups matched to the habits you already track, then everything else."""
    habits = list(
        (
            await session.scalars(
                select(Habit).where(
                    Habit.user_id == user.id, Habit.archived.is_(False)
                )
            )
        ).all()
    )
    my_topics = {normalise_topic(h.name): h.name for h in habits}

    joined = set(
        (
            await session.scalars(
                select(GroupMember.group_id).where(GroupMember.user_id == user.id)
            )
        ).all()
    )

    groups = list(
        (
            await session.scalars(
                select(Group).order_by(Group.name).limit(DISCOVER_LIMIT)
            )
        ).all()
    )
    candidates = [g for g in groups if g.id not in joined]
    summaries = {s.group.id: s for s in await _summarise(session, user, candidates)}

    suggested: list[GroupSummary] = []
    others: list[GroupSummary] = []
    for group in candidates:
        summary = summaries[group.id]
        match = next(
            (
                name
                for topic, name in my_topics.items()
                if topics_align(topic, group.topic)
            ),
            None,
        )
        if match:
            summary.matched_habit = match
            suggested.append(summary)
        else:
            others.append(summary)

    suggested.sort(key=lambda s: -s.member_count)
    others.sort(key=lambda s: -s.member_count)
    return DiscoverOut(suggested=suggested, others=others)


@router.post("", response_model=GroupSummary, status_code=status.HTTP_201_CREATED)
async def create_group(
    payload: GroupCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    name = payload.name.strip()
    topic = normalise_topic(payload.topic or name)

    base = slugify(name)
    slug = base
    for attempt in range(1, 40):
        exists = await session.scalar(select(Group).where(Group.slug == slug))
        if exists is None:
            break
        slug = f"{base}-{attempt}"

    group = Group(
        name=name,
        slug=slug,
        topic=topic,
        description=(payload.description or "").strip() or None,
        emoji=payload.emoji,
        color=payload.color,
        created_by=user.id,
    )
    session.add(group)
    try:
        await session.flush()
        # Whoever makes a room is in it.
        session.add(GroupMember(group_id=group.id, user_id=user.id))
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A group with that name already exists.",
        )
    await session.refresh(group)
    return (await _summarise(session, user, [group]))[0]


@router.get("/{group_id}", response_model=GroupDetail)
async def group_detail(
    group_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    group = await _load_group(group_id, session)
    rows = (
        await session.execute(
            select(GroupMember, User)
            .join(User, User.id == GroupMember.user_id)
            .where(GroupMember.group_id == group_id)
            .order_by(GroupMember.joined_at)
        )
    ).all()

    members = [
        MemberOut(
            user_id=member.user_id,
            display_name=account.display_name,
            online=manager.is_online(member.user_id),
            joined_at=member.joined_at,
        )
        for member, account in rows
    ]
    return GroupDetail(
        group=GroupOut.model_validate(group),
        members=members,
        is_member=any(m.user_id == user.id for m in members),
        member_count=len(members),
    )


# ----------------------------------------------------------------- membership


@router.post("/{group_id}/join", response_model=GroupSummary)
async def join_group(
    group_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    group = await _load_group(group_id, session)
    if await _membership(group_id, user, session) is None:
        session.add(GroupMember(group_id=group_id, user_id=user.id))
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()  # two tabs joined at once; harmless

        await manager.broadcast_many(
            await _member_ids(group_id, session),
            {
                "type": "group.member",
                "group_id": str(group_id),
                "action": "joined",
                "display_name": user.display_name,
            },
        )
    return (await _summarise(session, user, [group]))[0]


@router.delete("/{group_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_group(
    group_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    member = await _membership(group_id, user, session)
    if member is not None:
        await session.delete(member)
        await session.commit()
        await manager.broadcast_many(
            await _member_ids(group_id, session),
            {
                "type": "group.member",
                "group_id": str(group_id),
                "action": "left",
                "display_name": user.display_name,
            },
        )


@router.post("/{group_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    group_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    member = await _require_membership(group_id, user, session)
    member.last_read_at = datetime.now(timezone.utc)
    await session.commit()


# ------------------------------------------------------------------- messages


def _to_out(message: Message, author: str) -> MessageOut:
    return MessageOut(
        id=message.id,
        group_id=message.group_id,
        user_id=message.user_id,
        author=author,
        body=message.body,
        kind=message.kind,
        meta=message.meta,
        created_at=message.created_at,
    )


@router.get("/{group_id}/messages", response_model=MessagePage)
async def list_messages(
    group_id: uuid.UUID,
    before: datetime | None = Query(default=None),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    await _require_membership(group_id, user, session)

    stmt = (
        select(Message, User)
        .join(User, User.id == Message.user_id)
        .where(Message.group_id == group_id)
    )
    if before is not None:
        stmt = stmt.where(Message.created_at < before)

    # Newest first for the page, then flipped so the client renders oldest-up.
    rows = (
        await session.execute(stmt.order_by(Message.created_at.desc()).limit(PAGE_SIZE + 1))
    ).all()

    has_more = len(rows) > PAGE_SIZE
    page = list(reversed(rows[:PAGE_SIZE]))
    return MessagePage(
        messages=[_to_out(m, account.display_name) for m, account in page],
        has_more=has_more,
    )


async def _publish(
    session: AsyncSession, group_id: uuid.UUID, message: Message, author: str
) -> MessageOut:
    out = _to_out(message, author)
    await manager.broadcast_many(
        await _member_ids(group_id, session),
        {"type": "group.message", "message": out.model_dump(mode="json")},
    )
    return out


@router.post(
    "/{group_id}/messages",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
)
async def post_message(
    group_id: uuid.UUID,
    payload: MessageCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    x_client_id: str | None = Header(default=None),
):
    member = await _require_membership(group_id, user, session)
    _check_rate(user.id)

    body = payload.body.strip()
    if not body:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Write something first.",
        )

    message = Message(group_id=group_id, user_id=user.id, body=body, kind="text")
    session.add(message)
    # Posting counts as reading, so your own message never shows up unread.
    member.last_read_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(message)

    return await _publish(session, group_id, message, user.display_name)


@router.post(
    "/{group_id}/share",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
)
async def share_progress(
    group_id: uuid.UUID,
    payload: ShareProgress,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Post one of your habits' current streaks into the room.

    The figures are recomputed here rather than taken from the client, so a
    shared streak is always a real one.
    """
    member = await _require_membership(group_id, user, session)
    _check_rate(user.id)

    habit = await session.scalar(
        select(Habit).where(Habit.id == payload.habit_id, Habit.user_id == user.id)
    )
    if habit is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found."
        )

    today = user_today(user)
    values = {
        row.day: row.value
        for row in (
            await session.scalars(
                select(Entry).where(Entry.habit_id == habit.id, Entry.day <= today)
            )
        ).all()
    }
    spec = sched.Spec.of(habit)
    floor = sched.floor_date(spec, values, today)
    current = sched.current_streak(spec, values, today, user.week_start, floor)
    longest = sched.longest_streak(spec, values, today, user.week_start, floor)
    unit = sched.streak_unit(spec)

    plural = "" if current == 1 else "s"
    body = f"{current} {unit}{plural} on {habit.name}"
    if payload.note:
        body = f"{body} — {payload.note.strip()}"

    message = Message(
        group_id=group_id,
        user_id=user.id,
        body=body,
        kind="progress",
        meta={
            "habit": habit.name,
            "emoji": habit.emoji,
            "color": habit.color,
            "current": current,
            "longest": longest,
            "unit": unit,
        },
    )
    session.add(message)
    member.last_read_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(message)

    return await _publish(session, group_id, message, user.display_name)
