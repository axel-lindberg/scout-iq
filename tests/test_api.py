"""API tests with FastAPI's TestClient. Uses the fake data from test_agent.py; no network."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scout_iq.api import create_app  # noqa: E402
from scout_iq.tools import ScoutTools  # noqa: E402
from test_agent import _upcoming  # noqa: E402


class FakeAgent:
    def __init__(self):
        self.trace, self.n = [], 0

    def ask(self, q, team=None):
        self.n += 1
        self.team = team
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


# ---- several gameweeks ahead ------------------------------------------------------

def _two_gameweeks():
    """GW 7 as in _upcoming(); in GW 8 Gabriel has a double and Haaland a blank."""
    up = _upcoming()
    p = up.predictions
    gw8 = {"Haaland": (0.0, ""), "Saka": (5.0, "CHE (H)"), "Gabriel": (9.0, "CHE (H), MCI (A)"),
           "Injured": (4.0, "ARS (A)")}
    rows = []
    for r in p.itertuples():
        rows.append((r.element, 7, r.xpts, r.xpts_adjusted, r.chance_of_playing, r.fixtures, 1))
        x, fx = gw8[r.web_name]
        adj = x * r.chance_of_playing / 100
        rows.append((r.element, 8, x, adj, r.chance_of_playing, fx, fx.count("(")))
    up.by_gw = pd.DataFrame(rows, columns=["element", "GW", "xpts", "xpts_adjusted", "chance_of_playing",
                                           "fixtures", "n_fixtures"])
    up.gameweeks = [7, 8]
    return TestClient(create_app(up, ScoutTools(up), FakeAgent))


def test_predictions_horizon():
    c = _two_gameweeks()
    assert c.get("/api/status").json()["horizon_gameweeks"] == [7, 8]
    default = c.get("/api/predictions").json()
    assert "gameweeks" not in default and "gameweeks" not in default["players"][0]   # unchanged shape
    r = c.get("/api/predictions", params={"horizon": 2}).json()
    assert r["gameweeks"] == [7, 8]
    assert [p["name"] for p in r["players"]] == ["Haaland", "Gabriel", "Saka"]     # still next-GW order
    haaland = r["players"][0]
    assert haaland["gameweeks"] == [
        {"gameweek": 7, "fixtures": "XXX (H)", "expected_points": 6.0, "expected_points_adjusted": 6.0},
        {"gameweek": 8, "fixtures": "", "expected_points": 0.0, "expected_points_adjusted": 0.0}]
    assert haaland["expected_points_horizon_adjusted"] == 6.0
    ranked = c.get("/api/predictions", params={"horizon": 2, "rank_by": "horizon"}).json()["players"]
    assert [p["name"] for p in ranked] == ["Gabriel", "Haaland", "Saka"]           # 13, 6, 5
    assert c.get("/api/predictions", params={"horizon": 9}).status_code == 422


def test_horizon_is_clamped_to_available_gameweeks():
    r = _client().get("/api/predictions", params={"horizon": 3}).json()            # only GW 7 known
    assert "gameweeks" not in r


# ---- my team -----------------------------------------------------------------------

def _team_client(fpl=None):
    import team_data
    from test_team import BUYS
    up, ids = team_data.upcoming(extra=BUYS)
    agents = []

    def factory():
        agents.append(FakeAgent())
        return agents[-1]
    return TestClient(create_app(up, ScoutTools(up), factory, fpl_client=fpl)), ids, agents


class FakeFpl:
    """The three public entry endpoints for team 77, whose picks are the synthetic squad."""

    def __init__(self, ids, fail=None):
        self.ids, self.fail = ids, fail

    def get(self, path):
        import urllib.error
        if self.fail:
            raise self.fail
        if path == "entry/77":
            return {"id": 77, "name": "Test FC", "summary_overall_rank": 1234, "current_event": 10, "started_event": 1}
        if path == "entry/77/history":
            return {"current": [{"event": g, "event_transfers": 0, "event_transfers_cost": 0} for g in range(1, 11)],
                    "chips": []}
        if path == "entry/77/event/10/picks":
            return {"active_chip": None, "entry_history": {"bank": 15, "value": 1000},
                    "picks": [{"element": e, "position": n + 1, "is_captain": n == 0, "is_vice_captain": n == 1}
                              for n, e in enumerate(self.ids)]}
        raise urllib.error.HTTPError(path, 404, "Not Found", {}, None)


def test_team_analyze_by_player_ids():
    c, ids, _ = _team_client()
    r = c.post("/api/team/analyze", json={"player_ids": ids, "bank": 0, "free_transfers": 1})
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["source"] == "manual" and a["entry"] is None and a["gameweeks"] == [11, 12]
    assert len(a["squad"]) == 15 and len(a["lineup"]["starters"]) == 11 and len(a["lineup"]["bench"]) == 4
    assert [s["id"] for s in a["squad"]] == a["lineup"]["starters"] + a["lineup"]["bench"]
    assert a["lineup"]["expected_points"] == 24.0 and a["squad_expected_points"] == [24.0, 24.0]
    best = a["transfers"][0]
    assert [p["name"] for p in best["out"]] == ["WeakMid"] and [p["name"] for p in best["in"]] == ["GoodMid"]
    assert best["gain_per_gameweek"] == [8.0, 8.0] and best["net_gain"] == 16.0 and best["hits"] == 0
    assert a["weakest"][0]["name"] == "WeakMid"
    assert any("Selling prices" in x for x in a["limitations"])


def test_team_analyze_validation_errors():
    c, ids, _ = _team_client()
    r = c.post("/api/team/analyze", json={"player_ids": ids[:14]})
    assert r.status_code == 422 and "15 players" in r.json()["detail"]
    assert c.post("/api/team/analyze", json={}).status_code == 422                       # neither
    assert c.post("/api/team/analyze", json={"team_id": 1, "player_ids": ids}).status_code == 422   # both
    assert c.post("/api/team/analyze", json={"player_ids": ids, "free_transfers": 9}).status_code == 422


def test_team_analyze_by_fpl_team_id_with_overrides():
    _, ids, _ = _team_client()
    c2 = TestClient(create_app(*_team_app(ids), None, fpl_client=FakeFpl(ids)))
    a = c2.post("/api/team/analyze", json={"team_id": 77}).json()
    assert a["source"] == "fpl" and a["entry"]["team_name"] == "Test FC" and a["entry"]["picks_gameweek"] == 10
    assert a["bank"] == 1.5 and a["free_transfers"] == 5 == a["entry"]["free_transfers"]   # saved up all season
    assert a["player_ids"] == ids
    b = c2.post("/api/team/analyze", json={"team_id": 77, "bank": 0.0, "free_transfers": 0}).json()
    assert b["bank"] == 0.0 and b["free_transfers"] == 0 and b["transfers"][0]["hits"] == 4   # overrides win


def _team_app(ids):
    import team_data
    from test_team import BUYS
    up, _ = team_data.upcoming(extra=BUYS)
    return up, ScoutTools(up)


def test_team_analyze_fpl_errors():
    _, ids, _ = _team_client()
    import urllib.error
    missing = TestClient(create_app(*_team_app(ids), None, fpl_client=FakeFpl(ids)))
    r = missing.post("/api/team/analyze", json={"team_id": 78})
    assert r.status_code == 404 and "doesn't exist" in r.json()["detail"]
    down = TestClient(create_app(*_team_app(ids), None, fpl_client=FakeFpl(ids, fail=urllib.error.URLError("x"))))
    r = down.post("/api/team/analyze", json={"team_id": 77})
    assert r.status_code == 502 and "by hand" in r.json()["detail"]


def test_players_list_for_manual_picking():
    c, ids, _ = _team_client()
    players = c.get("/api/players").json()["players"]
    assert {p["id"] for p in players} >= set(ids) and players[0]["name"] == "StarFwd"   # 20 pts over 2 GWs
    assert set(players[0]) == {"id", "name", "full_name", "team", "position", "price", "status",
                               "expected_points_horizon_adjusted"}


def test_chat_passes_the_team_to_the_agent():
    c, ids, agents = _team_client()
    team = {"player_ids": ids, "bank": 0.5, "free_transfers": 2, "team_name": "Test FC"}
    sid = c.post("/api/chat", json={"message": "who should I sell?", "team": team}).json()["session_id"]
    assert agents[0].team == team
    c.post("/api/chat", json={"message": "and now?", "session_id": sid})
    assert agents[0].team is None                                     # no team sent -> none
    assert c.post("/api/chat", json={"message": "x", "team": {**team, "player_ids": ids[:3]}}).status_code == 422
