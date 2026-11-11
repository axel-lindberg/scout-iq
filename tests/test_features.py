"""Leakage and sanity tests for the feature pipeline."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scout_iq.features import build_features, feature_columns  # noqa: E402


def _toy() -> pd.DataFrame:
    """Two teams, one player each, three fixtures."""
    rows = []
    kick = pd.to_datetime(["2025-08-16", "2025-08-23", "2025-08-30"], utc=True)
    pts_a, pts_b = [2, 10, 6], [1, 1, 8]
    for i, k in enumerate(kick):
        home = i % 2 == 0
        for el, team, opp, pts, is_home in ((1, 1, 2, pts_a[i], home), (2, 2, 1, pts_b[i], not home)):
            rows.append(dict(
                season="2025-26", element=el, fixture=100 + i, GW=i + 1, kickoff_time=k,
                team_id=team, opponent_team=opp, was_home=int(is_home), position="MID",
                total_points=pts, minutes=90, starts=1, expected_goals=0.1 * pts,
                expected_assists=0.0, expected_goal_involvements=0.1 * pts, goals_scored=0,
                assists=0, clean_sheets=0, bonus=0, bps=pts, ict_index=1.0, threat=1.0,
                creativity=1.0, influence=1.0, saves=0, selected=1000, value=7.0,
                expected_goals_conceded=0.5, team_goals_for=pts // 3, team_goals_against=1,
            ))
    return pd.DataFrame(rows)


def test_first_fixture_has_no_history():
    df = build_features(_toy())
    first = df[df.fixture == 100]
    assert (first["n_prev"] == 0).all()
    assert first["pts_last5"].isna().all()


def test_rolling_uses_only_past_fixtures():
    df = build_features(_toy()).set_index(["element", "fixture"])
    # Player 1 scored 2, 10, 6. Before fixture 102 the last-5 mean is (2+10)/2 = 6.
    assert df.loc[(1, 102), "pts_last5"] == pytest.approx(6.0)
    assert df.loc[(1, 101), "pts_last3"] == pytest.approx(2.0)


def test_current_outcome_never_in_features():
    df = build_features(_toy())
    feats = feature_columns(df)
    assert "total_points" not in feats and "minutes" not in feats
    # Changing this fixture's points must not change this fixture's features.
    raw = _toy()
    raw.loc[raw.fixture == 102, "total_points"] = 99
    df2 = build_features(raw)
    a = df[df.fixture == 102][feats].to_numpy(dtype=float)
    b = df2[df2.fixture == 102][feats].to_numpy(dtype=float)
    assert np.allclose(a, b, equal_nan=True)


def test_opponent_features_come_from_opponent():
    df = build_features(_toy()).set_index(["element", "fixture"])
    # Before fixture 102, team 2 conceded 1 goal per game -> opponent of player 1.
    assert df.loc[(1, 102), "opp_ga_last5"] == pytest.approx(1.0)
