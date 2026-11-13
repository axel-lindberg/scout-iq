"""FPL API -> vaastav format. Uses small real API responses saved in tests/fixtures/; no network.

The sample: 5 players (Raya GK Arsenal, Thomas-Asante FWD Coventry, Manzambi MID Aston Villa
with injury news, plus a Brighton and a Hull defender so every finished fixture has both
sides; their histories are trimmed to those fixtures), gameweeks 1-4. GW 1-2 are finished, GW 3 is in progress with one fixture
(id 26, Thomas-Asante played) already finished, GW 4 is next.
"""

from __future__ import annotations

import copy
import io
import json
import sys
import urllib.error
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scout_iq import data, fpl_api, upcoming  # noqa: E402
from scout_iq.news import news_documents  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SEASON = "2026-27"


class FakeClient:
    """Serves the saved JSON and records which endpoints were requested."""

    def __init__(self):
        self.files = {"bootstrap-static": json.loads((FIXTURES / "bootstrap-static.json").read_text()),
                      "fixtures": json.loads((FIXTURES / "fixtures.json").read_text())}
        for p in FIXTURES.glob("element-summary-*.json"):
            self.files[f"element-summary/{p.stem.split('-')[-1]}"] = json.loads(p.read_text())
        self.paths: list[str] = []

    def get(self, path: str):
        self.paths.append(path)
        return copy.deepcopy(self.files[path])


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    raw, cache = tmp_path / "raw", tmp_path / "cache"
    monkeypatch.setattr(data, "RAW_DIR", raw)
    monkeypatch.setattr(upcoming, "RAW_DIR", raw)
    return raw, cache


def _write(dirs, client=None, **kw):
    raw, cache = dirs
    client = client or FakeClient()
    return fpl_api.write_season(client, raw_dir=raw, cache_dir=cache, workers=1, **kw), client


def test_season_string_from_first_deadline():
    boot = FakeClient().files["bootstrap-static"]
    assert fpl_api.season_name(boot) == "2026-27"
    boot["events"][0]["deadline_time"] = "2031-08-15T17:30:00Z"
    assert fpl_api.season_name(boot) == "2031-32"
    assert fpl_api.season_for_date(pd.Timestamp("2027-05-20")) == "2026-27"
    assert fpl_api.season_for_date(pd.Timestamp("2027-08-01")) == "2027-28"


def test_writes_vaastav_files_and_columns(dirs):
    res, _ = _write(dirs)
    out = dirs[0] / SEASON
    assert res.season == SEASON and res.latest_finished_gw == 2 and res.next_gw == 4
    assert sorted(p.name for p in out.iterdir()) == ["fixtures.csv", "merged_gw.csv", "players_raw.csv", "teams.csv"]

    m = pd.read_csv(out / "merged_gw.csv")
    assert list(m.columns[:len(fpl_api.MERGED_COLUMNS)]) == fpl_api.MERGED_COLUMNS
    assert set(data.NUMERIC_COLS) <= set(m.columns)
    assert m["xP"].isna().all()
    raya = m[m.element == 1].iloc[0]
    assert raya["name"] == "David Raya Martín" and raya["position"] == "GK" and raya["team"] == "Arsenal"
    assert raya["GW"] == raya["round"] == 1 and raya["total_points"] == 6
    assert raya["expected_goals_conceded"] == pytest.approx(0.20)   # string "0.20" in the API
    assert m.loc[m.element == 194, "team"].eq("Coventry City").all()
    assert m.loc[m.element == 194, "position"].eq("FWD").all()

    # The rest of the pipeline reads these files unchanged.
    df = data.load_season(SEASON)
    assert df.loc[df.element == 1, "team_name"].eq("Arsenal").all()
    assert df["value"].between(3.5, 16).all()               # tenths converted to £m
    players = upcoming._load_players(SEASON)
    docs = news_documents(players)
    assert docs["web_name"].tolist() == ["Manzambi"] and "75%" in docs["text"].iloc[0]
    fixtures = pd.read_csv(out / "fixtures.csv")
    assert {"id", "event", "kickoff_time", "team_h", "team_a", "team_h_score", "team_a_score",
            "finished"} <= set(fixtures.columns)


