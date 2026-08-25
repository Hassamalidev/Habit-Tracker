"""Schedule maths: which days a habit is owed on, and how long the run is.

Every analytic in the app funnels through these helpers, so a habit's definition
of "done" is decided in exactly one place.
"""

from dataclasses import dataclass
from datetime import date, timedelta

MAX_LOOKBACK_DAYS = 366 * 12


@dataclass(frozen=True)
class Spec:
    kind: str
    target_per_day: int
    schedule_type: str
    weekdays: tuple[int, ...]
    weekly_target: int
    start_date: date | None

    @classmethod
    def of(cls, habit) -> "Spec":
        return cls(
            kind=habit.kind,
            target_per_day=max(1, habit.target_per_day or 1),
            schedule_type=habit.schedule_type,
            weekdays=tuple(habit.weekdays or ()),
            weekly_target=max(1, min(7, habit.weekly_target or 7)),
            start_date=habit.start_date,
        )


def is_scheduled(spec: Spec, day: date) -> bool:
    """True when the habit is owed on `day`.

    A `weekly_count` habit is owed on no particular day, so every day is a valid
    opportunity; its quota is enforced per week instead, in `expected_slots`.
    """
    if spec.start_date and day < spec.start_date:
        return False
    if spec.schedule_type == "weekdays":
        return day.weekday() in spec.weekdays
    return True


def is_satisfied(spec: Spec, value: int) -> bool:
    if spec.kind == "count":
        return value >= spec.target_per_day
    return value >= 1


def progress(spec: Spec, value: int) -> float:
    """0.0 to 1.0 for one day, used for partial-credit shading in the grid."""
    if value <= 0:
        return 0.0
    if spec.kind == "count":
        return min(1.0, value / spec.target_per_day)
    return 1.0


def week_start_of(day: date, week_start: int) -> date:
    offset = (day.weekday() - week_start) % 7
    return day - timedelta(days=offset)


def daterange(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def _effective_start(spec: Spec, start: date) -> date:
    return max(start, spec.start_date) if spec.start_date else start


def expected_slots(spec: Spec, start: date, end: date, week_start: int) -> int:
    """How many completions the habit should have accumulated in [start, end].

    This is the denominator behind every completion percentage in the dashboard.
    """
    start = _effective_start(spec, start)
    if end < start:
        return 0

    if spec.schedule_type == "weekly_count":
        total = 0
        cursor = week_start_of(start, week_start)
        while cursor <= end:
            week_end = cursor + timedelta(days=6)
            days_in_range = (min(week_end, end) - max(cursor, start)).days + 1
            # A part-week at either edge can only ask for the days it covers.
            total += min(spec.weekly_target, max(0, days_in_range))
            cursor += timedelta(days=7)
        return total

    if spec.schedule_type == "weekdays":
        return sum(1 for d in daterange(start, end) if d.weekday() in spec.weekdays)

    return (end - start).days + 1


def completed_slots(
    spec: Spec, values: dict[date, int], start: date, end: date, week_start: int
) -> int:
    """Completions that count against the denominator above.

    For `weekly_count` habits the tally is capped at the weekly target, so an
    eight-run week against a 5x target reads as 100 percent, never 160.
    """
    start = _effective_start(spec, start)
    if end < start:
        return 0

    if spec.schedule_type == "weekly_count":
        per_week: dict[date, int] = {}
        for day, value in values.items():
            if start <= day <= end and is_satisfied(spec, value):
                key = week_start_of(day, week_start)
                per_week[key] = per_week.get(key, 0) + 1
        return sum(min(spec.weekly_target, n) for n in per_week.values())

    return sum(
        1
        for day, value in values.items()
        if start <= day <= end and is_scheduled(spec, day) and is_satisfied(spec, value)
    )


def _satisfied_days_in_week(
    spec: Spec, values: dict[date, int], week: date, cap: date
) -> int:
    total = 0
    for i in range(7):
        day = week + timedelta(days=i)
        if day > cap:
            break
        if is_satisfied(spec, values.get(day, 0)):
            total += 1
    return total


def current_streak(
    spec: Spec, values: dict[date, int], today: date, week_start: int, floor: date
) -> int:
    """Length of the run ending now.

    A scheduled day that has not happened yet never breaks a streak: an untouched
    today, or an in-progress week, counts as pending rather than failed.
    """
    if spec.schedule_type == "weekly_count":
        streak = 0
        week = week_start_of(today, week_start)
        floor_week = week_start_of(floor, week_start)
        first = True
        while week >= floor_week:
            done = _satisfied_days_in_week(spec, values, week, today)
            if done >= spec.weekly_target:
                streak += 1
            elif first:
                pass  # this week is still open, so skip it rather than end the run
            else:
                break
            first = False
            week -= timedelta(days=7)
        return streak

    day = today
    if is_scheduled(spec, day) and not is_satisfied(spec, values.get(day, 0)):
        day -= timedelta(days=1)

    streak = 0
    guard = 0
    while day >= floor and guard < MAX_LOOKBACK_DAYS:
        guard += 1
        if not is_scheduled(spec, day):
            day -= timedelta(days=1)
            continue
        if is_satisfied(spec, values.get(day, 0)):
            streak += 1
            day -= timedelta(days=1)
        else:
            break
    return streak


def longest_streak(
    spec: Spec, values: dict[date, int], today: date, week_start: int, floor: date
) -> int:
    if spec.schedule_type == "weekly_count":
        best = run = 0
        week = week_start_of(floor, week_start)
        this_week = week_start_of(today, week_start)
        while week <= this_week:
            done = _satisfied_days_in_week(spec, values, week, today)
            if done >= spec.weekly_target:
                run += 1
                best = max(best, run)
            elif week != this_week:
                run = 0
            week += timedelta(days=7)
        return best

    if not values:
        return 0

    best = run = 0
    for day in daterange(floor, today):
        if not is_scheduled(spec, day):
            continue
        if is_satisfied(spec, values.get(day, 0)):
            run += 1
            best = max(best, run)
        elif day != today:
            run = 0
    return best


def streak_unit(spec: Spec) -> str:
    return "week" if spec.schedule_type == "weekly_count" else "day"


def floor_date(spec: Spec, values: dict[date, int], today: date) -> date:
    """Earliest day worth scanning: the habit start, or its first ever entry."""
    candidates = [d for d in (spec.start_date,) if d]
    if values:
        candidates.append(min(values))
    if not candidates:
        return today - timedelta(days=MAX_LOOKBACK_DAYS)
    return min(candidates)
