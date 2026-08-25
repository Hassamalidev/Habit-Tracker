import uuid
from datetime import date, timedelta

import pytest

TODAY = date.today()


async def make_habit(client, **overrides):
    payload = {
        "name": "Gym",
        "color": "evergreen",
        "kind": "binary",
        "schedule_type": "daily",
    }
    payload.update(overrides)
    response = await client.post("/api/habits", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# -------------------------------------------------------------------------- auth


async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_register_returns_a_usable_token(auth):
    response = await auth["client"].get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == auth["email"]


async def test_duplicate_email_is_rejected(client, auth):
    response = await client.post(
        "/api/auth/register",
        json={
            "email": auth["email"].upper(),  # casing must not create a second account
            "password": "another-password",
            "display_name": "Impostor",
        },
    )
    assert response.status_code == 409


async def test_login_with_the_wrong_password_fails(client, auth):
    response = await client.post(
        "/api/auth/login", json={"email": auth["email"], "password": "nope"}
    )
    assert response.status_code == 401


async def test_unknown_email_and_wrong_password_look_identical(client, auth):
    missing = await client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "whatever"},
    )
    wrong = await client.post(
        "/api/auth/login", json={"email": auth["email"], "password": "whatever"}
    )
    assert missing.status_code == wrong.status_code == 401
    assert missing.json()["detail"] == wrong.json()["detail"]


async def test_endpoints_require_a_token(client):
    bare = client
    bare.headers.pop("Authorization", None)
    assert (await bare.get("/api/habits")).status_code == 401


async def test_a_short_password_is_refused(client):
    response = await client.post(
        "/api/auth/register",
        json={"email": "shorty@example.com", "password": "abc", "display_name": "S"},
    )
    assert response.status_code == 422


# ------------------------------------------------------------------------ habits


async def test_create_and_list_habits(auth):
    client = auth["client"]
    await make_habit(client, name="Prayer", kind="count", target_per_day=5)
    listed = (await client.get("/api/habits")).json()
    assert [h["name"] for h in listed] == ["Prayer"]
    assert listed[0]["target_per_day"] == 5


async def test_binary_habits_cannot_carry_a_target(auth):
    response = await auth["client"].post(
        "/api/habits",
        json={"name": "Read", "kind": "binary", "target_per_day": 4},
    )
    assert response.status_code == 422


async def test_a_weekday_schedule_needs_weekdays(auth):
    response = await auth["client"].post(
        "/api/habits",
        json={"name": "Gym", "schedule_type": "weekdays", "weekdays": []},
    )
    assert response.status_code == 422


