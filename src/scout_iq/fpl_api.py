"""Current-season data from the official FPL API, written in vaastav's file format.

The API is unofficial and undocumented. Three endpoints are enough:

    bootstrap-static/        players (price, status, news), teams, gameweeks ("events")
    fixtures/                every fixture of the season, played or not
    element-summary/{id}/    one player's match-by-match history this season

`write_season()` turns them into data/raw/<season>/{merged_gw,fixtures,players_raw,teams}.csv
with the same columns as vaastav/Fantasy-Premier-League, so the rest of the code doesn't know
or care where the data came from.

Only matches from FINISHED gameweeks enter merged_gw.csv. While a gameweek is in progress its
early results are provisional (bonus points not added yet) and only some teams have played, so
including them would mix half a gameweek into the features and labels.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from .data import RAW_DIR, ROOT

BASE_URL = "https://fantasy.premierleague.com/api"
CACHE_DIR = ROOT / "data" / "cache" / "fpl_api"
USER_AGENT = os.getenv("FPL_USER_AGENT", "Mozilla/5.0 (compatible; fpl-data-client/1.0)")
POSITIONS = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}

# Column order of vaastav's merged_gw.csv. xP (FPL's own expected points) isn't in the API: NaN.
MERGED_COLUMNS = [
    "name", "position", "team", "xP", "assists", "bonus", "bps", "clean_sheets", "creativity",
    "element", "expected_assists", "expected_goal_involvements", "expected_goals",
    "expected_goals_conceded", "fixture", "goals_conceded", "goals_scored", "ict_index", "influence",
    "kickoff_time", "minutes", "modified", "opponent_team", "own_goals", "penalties_missed",
    "penalties_saved", "red_cards", "round", "saves", "selected", "starts", "team_a_score",
    "team_h_score", "threat", "total_points", "transfers_balance", "transfers_in", "transfers_out",
    "value", "was_home", "yellow_cards", "clearances_blocks_interceptions", "defensive_contribution",
    "recoveries", "tackles", "GW",
]
# The API sends these as strings ("11.8", "0.20").
FLOAT_COLUMNS = ["influence", "creativity", "threat", "ict_index", "expected_goals", "expected_assists",
                 "expected_goal_involvements", "expected_goals_conceded"]


# --------------------------------------------------------------------------------------------
# HTTP client
# --------------------------------------------------------------------------------------------

class FplClient:
    """GET JSON from the FPL API with a timeout, retries with backoff and a polite delay."""

    def __init__(self, base_url: str = BASE_URL, timeout: float = 20.0, retries: int = 4,
                 backoff: float = 1.0, delay: float = 0.2, sleep: Callable[[float], None] = time.sleep):
        self.base_url, self.timeout, self.retries = base_url.rstrip("/"), timeout, retries
        self.backoff, self.delay, self.sleep = backoff, delay, sleep
        self.requests = 0

    def get(self, path: str):
        url = f"{self.base_url}/{path.strip('/')}/"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        for attempt in range(self.retries + 1):
            try:
                self.requests += 1
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                self.sleep(self.delay)  # be polite: spread requests out
                return data
            except urllib.error.HTTPError as e:
                retryable = e.code == 429 or e.code >= 500
                if not retryable or attempt == self.retries:
                    raise
                wait = _retry_after(e) or self.backoff * 2 ** attempt
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt == self.retries:
                    raise
                wait = self.backoff * 2 ** attempt
            self.sleep(wait)  # 1, 2, 4, 8 s by default
        raise RuntimeError("unreachable")


def _retry_after(e: urllib.error.HTTPError) -> float | None:
    try:
        return float(e.headers.get("Retry-After"))
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------------------------
# Season facts
# --------------------------------------------------------------------------------------------

def season_name(bootstrap: dict) -> str:
    """'2026-27' from the first gameweek's deadline (August 2026)."""
    first = min(bootstrap["events"], key=lambda e: e["id"])
    year = datetime.fromisoformat(first["deadline_time"].replace("Z", "+00:00")).year
    return f"{year}-{(year + 1) % 100:02d}"


def season_for_date(day: datetime | None = None) -> str:
    """Offline fallback: seasons start in August, so July 2027 still belongs to 2026-27."""
    day = day or datetime.now(timezone.utc)
    year = day.year if day.month >= 8 else day.year - 1
    return f"{year}-{(year + 1) % 100:02d}"


def latest_finished_gw(bootstrap: dict) -> int:
    finished = [e["id"] for e in bootstrap["events"] if e["finished"]]
    return max(finished) if finished else 0


def next_gw(bootstrap: dict) -> int | None:
    nxt = [e["id"] for e in bootstrap["events"] if e["is_next"]]
    return nxt[0] if nxt else None


def finished_fixture_ids(bootstrap: dict, fixtures: list[dict]) -> set[int]:
    """Fixtures whose result is final AND whose gameweek is complete."""
    done_gws = {e["id"] for e in bootstrap["events"] if e["finished"]}
    return {f["id"] for f in fixtures if f["finished"] and f["event"] in done_gws}


# --------------------------------------------------------------------------------------------
# Mapping to vaastav's files
# --------------------------------------------------------------------------------------------

def players_raw(bootstrap: dict) -> pd.DataFrame:
    return pd.DataFrame(bootstrap["elements"])  # same fields vaastav saves


def teams_table(bootstrap: dict) -> pd.DataFrame:
    return pd.DataFrame(bootstrap["teams"])


