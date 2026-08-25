"""Turns raw ticks into the numbers the dashboard draws.

The unit of account is a "slot": one completion the schedule asked for. Daily and
weekday habits ask for one slot on the days they fall on; an "N times a week"
habit spreads N slots across its week. Every rate in the app is
completed slots over expected slots, so a 5-prayers-a-day habit and a
3-gym-sessions-a-week habit can sit in the same average without distorting it.
"""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from ..models import Habit
from . import schedule as sched

WEEKDAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]


@dataclass
class Workspace:
    habits: list[Habit]
    values: dict[uuid.UUID, dict[date, int]]
    today: date
    week_start: int

    def spec(self, habit: Habit) -> sched.Spec:
        return sched.Spec.of(habit)

    def history(self, habit: Habit) -> dict[date, int]:
        return {
            d: v for d, v in self.values.get(habit.id, {}).items() if d <= self.today
        }


def day_weight(spec: sched.Spec, day: date) -> float:
    """How much of a day's obligation this habit represents.

    A 3x-a-week habit carries 3/7 of a slot on every day rather than a whole slot
    on three arbitrary ones, which is what lets it share an axis with daily habits.
    """
    if spec.start_date and day < spec.start_date:
        return 0.0
    if spec.schedule_type == "weekdays":
        return 1.0 if day.weekday() in spec.weekdays else 0.0
    if spec.schedule_type == "weekly_count":
        return spec.weekly_target / 7.0
    return 1.0


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def daily_series(ws: Workspace, start: date, end: date) -> list[dict]:
    """One row per day: how much was owed, how much was done, and the ratio."""
    out: list[dict] = []
    for day in sched.daterange(start, end):
        weight = credit = 0.0
        strict_total = strict_done = 0

        for habit in ws.habits:
            spec = ws.spec(habit)
            w = day_weight(spec, day)
            if w <= 0:
                continue
            weight += w
            value = ws.values.get(habit.id, {}).get(day, 0)
            satisfied = sched.is_satisfied(spec, value)
            if satisfied:
                credit += 1.0
            # "Perfect day" only judges habits that owe something on this
            # specific day; a weekly quota has no opinion about a Tuesday.
            if spec.schedule_type != "weekly_count":
                strict_total += 1
                strict_done += 1 if satisfied else 0

        out.append(
            {
                "day": day.isoformat(),
                "expected": round(weight, 3),
                "completed": round(credit, 3),
                "ratio": _clamp(credit / weight) if weight > 0 else 0.0,
                "perfect": strict_total > 0 and strict_done == strict_total,
                "future": day > ws.today,
            }
        )
    return out


def habit_stats(ws: Workspace, start: date, end: date) -> list[dict]:
    end = min(end, ws.today)
    rows: list[dict] = []
    for habit in ws.habits:
        spec = ws.spec(habit)
        history = ws.history(habit)
        floor = sched.floor_date(spec, history, ws.today)

        expected = sched.expected_slots(spec, start, end, ws.week_start)
        completed = sched.completed_slots(spec, history, start, end, ws.week_start)

        rows.append(
            {
                "habit_id": str(habit.id),
                "name": habit.name,
                "emoji": habit.emoji,
                "color": habit.color,
                "kind": habit.kind,
                "unit": habit.unit,
                "schedule_type": habit.schedule_type,
                "expected": expected,
                "completed": completed,
                "rate": _clamp(completed / expected) if expected else 0.0,
                "current_streak": sched.current_streak(
                    spec, history, ws.today, ws.week_start, floor
                ),
                "longest_streak": sched.longest_streak(
                    spec, history, ws.today, ws.week_start, floor
                ),
                "streak_unit": sched.streak_unit(spec),
                "total_value": sum(history.values()),
            }
        )
    return rows


def _range_rate(ws: Workspace, start: date, end: date) -> tuple[float, int, int]:
    expected = completed = 0
    for habit in ws.habits:
        spec = ws.spec(habit)
        expected += sched.expected_slots(spec, start, end, ws.week_start)
        completed += sched.completed_slots(
            spec, ws.history(habit), start, end, ws.week_start
        )
    rate = _clamp(completed / expected) if expected else 0.0
    return rate, completed, expected


def summary(ws: Workspace, start: date, end: date) -> dict:
    end = min(end, ws.today)
    rate, completed, expected = _range_rate(ws, start, end)
    stats = habit_stats(ws, start, end)

    # Momentum: the last seven days measured against the seven before them.
    recent_start = ws.today - timedelta(days=6)
    prior_end = recent_start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=6)
    recent_rate, _, _ = _range_rate(ws, recent_start, ws.today)
    prior_rate, _, _ = _range_rate(ws, prior_start, prior_end)

    series = daily_series(ws, start, end)
    perfect_days = sum(1 for d in series if d["perfect"])

    best = max(stats, key=lambda s: s["current_streak"], default=None)
    weakest = min(
        (s for s in stats if s["expected"] > 0), key=lambda s: s["rate"], default=None
    )

    return {
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "today": ws.today.isoformat(),
        "active_habits": len(ws.habits),
        "completion_rate": rate,
        "completed_slots": completed,
        "expected_slots": expected,
        "perfect_days": perfect_days,
        "days_tracked": len(series),
        "momentum": {
            "recent_rate": recent_rate,
            "prior_rate": prior_rate,
            "delta": recent_rate - prior_rate,
        },
        "best_streak": best,
        "weakest_habit": weakest,
        "habits": stats,
    }


