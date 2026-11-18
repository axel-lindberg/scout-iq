"""Fixture difficulty for the upcoming gameweeks, from our own xG data (not FPL's FDR).

Each opponent gets two strengths, both in "xG per match at a neutral ground":
- `attack`: xG they create. High = hard to keep a clean sheet against them.
- `defence`: xG they concede. High = easy to score against them.

Both are a recency-weighted average of this season's matches (half-life `HALF_LIFE` matches),
shrunk toward the league average by `PRIOR_MATCHES` imaginary average matches, so a few lucky games
don't make a team look elite. Each past match is first made venue-neutral with one league-wide home
factor (too few home or away games per team to estimate it per team). Settings picked on 2024-25 by
how well they predict a team's xG in its next match, checked on 2025-26.

Per fixture, for the team that plays it:
- xg_for = opponent defence x home factor (or / it away); `attack` score = xg_for / league average.
- xg_against = opponent attack / home factor (or x it away); clean-sheet chance = exp(-xg_against);
  `defence` score = that chance / the chance against an average team.
- `overall` = mean of the two. 1.0 is an average fixture, higher is easier.

A run over the horizon is the SUM of its fixtures' scores: a double gameweek is two chances to
score, a blank is none (0), so "5.4" reads as "worth 5.4 average fixtures".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

HALF_LIFE = 12.0          # matches; a match 12 games ago counts half as much as the latest
PRIOR_MATCHES = 5.0       # shrinkage toward the league average
DEFAULT_LEAGUE_XG = 1.45  # 2023-24 to 2025-26, xG per team per match (used before any match is played)
DEFAULT_HOME_FACTOR = 1.07  # sqrt(home xG / away xG) over 2023-24 to 2025-26
MIN_MATCHES_FOR_HOME = 100  # team-matches (5 gameweeks) before the season's own home factor is used
STRENGTH_STEP = 0.10      # fallback only: +-10% xG per point of FPL's strength_overall (1-5)
MODES = ("overall", "attack", "defence")


@dataclass
class FixtureDifficulty:
    gameweeks: list[int]
    teams: pd.DataFrame       # id, short_name, name, code + the strengths used (attack, defence, matches)
    fixtures: pd.DataFrame    # one row per team per upcoming fixture (two per match)
    league_xg: float
    home_factor: float


def team_matches(history: pd.DataFrame) -> pd.DataFrame:
    """One row per team per played match: was_home, xg (created), xga (conceded = opponent's xg)."""
    if history.empty:
        return pd.DataFrame(columns=["fixture", "team_id", "opponent_team", "kickoff_time", "was_home", "xg", "xga"])
    t = (history.groupby(["fixture", "team_id"])
         .agg(opponent_team=("opponent_team", "first"), kickoff_time=("kickoff_time", "first"),
              was_home=("was_home", "first"), xg=("expected_goals", "sum"))
         .reset_index())
    against = t[["fixture", "team_id", "xg"]].rename(columns={"team_id": "opponent_team", "xg": "xga"})
    return t.merge(against, on=["fixture", "opponent_team"], how="left")


def home_factor(matches: pd.DataFrame) -> float:
    """sqrt(home xG / away xG): home teams get xG x this, away teams / this."""
    if len(matches) < MIN_MATCHES_FOR_HOME:
        return DEFAULT_HOME_FACTOR
    home = matches.loc[matches.was_home == 1, "xg"].mean()
    away = matches.loc[matches.was_home == 0, "xg"].mean()
    return float(np.sqrt(home / away)) if away > 0 else DEFAULT_HOME_FACTOR


def team_strength(matches: pd.DataFrame, team_ids, league_xg: float, home: float,
                  fallback: pd.Series | None = None, half_life: float = HALF_LIFE,
                  prior: float = PRIOR_MATCHES) -> pd.DataFrame:
    """attack / defence (neutral xG per match) per team, recency-weighted and shrunk.

    `fallback`: FPL strength_overall per team, used only for a team with no match yet.
    """
    m = matches.sort_values("kickoff_time", ascending=False).copy()
    m["w"] = 0.5 ** (m.groupby("team_id").cumcount() / half_life)
    venue = np.where(m.was_home == 1, home, 1 / home)
    m["wf"] = m.w * m.xg / venue      # a home team's xG was boosted: divide it out
    m["wa"] = m.w * m.xga * venue     # and the xG it conceded was suppressed: multiply back
    g = m.groupby("team_id").agg(w=("w", "sum"), wf=("wf", "sum"), wa=("wa", "sum"), matches=("w", "size"))
    g = g.astype(float).reindex(pd.Index(list(team_ids), name="team_id")).fillna(0.0)
    out = pd.DataFrame({
        "attack": (g.wf + prior * league_xg) / (g.w + prior),
        "defence": (g.wa + prior * league_xg) / (g.w + prior),
        "matches": g.matches.astype(int),
    })
    if fallback is not None and fallback.notna().any():
        unseen = out.matches == 0
        z = (fallback.reindex(out.index) - fallback.mean()).fillna(0.0)
        out.loc[unseen, "attack"] = league_xg * (1 + STRENGTH_STEP * z[unseen])
        out.loc[unseen, "defence"] = league_xg * (1 - STRENGTH_STEP * z[unseen])
    return out


def rate_fixtures(fixtures: pd.DataFrame, strength: pd.DataFrame, league_xg: float, home: float) -> pd.DataFrame:
    """Two rows per fixture (one per team) with the expected goals and the three scores."""
    rows = []
    for f in fixtures.itertuples():
        for team, opp, is_home in ((f.team_h, f.team_a, 1), (f.team_a, f.team_h, 0)):
            venue = home if is_home else 1 / home
            rows.append({"fixture": int(f.id), "GW": int(f.event), "kickoff_time": f.kickoff_time,
                         "team_id": int(team), "opponent_team": int(opp), "was_home": is_home,
                         "xg_for": strength.at[opp, "defence"] * venue,
                         "xg_against": strength.at[opp, "attack"] / venue})
    r = pd.DataFrame(rows, columns=["fixture", "GW", "kickoff_time", "team_id", "opponent_team", "was_home",
                                    "xg_for", "xg_against"])
    r["cs_chance"] = np.exp(-r.xg_against)
    r["attack"] = r.xg_for / league_xg
    r["defence"] = r.cs_chance / np.exp(-league_xg)
    r["overall"] = (r.attack + r.defence) / 2
    return r.sort_values(["GW", "kickoff_time", "fixture", "was_home"], ascending=[True, True, True, False],
                         ignore_index=True)


def fixture_difficulty(history: pd.DataFrame, fixtures: pd.DataFrame, teams: pd.DataFrame,
                       gameweeks: list[int]) -> FixtureDifficulty:
    """history: played rows of the current season; teams: teams.csv (id, name, short_name, code, ...)."""
    matches = team_matches(history)
    league_xg = float(matches.xg.mean()) if len(matches) else DEFAULT_LEAGUE_XG
    home = home_factor(matches)
    teams = teams.set_index("id")
    fallback = None
    if {"strength_overall_home", "strength_overall_away"} <= set(teams.columns):
        fallback = teams[["strength_overall_home", "strength_overall_away"]].mean(axis=1)
    strength = team_strength(matches, teams.index, league_xg, home, fallback)
    played = set(history["fixture"]) if len(history) else set()
    todo = fixtures[fixtures["event"].isin(gameweeks) & ~fixtures["id"].isin(played)]
    info = teams.reindex(columns=["short_name", "name", "code"]).join(strength)
    return FixtureDifficulty(gameweeks=list(gameweeks), teams=info.rename_axis("id").reset_index(),
                             fixtures=rate_fixtures(todo, strength, league_xg, home),
                             league_xg=league_xg, home_factor=home)


def run_totals(fd: FixtureDifficulty) -> pd.DataFrame:
    """Per team: the summed scores over the horizon (blank = 0, double = both). Index: team id."""
    tot = fd.fixtures.groupby("team_id")[list(MODES)].sum()
    return tot.reindex(fd.teams["id"]).fillna(0.0)


def to_records(fd: FixtureDifficulty | None) -> dict:
    """The JSON the frontend reads (also what a static export would write to fixtures.json).

    Every team gets one entry per horizon gameweek: [] = blank, two fixtures = double gameweek.
    """
    if fd is None:
        return {"gameweeks": [], "league_xg": DEFAULT_LEAGUE_XG, "home_factor": DEFAULT_HOME_FACTOR,
                "half_life": HALF_LIFE, "prior_matches": PRIOR_MATCHES, "teams": []}
    r3 = lambda x: round(float(x), 3)  # noqa: E731
    short = fd.teams.set_index("id")["short_name"]
    full = fd.teams.set_index("id")["name"]
    totals = run_totals(fd)
    by_team = {k: g for k, g in fd.fixtures.groupby("team_id")}
    teams = []
    for t in fd.teams.itertuples():
        mine = by_team.get(t.id, fd.fixtures.iloc[0:0])
        cells = [{"gameweek": gw, "fixtures": [
            {"opponent": short.get(f.opponent_team, "?"), "opponent_name": full.get(f.opponent_team, "?"),
             "home": bool(f.was_home), "kickoff_time": pd.Timestamp(f.kickoff_time).isoformat(),
             "xg_for": r3(f.xg_for), "xg_against": r3(f.xg_against), "cs_chance": r3(f.cs_chance),
             "attack": r3(f.attack), "defence": r3(f.defence), "overall": r3(f.overall)}
            for f in mine[mine.GW == gw].itertuples()]} for gw in fd.gameweeks]
        teams.append({"id": int(t.id), "short_name": t.short_name, "name": t.name,
                      "code": None if pd.isna(t.code) else int(t.code),
                      "strength": {"attack": r3(t.attack), "defence": r3(t.defence), "matches": int(t.matches)},
                      "totals": {m: r3(totals.at[t.id, m]) for m in MODES}, "gameweeks": cells})
    return {"gameweeks": list(fd.gameweeks), "league_xg": r3(fd.league_xg), "home_factor": r3(fd.home_factor),
            "half_life": HALF_LIFE, "prior_matches": PRIOR_MATCHES, "teams": teams}
