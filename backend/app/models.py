import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(80))
    # IANA name, e.g. "Asia/Karachi". Every "today" the server computes is
    # resolved in the user's own zone, not the server's.
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    # 0 = Monday .. 6 = Sunday, matching date.weekday().
    week_start: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    habits: Mapped[list["Habit"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )


class Habit(Base):
    __tablename__ = "habits"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(280), nullable=True)
    emoji: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # A token from the frontend palette ("evergreen", "clay", ...), not a raw hex,
    # so the theme can be restyled without migrating rows.
    color: Mapped[str] = mapped_column(String(24), default="evergreen")

    # "binary" -> done / not done.  "count" -> value counted against target_per_day.
    kind: Mapped[str] = mapped_column(String(16), default="binary")
    target_per_day: Mapped[int] = mapped_column(Integer, default=1)
    unit: Mapped[str | None] = mapped_column(String(24), nullable=True)

    # "daily"        -> every day counts
    # "weekdays"     -> only the weekdays listed in `weekdays`
    # "weekly_count" -> any N days per week, streaks measured in weeks
    schedule_type: Mapped[str] = mapped_column(String(16), default="daily")
    weekdays: Mapped[list[int]] = mapped_column(JSON, default=list)
    weekly_target: Mapped[int] = mapped_column(Integer, default=7)

    position: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    user: Mapped[User] = relationship(back_populates="habits")
    entries: Mapped[list["Entry"]] = relationship(
        back_populates="habit", cascade="all, delete-orphan"
    )


class Group(Base):
    """A room built around one shared habit, not a general chat channel.

    `topic` is the normalised form of the thing the group is about ("gym",
    "prayer"), which is what lets the app match a group to the habits someone is
    already tracking rather than making them go looking.
    """

    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(60))
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    topic: Mapped[str] = mapped_column(String(40), index=True)
    description: Mapped[str | None] = mapped_column(String(280), nullable=True)
    emoji: Mapped[str | None] = mapped_column(String(16), nullable=True)
    color: Mapped[str] = mapped_column(String(24), default="evergreen")

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    members: Mapped[list["GroupMember"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_member_group_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("groups.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Everything newer than this is unread, which is the whole unread badge.
    last_read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now
    )

    group: Mapped[Group] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_message_group_created", "group_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("groups.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    body: Mapped[str] = mapped_column(String(2000))
    # "text", or "progress" for a shared streak, which carries its figures in meta.
    kind: Mapped[str] = mapped_column(String(16), default="text")
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )

    group: Mapped[Group] = relationship(back_populates="messages")
    user: Mapped[User] = relationship()


class Entry(Base):
    __tablename__ = "entries"
    __table_args__ = (
        UniqueConstraint("habit_id", "day", name="uq_entry_habit_day"),
        Index("ix_entry_user_day", "user_id", "day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    habit_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("habits.id", ondelete="CASCADE"), index=True
    )
    # Denormalised so date-range queries and ownership checks never need a join.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    day: Mapped[date] = mapped_column(Date)
    value: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    habit: Mapped[Habit] = relationship(back_populates="entries")
