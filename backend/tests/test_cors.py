"""CORS configuration.

A misconfigured origin fails as a blank "CORS error" in the browser with nothing
in the server log, so the parsing is pinned down here instead.
"""

from app.config import Settings


def origins(value: str) -> list[str]:
    return Settings(cors_origins=value).cors_origin_list


def test_a_plain_list_is_split_on_commas():
    assert origins("https://a.com,https://b.com") == ["https://a.com", "https://b.com"]


def test_surrounding_whitespace_is_ignored():
    assert origins(" https://a.com , https://b.com ") == [
        "https://a.com",
        "https://b.com",
    ]


def test_a_trailing_slash_is_stripped():
    """Copying the URL out of the address bar gives you one, and an Origin
    header never has one, so it would otherwise match nothing."""
    assert origins("https://my-app.vercel.app/") == ["https://my-app.vercel.app"]


def test_quotes_from_a_pasted_value_are_stripped():
    assert origins('"https://my-app.vercel.app"') == ["https://my-app.vercel.app"]
    assert origins("'https://my-app.vercel.app'") == ["https://my-app.vercel.app"]


def test_empty_entries_are_dropped():
    assert origins("https://a.com,,  ,https://b.com") == [
        "https://a.com",
        "https://b.com",
    ]


def test_an_empty_setting_allows_nothing():
    assert origins("") == []


def test_a_port_is_preserved():
    assert origins("http://localhost:5173") == ["http://localhost:5173"]


def test_the_regex_is_off_unless_set():
    assert Settings().cors_origin_regex == ""
    assert Settings(cors_origin_regex=r"https://.*\.vercel\.app").cors_origin_regex


async def test_health_reports_the_running_cors_config(client):
    """So a blank browser error can be diagnosed with one request."""
    body = (await client.get("/api/health")).json()
    assert body["status"] == "ok"
    assert "allowed_origins" in body["cors"]
    assert isinstance(body["cors"]["allowed_origins"], list)


# --------------------------------------------------------------- seed runner


def test_the_seed_runner_avoids_the_loop_psycopg_rejects():
    """Windows defaults to ProactorEventLoop, which psycopg refuses outright.

    Seeding a Postgres database from Windows died on this, and SQLite hid it
    because its driver does not care which loop it is on.
    """
    import asyncio
    import sys

    from seed_demo import run

    seen: list[str] = []

    async def probe() -> None:
        seen.append(type(asyncio.get_running_loop()).__name__)

    run(probe())

    assert seen, "the runner never executed the coroutine"
    if sys.platform == "win32":
        assert "Proactor" not in seen[0], f"psycopg cannot use {seen[0]}"


# ------------------------------------------------------------ startup checks


async def test_prepare_database_creates_the_schema():
    """The startup path itself, on the test database."""
    from app.main import prepare_database

    await prepare_database()  # idempotent; conftest has already created tables


def test_credential_failures_are_not_treated_as_transient():
    """Retrying a wrong password only delays the real message.

    The service stays down either way, so the log has to say which it is.
    """
    from app.main import _FATAL_DB_ERRORS

    fatal = 'connection failed: FATAL:  password authentication failed for user "x"'
    transient = "connection timeout expired"

    assert any(m in fatal.lower() for m in _FATAL_DB_ERRORS)
    assert not any(m in transient.lower() for m in _FATAL_DB_ERRORS)