def test_unfinished_gameweek_excluded(dirs):
    _write(dirs)
    m = pd.read_csv(dirs[0] / SEASON / "merged_gw.csv")
    assert sorted(m["GW"].unique()) == [1, 2]
    # Fixture 26 is finished, but GW 3 isn't, so its result must not leak into the data.
    assert 26 not in set(m["fixture"])
    assert len(m) == 8                                        # 3 players x 2 GWs + 2 x 1
    # So the app's next gameweek is the one in progress, predicted from GW 1-2 only.
    history = data.load_season(SEASON)
    fixtures = pd.read_csv(dirs[0] / SEASON / "fixtures.csv")
    fixtures = fixtures[fixtures.id.isin(history.fixture) | (fixtures.event >= 3)]  # sample covers 5 teams
    assert upcoming._next_gameweek(fixtures, history) == 3


def test_quick_mode_only_touches_players_and_fixtures(dirs):
    out = dirs[0] / SEASON
    out.mkdir(parents=True)
    (out / "merged_gw.csv").write_text("GW\n1\n")
    res, client = _write(dirs, quick=True)
    assert client.paths == ["bootstrap-static", "fixtures"]  # no player histories
    assert (out / "merged_gw.csv").read_text() == "GW\n1\n"   # match data untouched
    assert (out / "players_raw.csv").exists() and (out / "fixtures.csv").exists()
    assert res.rows is None and res.stale_gw == 1             # warns: GW 2 finished since


def test_incremental_cache(dirs):
    _, first = _write(dirs)
    assert sum(p.startswith("element-summary") for p in first.paths) == 5
    _, second = _write(dirs)
    assert second.paths == ["bootstrap-static", "fixtures"]  # everything cached is up to date

    # GW 3 finishes: every player is refetched, even one whose cached history already has a
    # GW 3 row (Thomas-Asante's provisional fixture 26) and one with no GW 3 match yet.
    third = FakeClient()
    for e in third.files["bootstrap-static"]["events"]:
        e["finished"] = e["id"] <= 3
    for f in third.files["fixtures"]:
        if f["event"] == 3:
            f["finished"] = True
    _write(dirs, client=third)
    assert sum(p.startswith("element-summary") for p in third.paths) == 5
    m = pd.read_csv(dirs[0] / SEASON / "merged_gw.csv")
    assert 26 in set(m["fixture"])


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_client_retries_429_then_succeeds(monkeypatch):
    calls, waits = [], []

    def urlopen(req, timeout):
        calls.append(req)
        if len(calls) < 3:
            raise urllib.error.HTTPError(req.full_url, 429 if len(calls) == 1 else 503, "busy", {}, None)
        return _Resp(b'{"ok": 1}')

    monkeypatch.setattr(fpl_api.urllib.request, "urlopen", urlopen)
    client = fpl_api.FplClient(sleep=waits.append, delay=0.2)
    assert client.get("fixtures") == {"ok": 1}
    assert len(calls) == 3 and waits == [1.0, 2.0, 0.2]       # backoff, backoff, polite delay
    assert calls[0].full_url == "https://fantasy.premierleague.com/api/fixtures/"
    assert calls[0].get_header("User-agent")


def test_client_does_not_retry_404(monkeypatch):
    def urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 404, "missing", {}, None)

    monkeypatch.setattr(fpl_api.urllib.request, "urlopen", urlopen)
    with pytest.raises(urllib.error.HTTPError):
        fpl_api.FplClient(sleep=lambda s: None).get("element-summary/99999")


def test_no_rows_gives_empty_frame_with_columns():
    c = FakeClient()
    for e in c.files["bootstrap-static"]["events"]:
        e["finished"] = False
    df = fpl_api.merged_gw(c.files["bootstrap-static"], c.files["fixtures"], {})
    assert df.empty and list(df.columns) == fpl_api.MERGED_COLUMNS
