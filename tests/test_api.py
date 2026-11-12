"""API tests with FastAPI's TestClient. Uses the fake data from test_agent.py; no network."""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scout_iq.api import create_app  # noqa: E402
from scout_iq.tools import ScoutTools  # noqa: E402
from test_agent import _upcoming  # noqa: E402


class FakeAgent:
    def __init__(self):
        self.trace, self.n = [], 0

    def ask(self, q):
        self.n += 1
        self.trace = [{"tool": "get_predictions", "args": {}}]
        return f"answer {self.n} to {q}"


def _client(chat=True):
    up = _upcoming()
    return TestClient(create_app(up, ScoutTools(up), FakeAgent if chat else None))


def test_status_and_index():
    c = _client()
    s = c.get("/api/status").json()
    assert s["gameweek"] == 7 and s["chat_available"] is True
    assert c.get("/").status_code == 200


def test_predictions_filters_and_validation():
    c = _client()
    names = [p["name"] for p in c.get("/api/predictions", params={"position": "DEF"}).json()["players"]]
    assert names == ["Gabriel"]
    assert c.get("/api/predictions", params={"top_n": 500}).status_code == 422   # rejected, not crashed


def test_compare():
    r = _client().get("/api/compare", params=[("names", "Haaland"), ("names", "Saka")]).json()
    assert [p["name"] for p in r["players"]] == ["Haaland", "Saka"]


def test_chat_keeps_session():
    c = _client()
    a = c.post("/api/chat", json={"message": "hi"}).json()
    b = c.post("/api/chat", json={"message": "again", "session_id": a["session_id"]}).json()
    assert b["session_id"] == a["session_id"]
    assert b["answer"] == "answer 2 to again"                # same agent -> remembers the conversation
    assert b["tools"] == [{"tool": "get_predictions", "args": {}}]


def test_chat_and_news_off_without_key():
    c = _client(chat=False)
    assert c.post("/api/chat", json={"message": "hi"}).status_code == 503
    assert c.get("/api/news", params={"q": "injury"}).status_code == 503
    assert c.post("/api/chat", json={"message": ""}).status_code == 422
