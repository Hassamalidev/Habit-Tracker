import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

HabitKind = Literal["binary", "count"]
ScheduleType = Literal["daily", "weekdays", "weekly_count"]
ColorToken = Literal[
    "evergreen", "clay", "indigo", "plum", "ochre", "teal", "rose", "slate"
]


# --------------------------------------------------------------------------- auth


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)
    timezone: str = Field(default="UTC", max_length=64)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    timezone: str | None = Field(default=None, max_length=64)
    week_start: int | None = Field(default=None, ge=0, le=6)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    display_name: str
    timezone: str
    week_start: int
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ------------------------------------------------------------------------- habits


class HabitBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=280)
    emoji: str | None = Field(default=None, max_length=16)
    color: ColorToken = "evergreen"
    kind: HabitKind = "binary"
    target_per_day: int = Field(default=1, ge=1, le=1000)
    unit: str | None = Field(default=None, max_length=24)
    schedule_type: ScheduleType = "daily"
    weekdays: list[int] = Field(default_factory=list)
    weekly_target: int = Field(default=7, ge=1, le=7)
    start_date: date | None = None

    @field_validator("weekdays")
    @classmethod
    def _clean_weekdays(cls, v: list[int]) -> list[int]:
        bad = [d for d in v if d < 0 or d > 6]
        if bad:
            raise ValueError("weekdays must be integers 0 (Mon) through 6 (Sun)")
        return sorted(set(v))

    def _check_consistency(self) -> None:
        if self.schedule_type == "weekdays" and not self.weekdays:
            raise ValueError("a 'weekdays' schedule needs at least one weekday")
        if self.kind == "binary" and self.target_per_day != 1:
            raise ValueError("binary habits always have a target of 1")


class HabitCreate(HabitBase):
    def model_post_init(self, _context) -> None:
        self._check_consistency()


class HabitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=280)
    emoji: str | None = Field(default=None, max_length=16)
    color: ColorToken | None = None
    kind: HabitKind | None = None
    target_per_day: int | None = Field(default=None, ge=1, le=1000)
    unit: str | None = Field(default=None, max_length=24)
    schedule_type: ScheduleType | None = None
    weekdays: list[int] | None = None
    weekly_target: int | None = Field(default=None, ge=1, le=7)
    start_date: date | None = None
    archived: bool | None = None

    @field_validator("weekdays")
    @classmethod
    def _clean_weekdays(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return None
        bad = [d for d in v if d < 0 or d > 6]
        if bad:
            raise ValueError("weekdays must be integers 0 (Mon) through 6 (Sun)")
        return sorted(set(v))


class HabitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    emoji: str | None
    color: str
    kind: str
    target_per_day: int
    unit: str | None
    schedule_type: str
    weekdays: list[int]
    weekly_target: int
    position: int
    archived: bool
    start_date: date | None
    created_at: datetime


class ReorderRequest(BaseModel):
    habit_ids: list[uuid.UUID] = Field(min_length=1)


# ------------------------------------------------------------------------ entries


class EntryUpsert(BaseModel):
    habit_id: uuid.UUID
    day: date
    value: int = Field(ge=0, le=100000)
    note: str | None = Field(default=None, max_length=500)


class BulkEntryUpsert(BaseModel):
    entries: list[EntryUpsert] = Field(min_length=1, max_length=500)


class EntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    habit_id: uuid.UUID
    day: date
    value: int
    note: str | None
    updated_at: datetime


class StreakOut(BaseModel):
    current: int
    longest: int
    unit: Literal["day", "week"]


# --------------------------------------------------------------------- groups


class GroupCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    description: str | None = Field(default=None, max_length=280)
    emoji: str | None = Field(default=None, max_length=16)
    color: ColorToken = "evergreen"
    topic: str | None = Field(default=None, max_length=40)


class MemberOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    online: bool
    joined_at: datetime


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    topic: str
    description: str | None
    emoji: str | None
    color: str
    created_at: datetime


class GroupSummary(BaseModel):
    group: GroupOut
    member_count: int
    online_count: int
    is_member: bool
    unread: int
    last_message_at: datetime | None
    last_message_preview: str | None
    # Why this group was suggested: the habit of yours whose name it matches.
    matched_habit: str | None = None


class GroupDetail(BaseModel):
    group: GroupOut
    members: list[MemberOut]
    is_member: bool
    member_count: int


class DiscoverOut(BaseModel):
    suggested: list[GroupSummary]
    others: list[GroupSummary]


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ShareProgress(BaseModel):
    habit_id: uuid.UUID
    note: str | None = Field(default=None, max_length=280)


class MessageOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    user_id: uuid.UUID
    author: str
    body: str
    kind: str
    meta: dict | None
    created_at: datetime


class MessagePage(BaseModel):
    messages: list[MessageOut]
    has_more: bool


class EntryWriteOut(BaseModel):
    """What a single cell write gives back.

    The recalculated streak rides along with the entry so a tick can update the
    row badge immediately, instead of waiting for the grid to be refetched.
    """

    entry: EntryOut | None
    habit_id: uuid.UUID
    streak: StreakOut


class BulkWriteOut(BaseModel):
    entries: list[EntryOut]
    # habit id -> that habit's streak after the whole batch landed
    streaks: dict[str, StreakOut]


class HabitGridRow(BaseModel):
    habit: HabitOut
    # date-string -> value, only for days that have an entry
    values: dict[str, int]
    notes: dict[str, str]
    streak: StreakOut
    scheduled_days: int
    completed_days: int


class GridResponse(BaseModel):
    month: str
    days: list[date]
    today: date
    rows: list[HabitGridRow]
