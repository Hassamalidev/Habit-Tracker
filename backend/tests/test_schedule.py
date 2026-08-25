from datetime import date, timedelta

import pytest

from app.services import schedule as sched

MON = date(2026, 8, 3)  # a Monday, used as the anchor for every fixture below


def spec(**kw) -> sched.Spec:
    base = dict(
        kind="binary",
        target_per_day=1,
        schedule_type="daily",
        weekdays=(),
        weekly_target=7,
        start_date=None,
    )
    base.update(kw)
    return sched.Spec(**base)


def days(start: date, *offsets: int) -> dict[date, int]:
    return {start + timedelta(days=o): 1 for o in offsets}


# ------------------------------------------------------------------ satisfaction


def test_binary_habit_is_done_at_one():
    s = spec()
    assert not sched.is_satisfied(s, 0)
    assert sched.is_satisfied(s, 1)


def test_count_habit_needs_the_full_target():
    s = spec(kind="count", target_per_day=5)
    assert not sched.is_satisfied(s, 4)
    assert sched.is_satisfied(s, 5)
    assert sched.is_satisfied(s, 6)


def test_partial_count_shows_partial_progress():
    s = spec(kind="count", target_per_day=5)
    assert sched.progress(s, 3) == pytest.approx(0.6)
    assert sched.progress(s, 9) == 1.0


# --------------------------------------------------------------------- scheduling


def test_weekday_habit_is_only_owed_on_its_days():
    s = spec(schedule_type="weekdays", weekdays=(0, 2, 4))  # Mon, Wed, Fri
    assert sched.is_scheduled(s, MON)
    assert not sched.is_scheduled(s, MON + timedelta(days=1))
    assert sched.is_scheduled(s, MON + timedelta(days=2))


def test_nothing_is_owed_before_the_start_date():
    s = spec(start_date=MON)
    assert not sched.is_scheduled(s, MON - timedelta(days=1))
    assert sched.is_scheduled(s, MON)


# --------------------------------------------------------------------- expected


def test_daily_expects_every_day():
    assert sched.expected_slots(spec(), MON, MON + timedelta(days=6), 0) == 7


def test_weekday_schedule_expects_only_matching_days():
    s = spec(schedule_type="weekdays", weekdays=(0, 2, 4))
    assert sched.expected_slots(s, MON, MON + timedelta(days=6), 0) == 3


def test_weekly_count_expects_its_quota_per_week():
    s = spec(schedule_type="weekly_count", weekly_target=3)
    assert sched.expected_slots(s, MON, MON + timedelta(days=13), 0) == 6


def test_weekly_count_part_week_only_asks_for_the_days_it_covers():
    # Two days of a week can never be asked to hold a three-a-week quota.
    s = spec(schedule_type="weekly_count", weekly_target=3)
    assert sched.expected_slots(s, MON, MON + timedelta(days=1), 0) == 2


def test_expected_ignores_days_before_start():
    s = spec(start_date=MON + timedelta(days=3))
    assert sched.expected_slots(s, MON, MON + timedelta(days=6), 0) == 4


# -------------------------------------------------------------------- completed


def test_completed_counts_only_scheduled_days():
    s = spec(schedule_type="weekdays", weekdays=(0, 2, 4))
    values = days(MON, 0, 1, 2)  # Mon, Tue, Wed - Tuesday is not owed
    assert sched.completed_slots(s, values, MON, MON + timedelta(days=6), 0) == 2


def test_weekly_count_cannot_exceed_its_quota():
    # Five sessions against a three-a-week target is 100 percent, not 167.
    s = spec(schedule_type="weekly_count", weekly_target=3)
    values = days(MON, 0, 1, 2, 3, 4)
    assert sched.completed_slots(s, values, MON, MON + timedelta(days=6), 0) == 3


# ----------------------------------------------------------------------- streaks


def test_current_streak_counts_back_from_today():
    today = MON + timedelta(days=4)
    values = days(MON, 0, 1, 2, 3, 4)
    assert sched.current_streak(spec(), values, today, 0, MON) == 5


def test_a_gap_ends_the_streak():
    today = MON + timedelta(days=4)
    values = days(MON, 0, 1, 3, 4)  # missed day index 2
    assert sched.current_streak(spec(), values, today, 0, MON) == 2


def test_an_untouched_today_does_not_break_the_streak():
    # The day is not over yet, so it counts as pending rather than failed.
    today = MON + timedelta(days=4)
    values = days(MON, 0, 1, 2, 3)
    assert sched.current_streak(spec(), values, today, 0, MON) == 4


def test_an_untouched_yesterday_does_break_it():
    today = MON + timedelta(days=4)
    values = days(MON, 0, 1, 2)
    assert sched.current_streak(spec(), values, today, 0, MON) == 0


def test_off_days_are_skipped_not_counted_as_misses():
    # Mon/Wed/Fri habit: the weekend in between must not reset the run.
    s = spec(schedule_type="weekdays", weekdays=(0, 2, 4))
    today = MON + timedelta(days=7)  # the following Monday
    values = days(MON, 0, 2, 4, 7)
    assert sched.current_streak(s, values, today, 0, MON) == 4


def test_count_habit_streak_needs_the_target_each_day():
    s = spec(kind="count", target_per_day=5)
    today = MON + timedelta(days=3)
    values = {
        MON: 5,
        MON + timedelta(days=1): 5,
        MON + timedelta(days=2): 4,  # short of target
        MON + timedelta(days=3): 5,
    }
    assert sched.current_streak(s, values, today, 0, MON) == 1


def test_weekly_streak_is_measured_in_weeks():
    s = spec(schedule_type="weekly_count", weekly_target=3)
    today = MON + timedelta(days=20)
    values = days(MON, 0, 2, 4, 7, 9, 11, 14, 16, 18)  # three per week, three weeks
    assert sched.current_streak(s, values, today, 0, MON) == 3


def test_an_unfinished_current_week_does_not_break_a_weekly_streak():
    s = spec(schedule_type="weekly_count", weekly_target=3)
    today = MON + timedelta(days=15)  # Tuesday of week three
    values = days(MON, 0, 2, 4, 7, 9, 11, 14)  # only one session so far this week
    assert sched.current_streak(s, values, today, 0, MON) == 2


def test_longest_streak_finds_the_best_past_run():
    today = MON + timedelta(days=9)
    values = days(MON, 0, 1, 2, 3, 5, 9)  # a four-run, then a one, then today
    assert sched.longest_streak(spec(), values, today, 0, MON) == 4


def test_longest_never_falls_below_current():
    today = MON + timedelta(days=3)
    values = days(MON, 0, 1, 2, 3)
    s = spec()
    current = sched.current_streak(s, values, today, 0, MON)
    assert sched.longest_streak(s, values, today, 0, MON) >= current


def test_empty_history_has_no_streak():
    assert sched.current_streak(spec(), {}, MON, 0, MON) == 0
    assert sched.longest_streak(spec(), {}, MON, 0, MON) == 0


def test_week_start_setting_moves_the_week_boundary():
    sunday = date(2026, 8, 2)
    assert sched.week_start_of(sunday, 0) == date(2026, 7, 27)  # week starts Monday
    assert sched.week_start_of(sunday, 6) == sunday  # week starts Sunday