def weekday_breakdown(ws: Workspace, start: date, end: date) -> list[dict]:
    end = min(end, ws.today)
    weight = [0.0] * 7
    credit = [0.0] * 7

    for day in sched.daterange(start, end):
        idx = day.weekday()
        for habit in ws.habits:
            spec = ws.spec(habit)
            w = day_weight(spec, day)
            if w <= 0:
                continue
            weight[idx] += w
            if sched.is_satisfied(spec, ws.values.get(habit.id, {}).get(day, 0)):
                credit[idx] += 1.0

    return [
        {
            "weekday": i,
            "label": WEEKDAY_NAMES[i],
            "short": WEEKDAY_NAMES[i][:3],
            "expected": round(weight[i], 2),
            "completed": round(credit[i], 2),
            "rate": _clamp(credit[i] / weight[i]) if weight[i] > 0 else 0.0,
        }
        for i in range(7)
    ]


def weekly_trend(ws: Workspace, weeks: int) -> list[dict]:
    this_week = sched.week_start_of(ws.today, ws.week_start)
    out: list[dict] = []

    for offset in range(weeks - 1, -1, -1):
        week_start = this_week - timedelta(days=7 * offset)
        week_end = min(week_start + timedelta(days=6), ws.today)
        rate, completed, expected = _range_rate(ws, week_start, week_end)
        out.append(
            {
                "week_start": week_start.isoformat(),
                "label": week_start.strftime("%d %b"),
                "rate": rate,
                "completed": completed,
                "expected": expected,
                "partial": week_start + timedelta(days=6) > ws.today,
            }
        )
    return out


def insights(ws: Workspace, start: date, end: date) -> list[dict]:
    """Short plain-language readings of the numbers above.

    Written on the server so the phrasing stays consistent wherever it is shown,
    and so the frontend never has to re-derive a statistic to describe it.
    """
    end = min(end, ws.today)
    notes: list[dict] = []
    if not ws.habits:
        return notes

    stats = habit_stats(ws, start, end)
    tracked = [s for s in stats if s["expected"] > 0]

    days = weekday_breakdown(ws, start, end)
    rated = [d for d in days if d["expected"] >= 1]
    if len(rated) >= 2:
        best_day = max(rated, key=lambda d: d["rate"])
        worst_day = min(rated, key=lambda d: d["rate"])
        if best_day["rate"] - worst_day["rate"] >= 0.15:
            notes.append(
                {
                    "tone": "neutral",
                    "title": f"{best_day['label']} is your strongest day",
                    "body": (
                        f"You finish {best_day['rate'] * 100:.0f}% of what you plan on "
                        f"{best_day['label']}s, against {worst_day['rate'] * 100:.0f}% "
                        f"on {worst_day['label']}s."
                    ),
                }
            )

    recent_start = ws.today - timedelta(days=6)
    prior_end = recent_start - timedelta(days=1)
    recent, _, _ = _range_rate(ws, recent_start, ws.today)
    prior, _, _ = _range_rate(ws, prior_end - timedelta(days=6), prior_end)
    delta = recent - prior
    if abs(delta) >= 0.1:
        rising = delta > 0
        notes.append(
            {
                "tone": "positive" if rising else "warning",
                "title": "Trending up" if rising else "Slipping",
                "body": (
                    f"This week you are at {recent * 100:.0f}%, "
                    f"{abs(delta) * 100:.0f} points "
                    f"{'above' if rising else 'below'} last week."
                ),
            }
        )

    on_a_run = [s for s in stats if s["current_streak"] >= 3]
    if on_a_run:
        top = max(on_a_run, key=lambda s: s["current_streak"])
        unit = top["streak_unit"] + ("s" if top["current_streak"] != 1 else "")
        notes.append(
            {
                "tone": "positive",
                "title": f"{top['current_streak']} {unit} on {top['name']}",
                "body": (
                    f"Your best run yet is {top['longest_streak']} "
                    f"{top['streak_unit']}s."
                    if top["current_streak"] < top["longest_streak"]
                    else "That is your longest run so far. Keep it going."
                ),
            }
        )

    if len(tracked) >= 2:
        weakest = min(tracked, key=lambda s: s["rate"])
        if weakest["rate"] < 0.5:
            missed = weakest["expected"] - weakest["completed"]
            notes.append(
                {
                    "tone": "warning",
                    "title": f"{weakest['name']} needs attention",
                    "body": (
                        f"{missed} missed out of {weakest['expected']} planned. "
                        "Shrinking the target often beats abandoning the habit."
                    ),
                }
            )

    series = daily_series(ws, start, end)
    perfect = sum(1 for d in series if d["perfect"])
    if perfect:
        notes.append(
            {
                "tone": "positive",
                "title": f"{perfect} perfect {'day' if perfect == 1 else 'days'}",
                "body": "Days where every habit scheduled for that date was ticked.",
            }
        )

    return notes
