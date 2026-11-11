"""Feature engineering.

Every feature for a row is computed ONLY from fixtures that kicked off before it
(rolling windows are shifted by one), so a model trained on these features never
sees the outcome it is asked to predict. `tests/test_features.py` checks this.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TARGET = "total_points"

# Per-player stats to summarise over recent fixtures.
PLAYER_STATS = {
    "pts": "total_points",
    "mins": "minutes",
    "starts": "starts",
    "xg": "expected_goals",
    "xa": "expected_assists",
    "xgi": "expected_goal_involvements",
    "goals": "goals_scored",
    "assists": "assists",
    "cs": "clean_sheets",
    "bonus": "bonus",
    "bps": "bps",
    "ict": "ict_index",
    "threat": "threat",
    "creativity": "creativity",
    "influence": "influence",
    "saves": "saves",
}
WINDOWS = (3, 5)

POSITIONS = ["GK", "DEF", "MID", "FWD"]


def _rolling_past(g: pd.core.groupby.SeriesGroupBy, window: int) -> pd.Series:
    """Mean over the previous `window` rows of each group, excluding the current row."""
    return g.transform(lambda s: s.shift(1).rolling(window, min_periods=1).mean())


def add_player_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["season", "element", "kickoff_time", "fixture"]).copy()
    keys = ["season", "element"]
    grouped = df.groupby(keys, sort=False)

    df["n_prev"] = grouped.cumcount()  # fixtures already played this season
    for short, col in PLAYER_STATS.items():
        g = grouped[col]
        for w in WINDOWS:
            df[f"{short}_last{w}"] = _rolling_past(g, w)
    # Season-to-date averages (expanding, excluding current row).
    for short in ("pts", "mins", "xgi", "bps"):
        col = PLAYER_STATS[short]
        df[f"{short}_season"] = grouped[col].transform(lambda s: s.shift(1).expanding().mean())

    played60 = (df["minutes"] >= 60).astype(float)
    df["played60_rate5"] = played60.groupby([df["season"], df["element"]]).transform(
        lambda s: s.shift(1).rolling(5, min_periods=1).mean()
    )
    df["log_selected"] = np.log1p(df["selected"].clip(lower=0))
    return df


def _team_table(df: pd.DataFrame) -> pd.DataFrame:
    """One row per team per fixture with rolling attack/defence form from past fixtures."""
    t = (
        df.groupby(["season", "fixture", "team_id"])
        .agg(kickoff_time=("kickoff_time", "first"),
             gf=("team_goals_for", "first"), ga=("team_goals_against", "first"),
             xg=("expected_goals", "sum"), xgc=("expected_goals_conceded", "max"))
        .reset_index()
        .sort_values(["season", "team_id", "kickoff_time"])
    )
    g = t.groupby(["season", "team_id"], sort=False)
    for col in ("gf", "ga", "xg", "xgc"):
        t[f"{col}_last5"] = _rolling_past(g[col], 5)
    return t[["season", "fixture", "team_id", "gf_last5", "ga_last5", "xg_last5", "xgc_last5"]]


def add_team_features(df: pd.DataFrame) -> pd.DataFrame:
    t = _team_table(df)
    own = t.rename(columns={c: f"team_{c}" for c in t.columns if c.endswith("_last5")})
    opp = t.rename(columns={"team_id": "opponent_team",
                            **{c: f"opp_{c}" for c in t.columns if c.endswith("_last5")}})
    df = df.merge(own, on=["season", "fixture", "team_id"], how="left")
    df = df.merge(opp, on=["season", "fixture", "opponent_team"], how="left")
    return df


def add_position(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["position"] = df["position"].replace({"GKP": "GK"})
    for p in POSITIONS:
        df[f"pos_{p}"] = (df["position"] == p).astype(int)
    return df


def build_features(raw: pd.DataFrame) -> pd.DataFrame:
    df = add_position(raw)
    df = add_player_features(df)
    df = add_team_features(df)
    return df.sort_values(["kickoff_time", "fixture", "element"]).reset_index(drop=True)


def feature_columns(df: pd.DataFrame) -> list[str]:
    """Columns a model is allowed to use (all known before kickoff)."""
    cols = ["n_prev", "value", "was_home", "log_selected", "played60_rate5"]
    cols += [c for c in df.columns if any(c.startswith(f"{s}_last") for s in PLAYER_STATS)]
    cols += [c for c in df.columns if c.endswith("_season")]
    cols += [c for c in df.columns if c.startswith(("team_gf_", "team_ga_", "team_xg_", "team_xgc_",
                                                    "opp_gf_", "opp_ga_", "opp_xg_", "opp_xgc_"))]
    cols += [f"pos_{p}" for p in POSITIONS]
    return list(dict.fromkeys(cols))
