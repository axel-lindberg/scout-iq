"""Predict the next gameweek of the current season.

Trick: for every player and every fixture in the next gameweek we append a
"not yet played" row (outcome columns empty) to the history, then run the normal
feature pipeline. Because every feature is shifted by one match, the new row's
features are exactly the player's history up to now, with no special-case code.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

import lightgbm as lgb
import numpy as np
import pandas as pd

from .data import RAW_DIR, ROOT, available_seasons, load_all
from .features import build_features

MODEL_PATH = ROOT / "models" / "lgbm.txt"
META_PATH = ROOT / "models" / "lgbm_meta.json"
POSITIONS = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
STATUS = {"a": "available", "d": "doubtful", "i": "injured", "s": "suspended",
          "u": "unavailable", "n": "not in squad"}


@dataclass
class Upcoming:
    season: str
    gameweek: int
    deadline: pd.Timestamp
    predictions: pd.DataFrame  # one row per player for the gameweek
    players: pd.DataFrame      # every player this season, with status and news
    last_played_gw: int = 0    # latest gameweek with results in the data (shows how fresh it is)


def current_season() -> str:
    return available_seasons()[-1]


def _load_players(season: str) -> pd.DataFrame:
    p = pd.read_csv(RAW_DIR / season / "players_raw.csv")
    teams = pd.read_csv(RAW_DIR / season / "teams.csv").set_index("id")
    p = p.rename(columns={"id": "element", "team": "team_id"})
    p["name"] = (p["first_name"].str.strip() + " " + p["second_name"].str.strip())
    p["position"] = p["element_type"].map(POSITIONS)
    p["price"] = p["now_cost"] / 10.0
    p["team_name"] = p["team_id"].map(teams["name"])
    p["team_short"] = p["team_id"].map(teams["short_name"])
    p["status_text"] = p["status"].map(STATUS).fillna(p["status"])
    p["news"] = p["news"].fillna("")
    keep = ["element", "name", "web_name", "position", "team_id", "team_name", "team_short", "price",
            "status", "status_text", "chance_of_playing_next_round", "news", "news_added",
            "selected_by_percent", "total_points", "form"]
    return p[[c for c in keep if c in p.columns]]


def _next_gameweek(fixtures: pd.DataFrame, history: pd.DataFrame) -> int:
    played = set(history["fixture"].unique())
    pending = fixtures[~fixtures["id"].isin(played) & fixtures["event"].notna()]
    if pending.empty:
        raise ValueError("No upcoming fixtures in the data. Run scripts/download_data.py for the new season.")
    return int(pending["event"].min())


def _upcoming_rows(season: str, history: pd.DataFrame, players: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Placeholder rows for every player in every fixture of the next gameweek."""
    fixtures = pd.read_csv(RAW_DIR / season / "fixtures.csv")
    gw = _next_gameweek(fixtures, history[history.season == season])
    gw_fx = fixtures[fixtures["event"] == gw]

    # Last known ownership per player (from the latest played gameweek: safe, pre-deadline).
    last = (history[history.season == season].sort_values("kickoff_time")
            .groupby("element")["selected"].last())

    rows = []
    for _, fx in gw_fx.iterrows():
        for team, opp, home in ((fx.team_h, fx.team_a, 1), (fx.team_a, fx.team_h, 0)):
            squad = players[players.team_id == team]
            for _, pl in squad.iterrows():
                rows.append({
                    "season": season, "element": pl.element, "name": pl["name"],
                    "position": pl.position, "fixture": int(fx["id"]), "GW": gw,
                    "kickoff_time": pd.to_datetime(fx.kickoff_time, utc=True),
                    "team_id": int(team), "opponent_team": int(opp), "was_home": home,
                    "value": pl.price, "selected": last.get(pl.element, np.nan),
                })
    return pd.DataFrame(rows), gw


@lru_cache(maxsize=1)
def _model() -> tuple[lgb.Booster, list[str]]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError("No trained model. Run scripts/build_dataset.py and scripts/train_evaluate.py first.")
    meta = json.loads(META_PATH.read_text())
    return lgb.Booster(model_file=str(MODEL_PATH)), meta["features"]


def predict_next_gameweek(season: str | None = None) -> Upcoming:
    season = season or current_season()
    history = load_all()
    players = _load_players(season)
    upcoming, gw = _upcoming_rows(season, history, players)

    feats_all = build_features(pd.concat([history, upcoming], ignore_index=True))
    mask = (feats_all.season == season) & feats_all.total_points.isna() & (feats_all.GW == gw)
    rows = feats_all[mask].copy()

    model, features = _model()
    rows["xpts_fixture"] = model.predict(rows[features])

    teams = pd.read_csv(RAW_DIR / season / "teams.csv").set_index("id")["short_name"]
    rows["opp_label"] = rows["opponent_team"].map(teams) + np.where(rows["was_home"] == 1, " (H)", " (A)")
    per_player = (rows.groupby("element")
                  .agg(xpts=("xpts_fixture", "sum"), fixtures=("opp_label", ", ".join),
                       n_fixtures=("fixture", "nunique"), pts_last5=("pts_last5", "first"),
                       mins_last3=("mins_last3", "first"), xgi_last5=("xgi_last5", "first"),
                       pts_season=("pts_season", "first"), games=("n_prev", "first"))
                  .reset_index())
    out = players.merge(per_player, on="element", how="inner")

    # The model doesn't read injury news. Scale by FPL's own chance-of-playing figure when there is one.
    chance = out["chance_of_playing_next_round"]
    chance = chance.where(chance.notna(), np.where(out["status"].isin(["i", "s", "u", "n"]), 0, 100))
    out["chance_of_playing"] = chance.astype(float)
    out["xpts_adjusted"] = out["xpts"] * out["chance_of_playing"] / 100.0
    out = out.sort_values("xpts_adjusted", ascending=False).reset_index(drop=True)

    played = history[history.season == season]
    return Upcoming(season=season, gameweek=gw, deadline=rows["kickoff_time"].min(),
                    predictions=out, players=players,
                    last_played_gw=int(played["GW"].max()) if len(played) else 0)
