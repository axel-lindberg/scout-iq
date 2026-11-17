"""Multi-gameweek predictions: slots, form as of today, double and blank gameweeks, availability."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scout_iq.features import build_features, feature_columns  # noqa: E402
from scout_iq.upcoming import (  # noqa: E402
    Upcoming, _placeholder_rows, assign_slots, fixture_chance, horizon_gameweeks, return_date,
    summarise, upcoming_features)

SEASON = "2026-27"
TEAMS = pd.Series({1: "AAA", 2: "BBB", 3: "CCC", 4: "DDD"})


def _history() -> pd.DataFrame:
    """Four teams, one player each, two played gameweeks (fixtures 1-4)."""
    rows = []
    played = [(1, 1, 1, 2, "2026-08-15"), (2, 1, 3, 4, "2026-08-15"),
              (3, 2, 2, 3, "2026-08-22"), (4, 2, 4, 1, "2026-08-22")]
    pts = {1: [2, 8], 2: [1, 3], 3: [6, 0], 4: [5, 5]}
    for fid, gw, h, a, day in played:
        for el, opp, home in ((h, a, 1), (a, h, 0)):
            p = pts[el][gw - 1]
            rows.append(dict(
                season=SEASON, element=el, fixture=fid, GW=gw, kickoff_time=pd.Timestamp(day, tz="UTC"),
                team_id=el, opponent_team=opp, was_home=home, position="MID", total_points=p,
                minutes=90, starts=1, expected_goals=0.1 * p, expected_assists=0.0,
                expected_goal_involvements=0.1 * p, goals_scored=0, assists=0, clean_sheets=0, bonus=0,
                bps=p, ict_index=1.0, threat=1.0, creativity=1.0, influence=1.0, saves=0, selected=1000,
                value=7.0, expected_goals_conceded=0.5, team_goals_for=p // 3, team_goals_against=1))
    return pd.DataFrame(rows)


def _fixtures() -> pd.DataFrame:
    """Played GW1-2, then GW3 normal, GW4 double for teams 1 and 2 and blank for 3 and 4, GW5 normal."""
    rows = [(1, 1, 1, 2, "2026-08-15"), (2, 1, 3, 4, "2026-08-15"),
            (3, 2, 2, 3, "2026-08-22"), (4, 2, 4, 1, "2026-08-22"),
            (5, 3, 1, 3, "2026-08-29"), (6, 3, 2, 4, "2026-08-29"),
            (7, 4, 1, 2, "2026-09-05"), (8, 4, 2, 1, "2026-09-08"),
            (9, 5, 3, 1, "2026-09-12"), (10, 5, 4, 2, "2026-09-12")]
    return pd.DataFrame(rows, columns=["id", "event", "team_h", "team_a", "kickoff_time"])


def _players(**news) -> pd.DataFrame:
    p = pd.DataFrame({"element": [1, 2, 3, 4], "name": list("ABCD"), "web_name": list("ABCD"),
                      "position": "MID", "team_id": [1, 2, 3, 4], "price": 7.0, "status": "a",
                      "chance_of_playing_next_round": np.nan, "news": "",
                      "news_added": pd.Timestamp("2026-08-23", tz="UTC")})
    for el, (status, chance, text) in news.items():
        i = int(el[1:]) - 1
        p.loc[i, ["status", "chance_of_playing_next_round", "news"]] = [status, chance, text]
    return p


def _rows(players=None):
    players = _players() if players is None else players
    gws = horizon_gameweeks(_fixtures(), _history(), 3)
    rows = upcoming_features(_history(), _fixtures(), players, SEASON, gws)
    return rows, gws, players


def test_horizon_and_slots():
    fx = _fixtures()
    assert horizon_gameweeks(fx, _history(), 3) == [3, 4, 5]
    assert horizon_gameweeks(fx, _history(), 10) == [3, 4, 5]       # stops at the end of the season
    slots = assign_slots(fx[fx.event == 4])
    assert sorted(slots.tolist()) == [(4, 0), (4, 1)]                 # double gameweek -> two slots


def test_form_is_as_of_today_and_fixture_features_change():
    rows, _, _ = _rows()
    feats = [c for c in feature_columns(rows) if not c.startswith(("opp_", "was_home"))
             and not c.startswith("team_")]
    p1 = rows[rows.element == 1].sort_values("kickoff_time")
    assert list(p1.fixture) == [5, 7, 8, 9]
    # Every future row sees only the two real matches: same form, same n_prev.
    assert (p1["n_prev"] == 2).all()
    assert p1["pts_last3"].tolist() == pytest.approx([5.0] * 4)        # (2 + 8) / 2
    assert np.allclose(p1[feats].to_numpy(float), p1[feats].iloc[[0]].to_numpy(float), equal_nan=True)
    # Fixture features follow the opponent and venue.
    assert p1["was_home"].tolist() == [1, 1, 0, 0]
    assert p1["opponent_team"].tolist() == [3, 2, 2, 3]


def test_next_gameweek_matches_a_single_build():
    # The next gameweek must be exactly what the old one-build approach gave.
    rows, _, players = _rows()
    fx = _fixtures()
    last = _history().groupby("element")["selected"].last()
    one = build_features(pd.concat([_history(), _placeholder_rows(SEASON, fx[fx.event == 3], players, last)],
                                   ignore_index=True))
    one = one[one.total_points.isna()].sort_values("element")
    mine = rows[rows.GW == 3].sort_values("element")
    cols = feature_columns(one)
    assert np.allclose(one[cols].to_numpy(float), mine[cols].to_numpy(float), equal_nan=True)


def test_double_and_blank_gameweeks():
    rows, gws, players = _rows()
    rows["xpts_fixture"] = 2.0 + rows["was_home"]        # 3 at home, 2 away
    rows["chance"] = 100.0
    pred, by_gw = summarise(rows, players, TEAMS, gws)
    g = by_gw.set_index(["element", "GW"])
    assert g.loc[(1, 4), "xpts"] == pytest.approx(5.0)   # double: 3 (H) + 2 (A)
    assert g.loc[(1, 4), "n_fixtures"] == 2
    assert g.loc[(1, 4), "fixtures"] == "BBB (H), BBB (A)"
    assert g.loc[(3, 4), "xpts"] == 0.0 and g.loc[(3, 4), "fixtures"] == ""   # blank
    assert g.loc[(3, 4), "n_fixtures"] == 0
    assert len(by_gw) == 4 * 3                            # every player x every gameweek
    p = pred.set_index("element")
    assert p.loc[1, "xpts_horizon"] == pytest.approx(3 + 5 + 2)
    assert p.loc[3, "xpts_horizon"] == pytest.approx(2 + 0 + 3)
    assert p.loc[1, "fixtures"] == "CCC (H)"              # next-gameweek columns stay as before


def test_return_dates_from_news():
    added = "2026-11-10T12:00:00Z"
    assert return_date("Hamstring injury - Expected back 22 Nov", added) == pd.Timestamp("2026-11-22", tz="UTC")
    assert return_date("Suspended until 29 Nov", added) == pd.Timestamp("2026-11-29", tz="UTC")
    assert return_date("Knee injury - Expected back 05 Jan", "2026-12-20") == pd.Timestamp("2027-01-05", tz="UTC")
    assert return_date("Knee injury - Unknown return date", added) is None
    assert return_date("Has joined Stoke City on loan until January", added) is None
    assert return_date("", added) is None


def test_chance_next_gameweek_then_back_from_return_date():
    players = _players(p1=("i", 0.0, "Ankle injury - Expected back 01 Sep"),
                       p2=("d", 50.0, "Knock - 50% chance of playing"),
                       p3=("i", 0.0, "Knee injury - Unknown return date"))
    rows, gws, _ = _rows(players)
    rows["chance"] = fixture_chance(rows, players, gws[0]).to_numpy()
    c = rows.set_index("fixture").query("element == 1")["chance"]
    assert c.loc[5] == 0.0                     # next gameweek: FPL's figure
    assert c.loc[7] == 100.0 and c.loc[9] == 100.0   # after 1 Sep: back
    assert (rows.loc[rows.element == 2, "chance"] == 50.0).all()   # no date: keep FPL's figure
    assert (rows.loc[rows.element == 3, "chance"] == 0.0).all()
    assert (rows.loc[rows.element == 4, "chance"] == 100.0).all()


def test_upcoming_without_per_gameweek_table_still_works():
    p = pd.DataFrame({"element": [1], "xpts": [2.0], "xpts_adjusted": [1.0], "chance_of_playing": [50],
                      "fixtures": ["AAA (H)"]})
    up = Upcoming(SEASON, 7, pd.Timestamp("2026-10-17", tz="UTC"), p, p)
    assert up.gameweeks == [7] and up.by_gw.iloc[0]["xpts_adjusted"] == 1.0
