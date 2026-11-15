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


# ---- response models (OpenAPI) --------------------------------------------------

def test_compare_keeps_optional_keys_optional():
    # The response models must not add "ambiguous"/"not_found": null when the tools leave them out.
    c = _client()
    clean = c.get("/api/compare", params=[("names", "Haaland"), ("names", "Saka")]).json()
    assert set(clean) == {"gameweek", "players"}
    assert set(clean["players"][0]["recent_form"]) == {
        "avg_points_last5", "avg_minutes_last3", "avg_xgi_last5", "season_avg_points", "matches_played"}
    messy = c.get("/api/compare", params=[("names", "Haaland"), ("names", "Nobody Atall")]).json()
    assert messy["not_found"] == ["Nobody Atall"] and "ambiguous" not in messy


def test_predictions_rows_keep_their_shape():
    row = _client().get("/api/predictions").json()["players"][1]
    assert row == {"name": "Gabriel", "full_name": "Gabriel dos Santos", "team": "ARS", "position": "DEF",
                   "price": 6.0, "fixtures": "XXX (H)", "expected_points": 4.0,
                   "expected_points_adjusted": 4.0, "chance_of_playing": 100, "status": "available",
                   "news": None}                                # null news is kept, not dropped


def test_empty_model_card_stays_empty(monkeypatch):
    import scout_iq.api as api
    monkeypatch.setattr(api, "_model_card", lambda: {})
    up = _upcoming()
    s = TestClient(api.create_app(up, ScoutTools(up), None)).get("/api/status").json()
    assert s["model_card"] == {} and s["chat_available"] is False


def test_openapi_describes_every_response():
    paths = _client().get("/openapi.json").json()["paths"]
    for path, model in [("/api/status", "StatusResponse"), ("/api/predictions", "PredictionsResponse"),
                        ("/api/compare", "CompareResponse")]:
        schema = paths[path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        assert schema == {"$ref": f"#/components/schemas/{model}"}


def test_committed_openapi_schema_is_current():
    # The frontend's TypeScript types are generated from frontend/openapi.json. If this fails,
    # the API changed: run `npm run gen:api` in frontend/ and commit the result.
    import importlib.util
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("export_openapi", root / "scripts" / "export_openapi.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    committed = (root / "frontend" / "openapi.json").read_text(encoding="utf-8")
    assert committed == mod.as_text(mod.schema()), "frontend/openapi.json is stale: run `npm run gen:api`"


# ---- serving the built frontend --------------------------------------------------

def _frontend(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<div id=root>app</div>")
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("outside dist")
    up = _upcoming()
    return TestClient(create_app(up, ScoutTools(up), FakeAgent, frontend_dist=dist))


def test_frontend_files_and_client_side_routes(tmp_path):
    c = _frontend(tmp_path)
    for path in ("/", "/my-team", "/players/saka/history"):        # client-side routes -> index.html
        r = c.get(path)
        assert r.status_code == 200 and "app" in r.text and r.headers["cache-control"] == "no-cache"
    js = c.get("/assets/index-abc123.js")
    assert js.text == "console.log(1)" and "javascript" in js.headers["content-type"]
    assert "immutable" in js.headers["cache-control"]
    assert c.get("/favicon.svg").text == "<svg/>"
    assert c.head("/my-team").status_code == 200
    assert "outside dist" not in c.get("/../secret.txt").text
    assert "outside dist" not in c.get("/assets/%2e%2e/%2e%2e/secret.txt").text


def test_frontend_does_not_change_api_responses(tmp_path):
    c = _frontend(tmp_path)
    assert c.get("/api/nope").json() == {"detail": "Not Found"}        # unknown API path: JSON 404
    assert c.get("/api/nope").status_code == 404
    assert c.post("/api/nope").status_code == 404
    assert c.post("/my-team").status_code == 404                      # only GET/HEAD get the app
    assert c.get("/api/chat").status_code == 405                      # wrong method stays 405
    assert c.get("/api/status").json()["gameweek"] == 7
    assert c.get("/docs").status_code == 200 and "swagger" in c.get("/docs").text.lower()
    assert c.get("/openapi.json").json()["info"]["title"] == "scout-iq"
    assert c.get("/docs/nope").status_code == 404 and "app" not in c.get("/docs/nope").text


def test_frontend_not_built_explains_how_to_build(tmp_path):
    up = _upcoming()
    c = TestClient(create_app(up, ScoutTools(up), None, frontend_dist=tmp_path / "missing"))
    for path in ("/", "/my-team"):
        r = c.get(path)
        assert r.status_code == 200 and "npm run build" in r.text
    assert c.get("/api/status").status_code == 200