def fixtures_table(fixtures: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(fixtures)
    if "stats" in df.columns:
        df["stats"] = df["stats"].map(json.dumps)
    return df.sort_values("id").reset_index(drop=True)


def merged_gw(bootstrap: dict, fixtures: list[dict], histories: dict[int, dict]) -> pd.DataFrame:
    """One row per player per finished match, with vaastav's merged_gw.csv columns."""
    done = finished_fixture_ids(bootstrap, fixtures)
    teams = {t["id"]: t["name"] for t in bootstrap["teams"]}
    fx = {f["id"]: f for f in fixtures}
    rows = []
    for p in bootstrap["elements"]:
        for h in histories.get(p["id"], {}).get("history", []):
            if h["fixture"] not in done:
                continue
            f = fx[h["fixture"]]
            rows.append({
                **h,
                "name": f"{p['first_name'].strip()} {p['second_name'].strip()}",
                "position": POSITIONS[p["element_type"]],
                # The team he played FOR in this match (right even if he moved club mid-season).
                "team": teams[f["team_h"] if h["was_home"] else f["team_a"]],
                "xP": np.nan,
                "GW": h["round"],
            })
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=MERGED_COLUMNS)
    for col in FLOAT_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    cols = MERGED_COLUMNS + [c for c in df.columns if c not in MERGED_COLUMNS]  # keep new API fields
    df = df.reindex(columns=cols)
    return df.sort_values(["GW", "kickoff_time", "fixture", "element"]).reset_index(drop=True)


# --------------------------------------------------------------------------------------------
# Cache + download
# --------------------------------------------------------------------------------------------

@dataclass
class DownloadResult:
    season: str
    latest_finished_gw: int
    next_gw: int | None
    players: int
    fetched: int = 0        # player histories requested this run
    rows: int | None = None  # merged_gw rows written (None in quick mode)
    stale_gw: int | None = None  # quick mode: latest GW in merged_gw.csv when it's behind


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(path)  # atomic: a crash never leaves half a file in the cache


def fetch_histories(client: FplClient, ids: list[int], finished_gw: int, cache_dir: Path = CACHE_DIR,
                    full: bool = False, workers: int = 4) -> tuple[dict[int, dict], int]:
    """element-summary for every player, reusing cached ones that are already up to date.

    The manifest records the latest finished gameweek at the time each player was fetched. A
    player is refetched only when a newer gameweek has finished since. (Checking the history's
    last `round` would be wrong: a fetch during a gameweek holds provisional rows for it, and
    those would never be replaced once that gameweek finished.)
    """
    summ_dir = cache_dir / "element_summary"
    manifest_path = summ_dir / "manifest.json"
    manifest = {int(k): v for k, v in _read_json(manifest_path).items()} if manifest_path.exists() else {}

    def fresh(pid: int) -> bool:
        return (not full and manifest.get(pid, {}).get("finished_gw", -1) >= finished_gw
                and (summ_dir / f"{pid}.json").exists())

    todo = [pid for pid in ids if not fresh(pid)]

    def fetch(pid: int) -> tuple[int, dict]:
        data = client.get(f"element-summary/{pid}")
        _write_json(summ_dir / f"{pid}.json", data)
        return pid, data

    histories: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, (pid, data) in enumerate(pool.map(fetch, todo), 1):
            histories[pid] = data
            manifest[pid] = {"finished_gw": finished_gw,
                             "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            if i % 100 == 0:
                print(f"    {i}/{len(todo)} player histories")
                _write_json(manifest_path, manifest)  # keep progress if interrupted
    _write_json(manifest_path, manifest)
    for pid in ids:
        if pid not in histories:
            histories[pid] = _read_json(summ_dir / f"{pid}.json")
    return histories, len(todo)


def write_season(client: FplClient | None = None, quick: bool = False, full: bool = False,
                 raw_dir: Path = RAW_DIR, cache_dir: Path = CACHE_DIR, workers: int = 4) -> DownloadResult:
    """Download the current season and write it to raw_dir/<season>/ in vaastav's format.

    quick=True refreshes only bootstrap-static and fixtures (prices, status, news, next
    gameweek) and leaves merged_gw.csv as it is.
    """
    client = client or FplClient()
    bootstrap = client.get("bootstrap-static")
    fixtures = client.get("fixtures")
    _write_json(cache_dir / "bootstrap-static.json", bootstrap)
    _write_json(cache_dir / "fixtures.json", fixtures)

    season = season_name(bootstrap)
    out = raw_dir / season
    out.mkdir(parents=True, exist_ok=True)
    done_gw = latest_finished_gw(bootstrap)
    res = DownloadResult(season, done_gw, next_gw(bootstrap), len(bootstrap["elements"]))

    players_raw(bootstrap).to_csv(out / "players_raw.csv", index=False)
    teams_table(bootstrap).to_csv(out / "teams.csv", index=False)
    fixtures_table(fixtures).to_csv(out / "fixtures.csv", index=False)

    if quick:
        merged = out / "merged_gw.csv"
        have = int(pd.read_csv(merged, usecols=["GW"])["GW"].max()) if merged.exists() else 0
        if have < done_gw:
            res.stale_gw = have
        return res

    ids = [p["id"] for p in bootstrap["elements"]]
    histories, res.fetched = fetch_histories(client, ids, done_gw, cache_dir, full=full, workers=workers)
    df = merged_gw(bootstrap, fixtures, histories)
    df.to_csv(out / "merged_gw.csv", index=False)
    res.rows = len(df)
    return res
