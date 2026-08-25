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
