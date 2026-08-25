"""Populate a demo account with a few months of plausible history.

Run with:  python seed_demo.py
Then log in as demo@example.com / demo12345

The data is deliberately uneven - a strong prayer record, a gym habit that dips
mid-stretch, a reading habit that never quite took - so the dashboard has
something honest to show rather than a wall of green.
"""

import asyncio
import random
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from app.db import Base, SessionLocal, engine
from app.models import Entry, Group, GroupMember, Habit, Message, User
from app.security import hash_password

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo12345"
DAYS = 120

# name, emoji, colour, kind, target, unit, schedule, weekdays, weekly target, reliability
BLUEPRINT = [
    ("Prayer", "\U0001f54c", "evergreen", "count", 5, "prayers", "daily", [], 7, 0.88),
    ("Gym", "\U0001f3cb", "clay", "binary", 1, None, "weekdays", [0, 2, 4], 3, 0.72),
    ("Read", "\U0001f4d6", "indigo", "count", 20, "pages", "daily", [], 7, 0.45),
    ("Water", "\U0001f4a7", "teal", "count", 8, "glasses", "daily", [], 7, 0.66),
    ("Run", "\U0001f3c3", "ochre", "binary", 1, None, "weekly_count", [], 3, 0.6),
    ("Sleep by 11", "\U0001f319", "plum", "binary", 1, None, "daily", [], 7, 0.55),
]


def reliability_on(day: date, base: float, index: int) -> float:
    """Bend the base rate so the history has shape instead of uniform noise."""
    factor = base

    # Most people fade at the weekend.
    if day.weekday() >= 5:
        factor -= 0.12

    # A slow upward drift, so recent weeks look better than the oldest ones.
    age = (date.today() - day).days
    factor += (DAYS - age) / DAYS * 0.12

    # One rough fortnight, staggered per habit, to create a visible dip.
    slump_start = 40 + index * 6
    if slump_start <= age <= slump_start + 13:
        factor -= 0.3

    return max(0.03, min(0.97, factor))


# Sample companions, so the group rooms are not empty on a fresh install.
# These are fictional accounts created only by this script.
COMPANIONS = [
    ("ayesha@example.com", "Ayesha"),
    ("omar@example.com", "Omar"),
    ("zainab@example.com", "Zainab"),
]

# name, emoji, colour, blurb, whether the demo user is a member
ROOMS = [
    ("Gym", "🏋", "clay", "Lifting, running, whatever gets you moving.", True),
    ("Prayer", "🕌", "evergreen", "Keeping the five on time, together.", True),
    ("Reading", "📖", "indigo", "Pages a day beats a book a year.", False),
    ("Running", "🏃", "ochre", "Couch to 5k and everything after.", False),
    ("Hydration", "💧", "teal", "Drink the water. All of it.", False),
]

# (room, speaker index, minutes ago, text)
CHATTER = [
    ("Gym", 0, 2900, "Managed leg day before work. Barely."),
    ("Gym", 1, 2760, "Respect. I keep talking myself out of mornings."),
    ("Gym", 0, 2700, "Lay the kit out the night before, it removes the argument."),
    ("Gym", 2, 900, "Three weeks in and it finally feels normal."),
    ("Gym", 1, 240, "Anyone training this weekend?"),
    ("Prayer", 2, 4000, "Fajr is the one I keep missing. Any tips?"),
    ("Prayer", 0, 3800, "Earlier night, honestly. Nothing clever."),
    ("Prayer", 1, 180, "Full week on time. First time in ages."),
]


async def seed_groups(session, demo_user) -> None:
    """Rooms, sample companions and a little conversation."""
    await session.execute(delete(Message))
    await session.execute(delete(GroupMember))
    await session.execute(delete(Group))

    people = []
    for email, name in COMPANIONS:
        account = await session.scalar(
            select(User).where(func.lower(User.email) == email)
        )
        if account is None:
            account = User(
                email=email,
                password_hash=hash_password("demo12345"),
                display_name=name,
                timezone="Asia/Karachi",
            )
            session.add(account)
            await session.flush()
        people.append(account)

    rooms = {}
    for name, emoji, color, blurb, demo_joins in ROOMS:
        group = Group(
            name=name,
            slug=name.lower().replace(" ", "-"),
            topic=name.lower(),
            description=blurb,
            emoji=emoji,
            color=color,
            created_by=people[0].id,
        )
        session.add(group)
        await session.flush()
        rooms[name] = group

        for account in people:
            session.add(GroupMember(group_id=group.id, user_id=account.id))
        if demo_joins:
            session.add(
                GroupMember(
                    group_id=group.id,
                    user_id=demo_user.id,
                    # Backdated, so the unread badge has something to show.
                    last_read_at=datetime.now(timezone.utc) - timedelta(days=3),
                )
            )

    now = datetime.now(timezone.utc)
    for room, speaker, minutes_ago, text in CHATTER:
        session.add(
            Message(
                group_id=rooms[room].id,
                user_id=people[speaker].id,
                body=text,
                created_at=now - timedelta(minutes=minutes_ago),
            )
        )

    await session.commit()
    print(f"  {len(rooms)} groups, {len(CHATTER)} sample messages")


async def main() -> None:
    random.seed(7)  # same demo data every run

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as session:
        user = await session.scalar(
            select(User).where(func.lower(User.email) == DEMO_EMAIL)
        )
        if user is None:
            user = User(
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
                display_name="Demo",
                timezone="Asia/Karachi",
                week_start=0,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            print(f"created user {DEMO_EMAIL}")
        else:
            # Re-running the script should reset the demo, not stack onto it.
            await session.execute(delete(Entry).where(Entry.user_id == user.id))
            await session.execute(delete(Habit).where(Habit.user_id == user.id))
            await session.commit()
            print(f"reset existing user {DEMO_EMAIL}")

        today = date.today()
        start = today - timedelta(days=DAYS - 1)

        for position, row in enumerate(BLUEPRINT):
            (
                name,
                emoji,
                color,
                kind,
                target,
                unit,
                schedule,
                weekdays,
                weekly,
                base,
            ) = row

            habit = Habit(
                user_id=user.id,
                name=name,
                emoji=emoji,
                color=color,
                kind=kind,
                target_per_day=target,
                unit=unit,
                schedule_type=schedule,
                weekdays=weekdays,
                weekly_target=weekly,
                position=position,
                start_date=start,
            )
            session.add(habit)
            await session.flush()

            written = 0
            for offset in range(DAYS):
                day = start + timedelta(days=offset)

                if schedule == "weekdays" and day.weekday() not in weekdays:
                    continue

                chance = reliability_on(day, base, position)
                if random.random() > chance:
                    continue

                if kind == "count":
                    # Most successful days hit the target; some fall just short.
                    if random.random() < 0.78:
                        value = target + random.choice([0, 0, 0, 1])
                    else:
                        value = max(1, target - random.randint(1, max(1, target // 2)))
                else:
                    value = 1

                session.add(
                    Entry(habit_id=habit.id, user_id=user.id, day=day, value=value)
                )
                written += 1

            print(f"  {name:<12} {written:>3} entries")

        await session.commit()
        await seed_groups(session, user)

    await engine.dispose()
    print(f"\ndone - log in as {DEMO_EMAIL} / {DEMO_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
