"""Fixture difficulty: direction of the scores, home advantage, shrinkage, recency, doubles and blanks."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scout_iq import difficulty as d  # noqa: E402
from scout_iq.difficulty import fixture_difficulty, run_totals, team_matches, team_strength  # noqa: E402

TEAMS = pd.DataFrame({"id": [1, 2, 3, 4], "short_name": ["AAA", "BBB", "CCC", "DDD"],
                      "name": ["Aaa", "Bbb", "Ccc", "Ddd"], "code": [11, 12, 13, 14]})


def _history(matches) -> pd.DataFrame:
    """matches: (fixture, day, home team, away team, home xG, away xG). Two players per team, xG split."""
    rows = []
    for fid, day, h, a, xh, xa in matches:
        for team, opp, home, xg in ((h, a, 1, xh), (a, h, 0, xa)):
            for _ in range(2):
                rows.append({"fixture": fid, "kickoff_time": pd.Timestamp(day, tz="UTC"), "team_id": team,
                             "opponent_team": opp, "was_home": home, "expected_goals": xg / 2})
    return pd.DataFrame(rows)


def _fixtures(rows) -> pd.DataFrame:
    """rows: (id, gameweek, home, away, day)."""
    f = pd.DataFrame(rows, columns=["id", "event", "team_h", "team_a", "kickoff_time"])
    f["kickoff_time"] = pd.to_datetime(f.kickoff_time, utc=True)
    return f


# GW1: 1-2, 3-4. Team 4 creates a lot (3.0 xG) and team 2 concedes a lot.
PLAYED = [(1, "2026-08-15", 1, 2, 2.5, 0.5), (2, "2026-08-15", 3, 4, 1.0, 3.0)]
# GW2: normal. GW3: double for 1 and 2, blank for 3 and 4. GW4: normal. Fixture 1 is already played.
UPCOMING = _fixtures([(1, 1, 1, 2, "2026-08-15"), (2, 1, 3, 4, "2026-08-15"),
                      (3, 2, 1, 3, "2026-08-22"), (4, 2, 2, 4, "2026-08-22"),
                      (5, 3, 1, 2, "2026-08-29"), (6, 3, 2, 1, "2026-09-01"),
                      (7, 4, 4, 1, "2026-09-05"), (8, 4, 3, 2, "2026-09-05")])


def _fd(gameweeks=(2, 3, 4)):
    return fixture_difficulty(_history(PLAYED), UPCOMING, TEAMS, list(gameweeks))


def test_team_matches_pair_each_teams_xg_with_what_it_conceded():
    m = team_matches(_history(PLAYED)).set_index("team_id")
    assert m.loc[1, ["xg", "xga", "was_home"]].tolist() == [2.5, 0.5, 1]
    assert m.loc[4, ["xg", "xga", "was_home"]].tolist() == [3.0, 1.0, 0]


def test_easy_to_score_against_a_leaky_defence_and_hard_to_keep_a_clean_sheet_against_a_strong_attack():
    f = _fd().fixtures.set_index(["fixture", "team_id"])
    # Team 1 hosts 3 (conceded 3.0): easy to score. Team 2 hosts 4 (created 3.0): hard to keep a clean sheet.
    assert f.loc[(3, 1), "attack"] > 1 > f.loc[(4, 2), "defence"]
    assert f.loc[(3, 1), "cs_chance"] == pytest.approx(math.exp(-f.loc[(3, 1), "xg_against"]))
    assert f.loc[(3, 1), "overall"] == pytest.approx((f.loc[(3, 1), "attack"] + f.loc[(3, 1), "defence"]) / 2)


def test_home_advantage_makes_the_same_opponent_easier_at_home():
    f = _fd().fixtures.set_index(["fixture", "team_id"])
    home, away = f.loc[(5, 1)], f.loc[(6, 1)]   # team 1 v team 2 at home, then away
    h = d.DEFAULT_HOME_FACTOR                     # only 4 team-matches played: the default is used
    assert home.xg_for / away.xg_for == pytest.approx(h * h)
    assert away.xg_against / home.xg_against == pytest.approx(h * h)
    assert home.overall > away.overall


def test_double_gameweek_counts_both_fixtures_and_blank_counts_zero():
    fd = _fd()
    gw3 = fd.fixtures[fd.fixtures.GW == 3]
    assert sorted(gw3.team_id) == [1, 1, 2, 2]          # double for 1 and 2, nobody else plays
    tot = run_totals(fd)
    f = fd.fixtures
    assert tot.loc[1, "attack"] == pytest.approx(f[f.team_id == 1].attack.sum())   # three fixtures
    assert len(f[f.team_id == 1]) == 4 and len(f[f.team_id == 3]) == 2           # GW2 + double + GW4
    assert set(f[f.team_id == 3].GW) == {2, 4}                                    # blank in GW3
    # A blank adds nothing: the run total is just the two real fixtures.
    assert tot.loc[3, "overall"] == pytest.approx(f[f.team_id == 3].overall.sum())


def test_played_fixtures_and_gameweeks_outside_the_horizon_are_left_out():
    fd = fixture_difficulty(_history(PLAYED), UPCOMING, TEAMS, [1, 2])
    assert set(fd.fixtures.fixture) == {3, 4}
    assert run_totals(fd).loc[1, "overall"] > 0


def test_shrinkage_pulls_a_one_match_team_toward_the_league_average():
    m = team_matches(_history(PLAYED))
    avg = m.xg.mean()
    raw = team_strength(m, [1, 2, 3, 4], avg, home=1.0, prior=0)
    shrunk = team_strength(m, [1, 2, 3, 4], avg, home=1.0, prior=5)
    assert raw.loc[4, "attack"] == pytest.approx(3.0)                   # exactly their one match
    assert avg < shrunk.loc[4, "attack"] < raw.loc[4, "attack"]
    assert shrunk.loc[4, "attack"] == pytest.approx((3.0 + 5 * avg) / 6)


def test_recent_matches_count_more():
    # Team 2 conceded 3.0 a while ago and 0.5 last week: the rating sits below the plain mean of 1.75.
    hist = _history([(1, "2026-08-15", 1, 2, 3.0, 1.0), (2, "2026-08-22", 2, 3, 1.0, 0.5)])
    s = team_strength(team_matches(hist), [1, 2, 3], league_xg=1.75, home=1.0, half_life=1, prior=0)
    assert s.loc[2, "defence"] == pytest.approx((0.5 * 3.0 + 1 * 0.5) / 1.5)
    assert s.loc[2, "defence"] < 1.75


def test_venue_is_taken_out_of_past_matches():
    # Conceding 1.0 away (the opponent was at home, boosted) is better defending than 1.0 at home.
    hist = _history([(1, "2026-08-15", 1, 2, 1.0, 1.0)])
    s = team_strength(team_matches(hist), [1, 2], league_xg=1.0, home=1.1, prior=0)
    assert s.loc[2, "defence"] == pytest.approx(1.0 / 1.1)
    assert s.loc[1, "defence"] == pytest.approx(1.0 * 1.1)


def test_before_any_match_fpl_strength_is_the_fallback():
    teams = TEAMS.assign(strength_overall_home=[5, 3, 3, 1], strength_overall_away=[5, 3, 3, 1])
    fd = fixture_difficulty(_history([]).reindex(columns=["fixture"]), UPCOMING, teams, [1])
    assert fd.league_xg == d.DEFAULT_LEAGUE_XG
    s = fd.teams.set_index("id")
    assert s.loc[1, "attack"] > s.loc[2, "attack"] == s.loc[3, "attack"] > s.loc[4, "attack"]
    f = fd.fixtures.set_index("team_id")
    assert f.loc[2, "overall"] < f.loc[1, "overall"]     # team 2 plays the strongest team (1)
    no_strength = fixture_difficulty(_history([]).reindex(columns=["fixture"]), UPCOMING, TEAMS, [1])
    f0 = no_strength.fixtures.set_index("team_id")
    # Without data and without FPL strength, every opponent is average; only home/away differs.
    assert f0.loc[1, "attack"] == pytest.approx(d.DEFAULT_HOME_FACTOR)