async def test_archiving_hides_a_habit_without_losing_it(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Journal")

    assert (await client.delete(f"/api/habits/{habit['id']}")).status_code == 204
    assert (await client.get("/api/habits")).json() == []

    archived = (await client.get("/api/habits?include_archived=true")).json()
    assert [h["name"] for h in archived] == ["Journal"]


async def test_reorder_rewrites_positions(auth):
    client = auth["client"]
    first = await make_habit(client, name="A")
    second = await make_habit(client, name="B")

    response = await client.post(
        "/api/habits/reorder", json={"habit_ids": [second["id"], first["id"]]}
    )
    assert response.status_code == 200
    assert [h["name"] for h in response.json()] == ["B", "A"]


async def test_one_user_cannot_see_another_users_habits(client, auth):
    await make_habit(auth["client"], name="Private")

    intruder = await client.post(
        "/api/auth/register",
        json={
            "email": f"other-{uuid.uuid4().hex[:8]}@example.com",
            "password": "correct-horse-battery",
            "display_name": "Other",
        },
    )
    token = intruder.json()["access_token"]
    response = await client.get(
        "/api/habits", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.json() == []


async def test_a_habit_from_another_account_is_a_404_not_a_403(client, auth):
    habit = await make_habit(auth["client"], name="Mine")
    intruder = await client.post(
        "/api/auth/register",
        json={
            "email": f"other-{uuid.uuid4().hex[:8]}@example.com",
            "password": "correct-horse-battery",
            "display_name": "Other",
        },
    )
    token = intruder.json()["access_token"]
    response = await client.get(
        f"/api/habits/{habit['id']}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 404


# ----------------------------------------------------------------------- entries


async def test_ticking_a_day_shows_up_in_the_grid(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Gym")

    response = await client.put(
        "/api/entries",
        json={"habit_id": habit["id"], "day": TODAY.isoformat(), "value": 1},
    )
    assert response.status_code == 200

    grid = (await client.get(f"/api/entries/grid?month={TODAY:%Y-%m}")).json()
    row = next(r for r in grid["rows"] if r["habit"]["id"] == habit["id"])
    assert row["values"][TODAY.isoformat()] == 1
    assert row["streak"]["current"] == 1


async def test_clearing_a_cell_removes_the_row(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Gym")
    day = TODAY.isoformat()

    await client.put("/api/entries", json={"habit_id": habit["id"], "day": day, "value": 1})
    await client.put("/api/entries", json={"habit_id": habit["id"], "day": day, "value": 0})

    grid = (await client.get(f"/api/entries/grid?month={TODAY:%Y-%m}")).json()
    row = next(r for r in grid["rows"] if r["habit"]["id"] == habit["id"])
    assert day not in row["values"]


async def test_upsert_overwrites_rather_than_duplicating(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Water", kind="count", target_per_day=8)
    day = TODAY.isoformat()

    for value in (3, 6, 8):
        await client.put(
            "/api/entries",
            json={"habit_id": habit["id"], "day": day, "value": value},
        )

    entries = (
        await client.get(f"/api/entries?from={day}&to={day}&habit_id={habit['id']}")
    ).json()
    assert len(entries) == 1
    assert entries[0]["value"] == 8


async def test_bulk_write_fills_a_span_of_days(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Walk")
    span = [TODAY - timedelta(days=i) for i in range(5)]

    response = await client.post(
        "/api/entries/bulk",
        json={
            "entries": [
                {"habit_id": habit["id"], "day": d.isoformat(), "value": 1}
                for d in span
            ]
        },
    )
    assert response.status_code == 200
    assert len(response.json()["entries"]) == 5

    grid = (await client.get(f"/api/entries/grid?month={TODAY:%Y-%m}")).json()
    row = next(r for r in grid["rows"] if r["habit"]["id"] == habit["id"])
    assert row["streak"]["current"] == 5


async def test_a_note_survives_a_zero_value(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Meditate")
    day = TODAY.isoformat()

    await client.put(
        "/api/entries",
        json={
            "habit_id": habit["id"],
            "day": day,
            "value": 0,
            "note": "travelling today",
        },
    )
    grid = (await client.get(f"/api/entries/grid?month={TODAY:%Y-%m}")).json()
    row = next(r for r in grid["rows"] if r["habit"]["id"] == habit["id"])
    assert row["notes"][day] == "travelling today"


async def test_a_plain_tick_does_not_erase_an_existing_note(auth):
    """Toggling a cell must leave the note on it alone."""
    client = auth["client"]
    habit = await make_habit(client, name="Journal")
    day = TODAY.isoformat()

    await client.put(
        "/api/entries",
        json={"habit_id": habit["id"], "day": day, "value": 1, "note": "felt good"},
    )
    # A tick carries no note field at all.
    await client.put(
        "/api/entries", json={"habit_id": habit["id"], "day": day, "value": 0}
    )
    await client.put(
        "/api/entries", json={"habit_id": habit["id"], "day": day, "value": 1}
    )

    grid = (await client.get(f"/api/entries/grid?month={TODAY:%Y-%m}")).json()
    row = next(r for r in grid["rows"] if r["habit"]["id"] == habit["id"])
    assert row["notes"][day] == "felt good"


async def test_a_note_can_be_cleared_explicitly(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Journal")
    day = TODAY.isoformat()

    await client.put(
        "/api/entries",
        json={"habit_id": habit["id"], "day": day, "value": 1, "note": "temporary"},
    )
    await client.put(
        "/api/entries",
        json={"habit_id": habit["id"], "day": day, "value": 1, "note": None},
    )

    grid = (await client.get(f"/api/entries/grid?month={TODAY:%Y-%m}")).json()
    row = next(r for r in grid["rows"] if r["habit"]["id"] == habit["id"])
    assert day not in row["notes"]


async def test_writing_to_someone_elses_habit_is_refused(client, auth):
    habit = await make_habit(auth["client"], name="Mine")
    intruder = await client.post(
        "/api/auth/register",
        json={
            "email": f"other-{uuid.uuid4().hex[:8]}@example.com",
            "password": "correct-horse-battery",
            "display_name": "Other",
        },
    )
    token = intruder.json()["access_token"]
    response = await client.put(
        "/api/entries",
        json={"habit_id": habit["id"], "day": TODAY.isoformat(), "value": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


async def test_a_write_reports_the_new_streak(auth):
    """The tick response carries the streak, so the badge never lags behind."""
    client = auth["client"]
    habit = await make_habit(client, name="Walk")

    for offset in (2, 1, 0):
        response = await client.put(
            "/api/entries",
            json={
                "habit_id": habit["id"],
                "day": (TODAY - timedelta(days=offset)).isoformat(),
                "value": 1,
            },
        )
        assert response.status_code == 200

    body = response.json()
    assert body["streak"]["current"] == 3
    assert body["streak"]["unit"] == "day"
    assert body["entry"]["value"] == 1


async def test_clearing_a_cell_reports_the_shortened_streak(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Stretch")
    for offset in (1, 0):
        await client.put(
            "/api/entries",
            json={
                "habit_id": habit["id"],
                "day": (TODAY - timedelta(days=offset)).isoformat(),
                "value": 1,
            },
        )

    cleared = await client.put(
        "/api/entries",
        json={
            "habit_id": habit["id"],
            "day": (TODAY - timedelta(days=1)).isoformat(),
            "value": 0,
        },
    )
    assert cleared.json()["entry"] is None
    # Today still counts, yesterday no longer does.
    assert cleared.json()["streak"]["current"] == 1


async def test_bulk_reports_a_streak_per_habit(auth):
    client = auth["client"]
    one = await make_habit(client, name="One")
    two = await make_habit(client, name="Two")

    response = await client.post(
        "/api/entries/bulk",
        json={
            "entries": [
                {"habit_id": one["id"], "day": TODAY.isoformat(), "value": 1},
                {
                    "habit_id": two["id"],
                    "day": (TODAY - timedelta(days=1)).isoformat(),
                    "value": 1,
                },
            ]
        },
    )
    streaks = response.json()["streaks"]
    assert set(streaks) == {one["id"], two["id"]}
    assert streaks[one["id"]]["current"] == 1


async def test_a_bad_month_string_is_a_400(auth):
    response = await auth["client"].get("/api/entries/grid?month=August")
    assert response.status_code == 400


# --------------------------------------------------------------------- analytics


async def test_summary_reflects_what_was_ticked(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Gym")
    for i in range(7):
        day = (TODAY - timedelta(days=i)).isoformat()
        await client.put(
            "/api/entries", json={"habit_id": habit["id"], "day": day, "value": 1}
        )

    summary = (await client.get("/api/analytics/summary?days=7")).json()
    assert summary["completion_rate"] == pytest.approx(1.0)
    assert summary["expected_slots"] == 7
    assert summary["perfect_days"] == 7
    assert summary["best_streak"]["current_streak"] == 7


async def test_partial_counts_do_not_count_as_complete(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Prayer", kind="count", target_per_day=5)
    await client.put(
        "/api/entries",
        json={"habit_id": habit["id"], "day": TODAY.isoformat(), "value": 3},
    )

    summary = (await client.get("/api/analytics/summary?days=1")).json()
    stat = next(h for h in summary["habits"] if h["habit_id"] == habit["id"])
    assert stat["completed"] == 0
    assert stat["total_value"] == 3


async def test_heatmap_returns_one_row_per_day(auth):
    response = await auth["client"].get("/api/analytics/heatmap?days=30")
    assert response.status_code == 200
    assert len(response.json()["days"]) == 30


async def test_weekday_breakdown_has_seven_buckets(auth):
    response = await auth["client"].get("/api/analytics/weekday?days=30")
    assert [d["weekday"] for d in response.json()["weekdays"]] == list(range(7))


async def test_trend_returns_the_requested_number_of_weeks(auth):
    response = await auth["client"].get("/api/analytics/trend?weeks=8")
    assert len(response.json()["weeks"]) == 8


async def test_csv_export_contains_the_entries(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Gym")
    await client.put(
        "/api/entries",
        json={"habit_id": habit["id"], "day": TODAY.isoformat(), "value": 1},
    )

    response = await client.get("/api/analytics/export.csv")
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    body = response.text
    assert "date,habit,value" in body
    assert "Gym" in body


async def test_insights_are_generated_from_real_data(auth):
    client = auth["client"]
    habit = await make_habit(client, name="Gym")
    for i in range(10):
        await client.put(
            "/api/entries",
            json={
                "habit_id": habit["id"],
                "day": (TODAY - timedelta(days=i)).isoformat(),
                "value": 1,
            },
        )

    insights = (await client.get("/api/analytics/insights?days=14")).json()["insights"]
    assert any("Gym" in note["title"] for note in insights)
