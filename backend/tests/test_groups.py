import uuid
from datetime import date, timedelta

TODAY = date.today()


async def second_user(client):
    """A separate account, returned as a ready-to-use auth header."""
    response = await client.post(
        "/api/auth/register",
        json={
            "email": f"mate-{uuid.uuid4().hex[:8]}@example.com",
            "password": "correct-horse-battery",
            "display_name": "Mate",
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def make_group(client, name="Gym", **extra):
    response = await client.post("/api/groups", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()["group"]


# ------------------------------------------------------------------ creation


async def test_creating_a_group_joins_you_to_it(auth):
    client = auth["client"]
    group = await make_group(client, "Gym Buddies")

    mine = (await client.get("/api/groups")).json()
    assert [g["group"]["id"] for g in mine] == [group["id"]]
    assert mine[0]["is_member"] is True
    assert mine[0]["member_count"] == 1


async def test_a_group_gets_a_slug_and_a_topic(auth):
    group = await make_group(auth["client"], "Early Risers")
    assert group["slug"] == "early-risers"
    assert group["topic"] == "early risers"


async def test_two_groups_of_the_same_name_get_distinct_slugs(auth):
    first = await make_group(auth["client"], "Reading")
    second = await make_group(auth["client"], "Reading")
    assert first["slug"] != second["slug"]


async def test_a_group_name_must_be_more_than_one_character(auth):
    response = await auth["client"].post("/api/groups", json={"name": "x"})
    assert response.status_code == 422


# ------------------------------------------------------------------ discovery


async def test_discover_suggests_groups_matching_your_habits(client, auth):
    """The whole point: rooms found by what you already track."""
    await auth["client"].post(
        "/api/habits", json={"name": "Gym", "kind": "binary", "schedule_type": "daily"}
    )

    # Someone else runs the room, so it is a real discovery rather than your own.
    other = await second_user(client)
    made = await client.post("/api/groups", json={"name": "Gym"}, headers=other)
    group_id = made.json()["group"]["id"]

    found = (await auth["client"].get("/api/groups/discover")).json()
    suggested = {g["group"]["id"]: g for g in found["suggested"]}
    assert group_id in suggested
    assert suggested[group_id]["matched_habit"] == "Gym"


async def test_a_near_miss_still_matches(client, auth):
    # "Read" the habit should find "Reading" the group.
    await auth["client"].post(
        "/api/habits", json={"name": "Read", "kind": "binary", "schedule_type": "daily"}
    )
    other = await second_user(client)
    made = await client.post("/api/groups", json={"name": "Reading"}, headers=other)

    found = (await auth["client"].get("/api/groups/discover")).json()
    assert made.json()["group"]["id"] in {g["group"]["id"] for g in found["suggested"]}


async def test_an_unrelated_group_is_not_suggested(client, auth):
    await auth["client"].post(
        "/api/habits", json={"name": "Gym", "kind": "binary", "schedule_type": "daily"}
    )
    other = await second_user(client)
    made = await client.post("/api/groups", json={"name": "Knitting"}, headers=other)

    found = (await auth["client"].get("/api/groups/discover")).json()
    ids = {g["group"]["id"] for g in found["suggested"]}
    assert made.json()["group"]["id"] not in ids
    assert made.json()["group"]["id"] in {g["group"]["id"] for g in found["others"]}


async def test_groups_you_are_in_are_not_offered_again(auth):
    group = await make_group(auth["client"], "Hydration")
    found = (await auth["client"].get("/api/groups/discover")).json()
    everything = {g["group"]["id"] for g in found["suggested"] + found["others"]}
    assert group["id"] not in everything


# ----------------------------------------------------------------- membership


async def test_a_non_member_cannot_read_the_room(client, auth):
    group = await make_group(auth["client"], "Private Talk")
    other = await second_user(client)

    response = await client.get(f"/api/groups/{group['id']}/messages", headers=other)
    assert response.status_code == 403


async def test_a_non_member_cannot_post(client, auth):
    group = await make_group(auth["client"], "Private Talk")
    other = await second_user(client)

    response = await client.post(
        f"/api/groups/{group['id']}/messages", json={"body": "hello"}, headers=other
    )
    assert response.status_code == 403


async def test_joining_then_leaving(client, auth):
    group = await make_group(auth["client"], "Runners")
    other = await second_user(client)

    joined = await client.post(f"/api/groups/{group['id']}/join", headers=other)
    assert joined.status_code == 200
    assert joined.json()["member_count"] == 2

    left = await client.delete(f"/api/groups/{group['id']}/leave", headers=other)
    assert left.status_code == 204

    detail = (await auth["client"].get(f"/api/groups/{group['id']}")).json()
    assert detail["member_count"] == 1


async def test_joining_twice_is_harmless(client, auth):
    group = await make_group(auth["client"], "Runners")
    other = await second_user(client)
    await client.post(f"/api/groups/{group['id']}/join", headers=other)
    again = await client.post(f"/api/groups/{group['id']}/join", headers=other)
    assert again.status_code == 200
    assert again.json()["member_count"] == 2


# ------------------------------------------------------------------- messages


async def test_posting_and_reading_back(client, auth):
    group = await make_group(auth["client"], "Chat")
    other = await second_user(client)
    await client.post(f"/api/groups/{group['id']}/join", headers=other)

    await auth["client"].post(
        f"/api/groups/{group['id']}/messages", json={"body": "morning all"}
    )
    await client.post(
        f"/api/groups/{group['id']}/messages", json={"body": "hello!"}, headers=other
    )

    page = (await auth["client"].get(f"/api/groups/{group['id']}/messages")).json()
    assert [m["body"] for m in page["messages"]] == ["morning all", "hello!"]
    assert page["messages"][1]["author"] == "Mate"
    assert page["has_more"] is False


async def test_an_empty_message_is_refused(auth):
    group = await make_group(auth["client"], "Chat")
    response = await auth["client"].post(
        f"/api/groups/{group['id']}/messages", json={"body": "   "}
    )
    assert response.status_code == 422


async def test_unread_counts_the_other_side_only(client, auth):
    group = await make_group(auth["client"], "Chat")
    other = await second_user(client)
    await client.post(f"/api/groups/{group['id']}/join", headers=other)

    await client.post(
        f"/api/groups/{group['id']}/messages", json={"body": "you around?"},
        headers=other,
    )

    mine = (await auth["client"].get("/api/groups")).json()
    assert mine[0]["unread"] == 1

    theirs = (await client.get("/api/groups", headers=other)).json()
    assert theirs[0]["unread"] == 0  # your own message is never unread to you


async def test_marking_read_clears_the_badge(client, auth):
    group = await make_group(auth["client"], "Chat")
    other = await second_user(client)
    await client.post(f"/api/groups/{group['id']}/join", headers=other)
    await client.post(
        f"/api/groups/{group['id']}/messages", json={"body": "ping"}, headers=other
    )

    assert (await auth["client"].get("/api/groups")).json()[0]["unread"] == 1
    assert (await auth["client"].post(f"/api/groups/{group['id']}/read")).status_code == 204
    assert (await auth["client"].get("/api/groups")).json()[0]["unread"] == 0


async def test_the_card_shows_the_latest_message(auth):
    client = auth["client"]
    group = await make_group(client, "Chat")
    await client.post(f"/api/groups/{group['id']}/messages", json={"body": "first"})
    await client.post(f"/api/groups/{group['id']}/messages", json={"body": "second"})

    card = (await client.get("/api/groups")).json()[0]
    assert card["last_message_preview"] == "second"


# ------------------------------------------------------------ shared progress


async def test_sharing_progress_posts_a_real_streak(auth):
    client = auth["client"]
    habit = (
        await client.post(
            "/api/habits",
            json={"name": "Gym", "kind": "binary", "schedule_type": "daily"},
        )
    ).json()
    for back in range(4):
        await client.put(
            "/api/entries",
            json={
                "habit_id": habit["id"],
                "day": (TODAY - timedelta(days=back)).isoformat(),
                "value": 1,
            },
        )

    group = await make_group(client, "Gym Talk")
    response = await client.post(
        f"/api/groups/{group['id']}/share",
        json={"habit_id": habit["id"], "note": "finally consistent"},
    )
    assert response.status_code == 201

    message = response.json()
    assert message["kind"] == "progress"
    assert message["meta"]["current"] == 4
    assert message["meta"]["habit"] == "Gym"
    assert "4 days on Gym" in message["body"]
    assert "finally consistent" in message["body"]


async def test_you_cannot_share_a_habit_that_is_not_yours(client, auth):
    group = await make_group(auth["client"], "Gym Talk")
    other = await second_user(client)
    await client.post(f"/api/groups/{group['id']}/join", headers=other)

    theirs = (
        await client.post(
            "/api/habits",
            json={"name": "Secret", "kind": "binary", "schedule_type": "daily"},
            headers=other,
        )
    ).json()

    response = await auth["client"].post(
        f"/api/groups/{group['id']}/share", json={"habit_id": theirs["id"]}
    )
    assert response.status_code == 404
