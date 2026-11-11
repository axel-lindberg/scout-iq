"""Load raw FPL gameweek data into one tidy table.

One row = one player in one fixture (double gameweeks give two rows in the same GW).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"

NUMERIC_COLS = [
    "total_points", "minutes", "starts", "goals_scored", "assists", "clean_sheets",
    "goals_conceded", "saves", "bonus", "bps", "influence", "creativity", "threat",
    "ict_index", "expected_goals", "expected_assists", "expected_goal_involvements",
    "expected_goals_conceded", "value", "selected", "xP", "yellow_cards", "red_cards",
]


def available_seasons() -> list[str]:
    return sorted(p.name for p in RAW_DIR.iterdir() if (p / "merged_gw.csv").exists())


def load_season(season: str) -> pd.DataFrame:
    df = pd.read_csv(RAW_DIR / season / "merged_gw.csv")
    teams = pd.read_csv(RAW_DIR / season / "teams.csv")[["id", "name", "short_name"]]

    df = df.drop_duplicates(subset=["element", "fixture"]).copy()
    df["season"] = season
    df["kickoff_time"] = pd.to_datetime(df["kickoff_time"], utc=True)
    df["was_home"] = df["was_home"].astype(str).str.lower().eq("true").astype(int)
    for col in NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["value"] = df["value"] / 10.0  # price in £m

    # Own team id: the other team in the fixture. Home players' opponent is the away team.
    fx = (
        df.groupby(["fixture", "was_home"])["opponent_team"].first().unstack()
        .rename(columns={0: "home_team_id", 1: "away_team_id"})
    )
    df = df.join(fx, on="fixture")
    df["team_id"] = df["home_team_id"].where(df["was_home"] == 1, df["away_team_id"]).astype(int)
    df = df.drop(columns=["home_team_id", "away_team_id"])

    names = teams.set_index("id")["name"]
    df["team_name"] = df["team_id"].map(names)
    df["opponent_name"] = df["opponent_team"].map(names)

    # Goals for/against from the player's team perspective (outcome of THIS fixture).
    home, away = df["team_h_score"], df["team_a_score"]
    df["team_goals_for"] = home.where(df["was_home"] == 1, away)
    df["team_goals_against"] = away.where(df["was_home"] == 1, home)

    return df.sort_values(["kickoff_time", "fixture", "element"]).reset_index(drop=True)


def load_all(seasons: list[str] | None = None) -> pd.DataFrame:
    seasons = seasons or available_seasons()
    return pd.concat([load_season(s) for s in seasons], ignore_index=True)
