"""Predict the next few gameweeks of the current season.

Trick: for every player and every unplayed fixture we append a "not yet played" row (outcome
columns empty) to the history, then run the normal feature pipeline. Because every feature is
shifted by one match, the new row's features are exactly the player's history up to now, with no
special-case code.

Several gameweeks ahead: if all future rows went into one build, the second one would "see" the
first (an empty match) in its rolling windows. So the fixtures are split into slots in which every
team plays at most once (one slot per gameweek, two for a double gameweek) and each slot is built
on its own. Every future fixture is therefore predicted as if it were the player's next match:
player form is as of today, only the fixture features (opponent, home/away) change. That is also
the weakness: nothing about form is known for gameweeks further ahead, so those predictions are
less certain.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Callable

import lightgbm as lgb
import numpy as np
import pandas as pd

from .data import RAW_DIR, ROOT, available_seasons, load_all
from .difficulty import FixtureDifficulty, fixture_difficulty
from .features import build_features

MODEL_PATH = ROOT / "models" / "lgbm.txt"
META_PATH = ROOT / "models" / "lgbm_meta.json"
HORIZON = 5  # gameweeks predicted at startup
POSITIONS = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
STATUS = {"a": "available", "d": "doubtful", "i": "injured", "s": "suspended",
          "u": "unavailable", "n": "not in squad"}
# "Hamstring injury - Expected back 22 Nov", "Suspended until 29 Nov"
RETURN_RE = re.compile(r"(?:expected back|until)\s+(\d{1,2})\s+([A-Za-z]{3})", re.IGNORECASE)


@dataclass
class Upcoming:
    season: str
    gameweek: int              # the next gameweek (first one of the horizon)
    deadline: pd.Timestamp     # first kickoff of that gameweek
    predictions: pd.DataFrame  # one row per player: next-GW columns + horizon totals
    players: pd.DataFrame      # every player this season, with status and news
    last_played_gw: int = 0    # latest gameweek with results in the data (shows how fresh it is)
    gameweeks: list[int] = field(default_factory=list)  # the horizon, e.g. [11, 12, 13, 14, 15]
    by_gw: pd.DataFrame | None = None  # one row per player per horizon gameweek (0 = blank)
    difficulty: FixtureDifficulty | None = None  # every team's upcoming fixtures, rated (difficulty.py)

    def __post_init__(self):
        if not self.gameweeks:
            self.gameweeks = [self.gameweek]
        if self.by_gw is None:  # single-gameweek data (e.g. tests): derive the per-GW table
            p = self.predictions
            self.by_gw = pd.DataFrame({
                "element": p["element"], "GW": self.gameweek, "xpts": p["xpts"],
                "xpts_adjusted": p["xpts_adjusted"], "chance_of_playing": p["chance_of_playing"],
                "fixtures": p["fixtures"], "n_fixtures": p.get("n_fixtures", 1)})


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
    # FPL's kit/badge id. A player's `team` is the team *id* (1-20, by alphabet each season); the
    # shirt images use the team *code* (stable across seasons, e.g. Arsenal 3), so map id -> code.
    p["team_code"] = p["team_id"].map(teams["code"]).astype("Int64") if "code" in teams else pd.NA
    p["status_text"] = p["status"].map(STATUS).fillna(p["status"])
    p["news"] = p["news"].fillna("")
    keep = ["element", "name", "web_name", "position", "team_id", "team_name", "team_short", "team_code", "price",
            "status", "status_text", "chance_of_playing_next_round", "news", "news_added",
            "selected_by_percent", "total_points", "form"]
    return p[[c for c in keep if c in p.columns]]


def _next_gameweek(fixtures: pd.DataFrame, history: pd.DataFrame) -> int:
    played = set(history["fixture"].unique())
    pending = fixtures[~fixtures["id"].isin(played) & fixtures["event"].notna()]
    if pending.empty:
        raise ValueError("No upcoming fixtures in the data. Run scripts/download_data.py for the new season.")
    return int(pending["event"].min())


def horizon_gameweeks(fixtures: pd.DataFrame, history: pd.DataFrame, horizon: int = HORIZON) -> list[int]:
    """The next `horizon` gameweeks, stopping at the end of the season."""
    first = _next_gameweek(fixtures, history)
    last = int(fixtures["event"].max())
    return list(range(first, min(first + horizon - 1, last) + 1))


def assign_slots(fixtures: pd.DataFrame) -> pd.Series:
    """Slot (gameweek, k) per fixture, so that no team plays twice within one slot.

    A normal gameweek is one slot; in a double gameweek a team's second match goes to slot k=1.
    """
    used: dict[tuple[int, int], set[int]] = {}
    slots = {}
    for idx, f in fixtures.sort_values(["event", "kickoff_time", "id"]).iterrows():
        k = 0
        while used.get((int(f.event), k), set()) & {f.team_h, f.team_a}:
            k += 1
        used.setdefault((int(f.event), k), set()).update({f.team_h, f.team_a})
        slots[idx] = (int(f.event), k)
    return pd.Series(slots, dtype=object).reindex(fixtures.index)


def _placeholder_rows(season: str, fixtures: pd.DataFrame, players: pd.DataFrame,
                      last_selected: pd.Series) -> pd.DataFrame:
    """A "not yet played" row for every player in every given fixture."""
    rows = []
    for _, fx in fixtures.iterrows():
        for team, opp, home in ((fx.team_h, fx.team_a, 1), (fx.team_a, fx.team_h, 0)):
            for _, pl in players[players.team_id == team].iterrows():
                rows.append({
                    "season": season, "element": pl.element, "name": pl["name"],
                    "position": pl.position, "fixture": int(fx["id"]), "GW": int(fx.event),
                    "kickoff_time": pd.to_datetime(fx.kickoff_time, utc=True),
                    "team_id": int(team), "opponent_team": int(opp), "was_home": home,
                    "value": pl.price, "selected": last_selected.get(pl.element, np.nan),
                })
    return pd.DataFrame(rows)


def upcoming_features(history: pd.DataFrame, fixtures: pd.DataFrame, players: pd.DataFrame,
                      season: str, gameweeks: list[int]) -> pd.DataFrame:
    """Feature rows for every player in every unplayed fixture of `gameweeks`.

    `history` holds played matches of `season` only (features are per season, so earlier seasons
    don't change anything). Each slot is built separately, so each row sees only real matches.
    """
    hist = history[history.season == season]
    todo = fixtures[fixtures["event"].isin(gameweeks) & ~fixtures["id"].isin(set(hist["fixture"]))].copy()
    # Last known ownership per player (from the latest played gameweek: safe, pre-deadline).
    last = hist.sort_values("kickoff_time").groupby("element")["selected"].last()
    todo["slot"] = assign_slots(todo)
    parts = []
    for _, fx in todo.groupby("slot", sort=True):
        new = _placeholder_rows(season, fx, players, last)
        if new.empty:
            continue
        feats = build_features(pd.concat([hist, new], ignore_index=True))
        parts.append(feats[feats.total_points.isna()])
    if not parts:
        return pd.DataFrame()
    return pd.concat(parts, ignore_index=True)


def return_date(news: str, news_added) -> pd.Timestamp | None:
    """'Expected back 22 Nov' / 'Suspended until 29 Nov' -> that date (UTC), else None.

    The news has no year: take the first such date on or after the day the news was added.
    """
    m = RETURN_RE.search(news or "")
    added = pd.to_datetime(news_added, utc=True, errors="coerce")
    if not m or pd.isna(added):
        return None
    try:
        day = pd.Timestamp(f"{m.group(1)} {m.group(2)} {added.year}", tz="UTC")
    except ValueError:
        return None
    if day < added.normalize() - pd.Timedelta(days=1):  # e.g. news from December, back in January
        day = day.replace(year=added.year + 1)
    return day


def chance_next(players: pd.DataFrame) -> pd.Series:
    """FPL's chance of playing the next gameweek (0-100); missing means 100 unless out."""
    chance = players["chance_of_playing_next_round"]
    out = players["status"].isin(["i", "s", "u", "n"])
    return chance.where(chance.notna(), np.where(out, 0, 100)).astype(float)


def fixture_chance(rows: pd.DataFrame, players: pd.DataFrame, first_gw: int) -> pd.Series:
    """Chance of playing per future fixture row.

    The next gameweek uses FPL's figure. FPL gives no figure further ahead, so later gameweeks keep
    it too, unless the news has a return date on or before that fixture's kickoff ('Expected back
    22 Nov', 'Suspended until 29 Nov'): then 100.
    """
    p = players.set_index("element")
    chance = rows["element"].map(chance_next(players).set_axis(players["element"]))
    added = p["news_added"] if "news_added" in p else pd.Series(pd.NaT, index=p.index)
    back = pd.Series({e: return_date(n, a) for e, n, a in zip(p.index, p["news"], added)}, dtype=object)
    back = pd.to_datetime(rows["element"].map(back), utc=True)
    fit_again = (rows["GW"] > first_gw) & back.notna() & (rows["kickoff_time"] >= back)
    return chance.where(~fit_again, 100.0).fillna(0.0)


@lru_cache(maxsize=1)
def _model() -> tuple[lgb.Booster, list[str]]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError("No trained model. Run scripts/build_dataset.py and scripts/train_evaluate.py first.")
    meta = json.loads(META_PATH.read_text())
    return lgb.Booster(model_file=str(MODEL_PATH)), meta["features"]


def summarise(rows: pd.DataFrame, players: pd.DataFrame, teams: pd.Series,
              gameweeks: list[int]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Per-fixture predictions (`xpts_fixture`, `chance`) -> (predictions, by_gw).

    Double gameweeks add up both fixtures; a blank gameweek is 0 with no fixtures.
    """
    first = gameweeks[0]
    rows = rows.sort_values(["kickoff_time", "fixture"]).copy()
    rows["opp_label"] = rows["opponent_team"].map(teams) + np.where(rows["was_home"] == 1, " (H)", " (A)")
    rows["xpts_adj_fixture"] = rows["xpts_fixture"] * rows["chance"] / 100.0
    per = (rows.groupby(["element", "GW"])
           .agg(xpts=("xpts_fixture", "sum"), xpts_adjusted=("xpts_adj_fixture", "sum"),
                chance_of_playing=("chance", "first"), fixtures=("opp_label", ", ".join),
                n_fixtures=("fixture", "nunique"))
           .reset_index())
    elements = sorted(rows["element"].unique())
    grid = pd.MultiIndex.from_product([elements, gameweeks], names=["element", "GW"]).to_frame(index=False)
    by_gw = grid.merge(per, on=["element", "GW"], how="left")
    blank = by_gw["n_fixtures"].isna()
    by_gw[["xpts", "xpts_adjusted"]] = by_gw[["xpts", "xpts_adjusted"]].fillna(0.0)
    by_gw["n_fixtures"] = by_gw["n_fixtures"].fillna(0).astype(int)
    by_gw["fixtures"] = by_gw["fixtures"].fillna("")
    chance = chance_next(players).set_axis(players["element"])
    by_gw.loc[blank, "chance_of_playing"] = by_gw.loc[blank, "element"].map(chance)
    by_gw["chance_of_playing"] = by_gw["chance_of_playing"].fillna(0.0)

    form = (rows.groupby("element")
            .agg(pts_last5=("pts_last5", "first"), mins_last3=("mins_last3", "first"),
                 xgi_last5=("xgi_last5", "first"), pts_season=("pts_season", "first"),
                 games=("n_prev", "first"))
            .reset_index())
    nxt = by_gw[by_gw.GW == first][["element", "xpts", "fixtures", "n_fixtures"]]
    total = (by_gw.groupby("element")
             .agg(xpts_horizon=("xpts", "sum"), xpts_horizon_adjusted=("xpts_adjusted", "sum"))
             .reset_index())
    out = players.merge(nxt, on="element", how="inner").merge(form, on="element", how="left")
    out = out.merge(total, on="element", how="left")
    # The model doesn't read injury news. Scale by FPL's own chance-of-playing figure.
    out["chance_of_playing"] = chance_next(out)
    out["xpts_adjusted"] = out["xpts"] * out["chance_of_playing"] / 100.0
    out = out.sort_values(["xpts_adjusted", "element"], ascending=[False, True]).reset_index(drop=True)
    return out, by_gw.sort_values(["element", "GW"]).reset_index(drop=True)


def predict_upcoming(season: str | None = None, horizon: int = HORIZON,
                     model: tuple[Callable, list[str]] | None = None) -> Upcoming:
    season = season or current_season()
    history = load_all([season])  # features are per season: earlier seasons don't change them
    players = _load_players(season)
    fixtures = pd.read_csv(RAW_DIR / season / "fixtures.csv")
    played = history[history.season == season]
    gameweeks = horizon_gameweeks(fixtures, played, horizon)

    rows = upcoming_features(history, fixtures, players, season, gameweeks)
    predict, features = model or _model()
    if isinstance(predict, lgb.Booster):
        predict = predict.predict
    rows["xpts_fixture"] = predict(rows[features])
    rows["chance"] = fixture_chance(rows, players, gameweeks[0]).to_numpy()

    teams_csv = pd.read_csv(RAW_DIR / season / "teams.csv")
    out, by_gw = summarise(rows, players, teams_csv.set_index("id")["short_name"], gameweeks)
    first = rows[rows.GW == gameweeks[0]]
    return Upcoming(season=season, gameweek=gameweeks[0], deadline=first["kickoff_time"].min(),
                    predictions=out, players=players,
                    last_played_gw=int(played["GW"].max()) if len(played) else 0,
                    gameweeks=gameweeks, by_gw=by_gw,
                    difficulty=fixture_difficulty(played, fixtures, teams_csv, gameweeks))


def predict_next_gameweek(season: str | None = None, horizon: int = HORIZON) -> Upcoming:
    """Kept for existing callers; predicts `horizon` gameweeks starting with the next one."""
    return predict_upcoming(season, horizon)
