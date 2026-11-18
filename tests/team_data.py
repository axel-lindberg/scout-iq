"""Small synthetic FPL universe for team tests: a 15-player squad plus a few players to buy."""

from __future__ import annotations

import pandas as pd

from scout_iq.upcoming import Upcoming

GAMEWEEKS = [11, 12]


def universe(extra: list[tuple] | None = None, squad: list[tuple] | None = None):
    """(players, by_gw, squad ids). A player = (id, web_name, position, team_id, price, [xpts per GW], status, chance, news)."""
    if squad is None:
        squad = (
            [(1, "Gk1", "GK", 1, 5.0, [2, 2]), (2, "Gk2", "GK", 2, 4.0, [2, 2])]
            + [(10 + i, f"Def{i}", "DEF", 3 + i, 5.0, [2, 2]) for i in range(5)]
            + [(20 + i, f"Mid{i}", "MID", 3 + i, 6.0, [2, 2]) for i in range(4)]
            + [(24, "WeakMid", "MID", 8, 6.0, [0.5, 0.5])]
            + [(30 + i, f"Fwd{i}", "FWD", 9 + i, 6.0, [2, 2]) for i in range(3)]
        )
    rows = [(*p, "a", None, "") if len(p) == 6 else p for p in squad + (extra or [])]
    players = pd.DataFrame(rows, columns=["element", "web_name", "position", "team_id", "price", "xpts",
                                          "status", "chance_of_playing_next_round", "news"])
    players["name"] = players["web_name"] + " Fullname"
    players["team_short"] = "T" + players["team_id"].astype(str)
    players["team_name"] = "Team " + players["team_id"].astype(str)
    players["status_text"] = players["status"].map({"a": "available", "d": "doubtful", "i": "injured"})
    by_gw = pd.DataFrame([
        {"element": r.element, "GW": gw, "xpts": float(x), "xpts_adjusted": float(x), "chance_of_playing": 100.0,
         "fixtures": "" if x == 0 else "T99 (H)", "n_fixtures": 0 if x == 0 else 1}
        for r in players.itertuples() for gw, x in zip(GAMEWEEKS, r.xpts)])
    return players.drop(columns="xpts"), by_gw, [p[0] for p in squad]


def upcoming(extra=None, squad=None) -> tuple[Upcoming, list[int]]:
    players, by_gw, ids = universe(extra, squad)
    nxt = by_gw[by_gw.GW == GAMEWEEKS[0]].set_index("element")
    tot = by_gw.groupby("element")["xpts_adjusted"].sum()
    pred = players.copy()
    pred["xpts"] = pred["element"].map(nxt["xpts"])
    pred["xpts_adjusted"] = pred["xpts"]
    pred["chance_of_playing"] = 100
    pred["fixtures"] = pred["element"].map(nxt["fixtures"])
    pred["xpts_horizon_adjusted"] = pred["element"].map(tot)
    for c in ("pts_last5", "mins_last3", "xgi_last5", "pts_season", "games"):
        pred[c] = 1.0
    pred = pred.sort_values("xpts_adjusted", ascending=False).reset_index(drop=True)
    up = Upcoming("2026-27", GAMEWEEKS[0], pd.Timestamp("2026-11-21", tz="UTC"), pred, players,
                  last_played_gw=10, gameweeks=list(GAMEWEEKS), by_gw=by_gw)
    return up, ids
