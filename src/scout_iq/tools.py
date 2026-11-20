"""The tools the LLM agent can call, plus their JSON schemas for OpenAI tool calling.

Each tool is a plain Python function returning small JSON-friendly data. The LLM never
sees the model or the data directly; it asks through these tools and reads the answers.
"""

from __future__ import annotations

import re
import unicodedata

import pandas as pd
from rapidfuzz import fuzz

from . import team as team_mod
from .news import NewsIndex
from .upcoming import Upcoming

POSITIONS = ["GK", "DEF", "MID", "FWD"]
FUZZY_CUTOFF = 85  # high on purpose: "Salah" must not silently become "Salia"

LIMITATIONS = [
    "Selling prices aren't in the public FPL API (FPL keeps half of any price rise), so players are "
    "valued at today's price. Your real budget can be a little lower: edit the bank if you know it.",
    "Free transfers are estimated from your transfer history; override the number if the FPL app differs. "
    "Each transfer beyond the free ones costs 4 points.",
    "Transfers made since the last deadline aren't public until the next deadline, so the squad is the "
    "one FPL showed at the last deadline.",
    "Gameweeks further ahead are less certain: they use each player's form as of today.",
    "Bench points and automatic substitutions are ignored: the best XI is picked again every gameweek.",
]



def _team_code(r: pd.Series) -> int | None:
    """FPL team code (for shirt images), None if unknown."""
    code = r.get("team_code")
    return None if code is None or pd.isna(code) else int(code)

class TeamError(ValueError):
    """The squad breaks the rules; .errors lists why."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return s.lower().strip()


def _tokens(s: str) -> set[str]:
    return {t for t in re.split(r"[\s.\-']+", _norm(s)) if t}


class ScoutTools:
    def __init__(self, upcoming: Upcoming, news: NewsIndex | None = None):
        self.up = upcoming
        self.news = news
        self.df = upcoming.predictions
        self.gameweeks = list(upcoming.gameweeks)
        # element -> [{gameweek, fixtures, xpts...}, ...] in gameweek order
        self.by_gw: dict[int, list[dict]] = {}
        for r in upcoming.by_gw.sort_values(["element", "GW"]).itertuples(index=False):
            self.by_gw.setdefault(int(r.element), []).append({
                "gameweek": int(r.GW), "fixtures": r.fixtures,
                "expected_points": round(float(r.xpts), 2),
                "expected_points_adjusted": round(float(r.xpts_adjusted), 2),
            })

    _pool: team_mod.Pool | None = None

    @property
    def pool(self) -> team_mod.Pool:
        if self._pool is None:
            self._pool = team_mod.build_pool(self.up.players, self.up.by_gw, self.gameweeks)
        return self._pool

    def _horizon(self, horizon: int | None) -> int:
        return max(1, min(int(horizon or 1), len(self.gameweeks)))

    # ---- helpers -------------------------------------------------------------
    def _row(self, r: pd.Series, horizon: int = 1) -> dict:
        row = {
            "name": r["web_name"], "full_name": r["name"], "team": r["team_short"], "position": r["position"],
            "price": r["price"], "fixtures": r["fixtures"],
            "expected_points": round(float(r["xpts"]), 2),
            "expected_points_adjusted": round(float(r["xpts_adjusted"]), 2),
            "chance_of_playing": int(r["chance_of_playing"]),
            "status": r["status_text"], "news": r["news"] or None,
        }
        if horizon > 1:  # only when asked for, so the default response keeps its shape
            gws = self.player_gameweeks(int(r["element"]), horizon)
            row["gameweeks"] = gws
            row["expected_points_horizon_adjusted"] = round(sum(g["expected_points_adjusted"] for g in gws), 2)
        return row

    def player_gameweeks(self, element: int, horizon: int | None = None) -> list[dict]:
        """Per-gameweek fixtures and expected points for the first `horizon` gameweeks (0 if blank)."""
        known = {g["gameweek"]: g for g in self.by_gw.get(element, [])}
        blank = {"fixtures": "", "expected_points": 0.0, "expected_points_adjusted": 0.0}
        return [known.get(gw, {"gameweek": gw, **blank})
                for gw in self.gameweeks[:self._horizon(horizon or len(self.gameweeks))]]

    def find_player(self, name: str) -> dict:
        """Resolve a name the user typed to one player.

        1. Exact words: every word of the query appears in the player's short or full name
           ("bruno", "Bukayo Saka", "B.Fernandes").
        2. Otherwise fuzzy match for typos ("haland"), with a high cutoff.
        Returns {"row": ...} for one match, {"options": [...]} if ambiguous, or {} if none.
        """
        q = _tokens(name)
        if not q:
            return {}
        exact = [i for i, r in self.df.iterrows()
                 if q <= (_tokens(r["web_name"]) | _tokens(r["name"]))]
        if len(exact) == 1:
            return {"row": self.df.loc[exact[0]]}
        if len(exact) > 1:
            return {"options": self._options(exact)}

        qn = _norm(name)
        scored = []
        for i, r in self.df.iterrows():
            words = _tokens(r["web_name"]) | _tokens(r["name"])
            score = max([fuzz.ratio(qn, _norm(r["web_name"])), fuzz.ratio(qn, _norm(r["name"]))]
                        + [fuzz.ratio(qn, w) for w in words])
            scored.append((score, i))
        scored.sort(reverse=True)
        best = [i for sc, i in scored if sc >= FUZZY_CUTOFF]
        if not best:
            return {}
        if len(best) > 1 and scored[0][0] - scored[1][0] < 3:
            return {"options": self._options(best[:5])}
        return {"row": self.df.loc[best[0]]}

    def _options(self, idx: list) -> list[str]:
        d = self.df.loc[idx].sort_values("xpts_adjusted", ascending=False).head(5)
        return [f"{r.web_name} ({r.team_short}, {r.position}, \u00a3{r.price}m)" for _, r in d.iterrows()]

    # ---- tools ---------------------------------------------------------------
    def get_predictions(self, position: str | None = None, max_price: float | None = None,
                        team: str | None = None, top_n: int = 10, include_unavailable: bool = False,
                        horizon: int = 1, rank_by: str = "next") -> dict:
        horizon = self._horizon(horizon)
        d = self.df
        if position:
            d = d[d["position"] == position.upper()]
        if max_price is not None:
            d = d[d["price"] <= max_price]
        if team:
            t = team.lower()
            d = d[(d["team_short"].str.lower() == t) | d["team_name"].str.lower().str.contains(t)]
        if not include_unavailable:
            d = d[d["chance_of_playing"] > 0]
        if horizon > 1 and rank_by == "horizon":
            totals = {e: sum(g["expected_points_adjusted"] for g in self.player_gameweeks(e, horizon))
                      for e in d["element"]}
            d = d.assign(_rank=d["element"].map(totals)).sort_values("_rank", ascending=False, kind="stable")
        else:
            d = d.sort_values("xpts_adjusted", ascending=False, kind="stable")
        res = {"gameweek": self.up.gameweek, "season": self.up.season,
               "players": [self._row(r, horizon) for _, r in d.head(max(1, min(top_n, 30))).iterrows()]}
        if horizon > 1:
            res["gameweeks"] = self.gameweeks[:horizon]
        return res

    def compare_players(self, names: list[str], horizon: int = 1) -> dict:
        out, missing, ambiguous = [], [], {}
        for n in names[:6]:
            hit = self.find_player(n)
            if "options" in hit:
                ambiguous[n] = hit["options"]
                continue
            if "row" not in hit:
                missing.append(n)
                continue
            r = hit["row"]
            row = self._row(r, self._horizon(horizon))
            row["recent_form"] = {
                "avg_points_last5": None if pd.isna(r["pts_last5"]) else round(float(r["pts_last5"]), 2),
                "avg_minutes_last3": None if pd.isna(r["mins_last3"]) else round(float(r["mins_last3"]), 1),
                "avg_xgi_last5": None if pd.isna(r["xgi_last5"]) else round(float(r["xgi_last5"]), 2),
                "season_avg_points": None if pd.isna(r["pts_season"]) else round(float(r["pts_season"]), 2),
                "matches_played": int(r["games"]) if not pd.isna(r["games"]) else 0,
            }
            out.append(row)
        res = {"gameweek": self.up.gameweek, "players": out}
        if ambiguous:
            res["ambiguous"] = ambiguous  # ask the user which one they mean
        if missing:
            res["not_found"] = missing    # not in this season's squads (left the league, or a typo)
        return res

    def get_news(self, query: str, top_k: int = 5) -> dict:
        if self.news is None:
            return {"error": "News search is unavailable (no OpenAI client)."}
        return {"results": self.news.search(query, top_k=min(top_k, 10))}

    # ---- my team ----------------------------------------------------------------
    def player_list(self) -> list[dict]:
        """Every player, for picking a squad by hand."""
        info = self.pool.info
        out = []
        for e, r in info.iterrows():
            x = self.pool.xpts[self.pool.row[e]]
            out.append({"id": int(e), "name": r["web_name"], "full_name": r["name"], "team": r["team_short"],
                        "team_code": _team_code(r), "position": r["position"], "price": float(r["price"]),
                        "status": r.get("status_text", r.get("status", "")),
                        "availability": team_mod.availability_flag(r),
                        "expected_points": [round(float(v), 2) for v in x],
                        "fixtures": [g["fixtures"] for g in self.player_gameweeks(int(e))],
                        "expected_points_horizon_adjusted": round(float(x.sum()), 2)})
        return sorted(out, key=lambda p: (-p["expected_points_horizon_adjusted"], p["id"]))

    def _brief(self, e: int, horizon: int) -> dict:
        r = self.pool.info.loc[e]
        x = self.pool.xpts[self.pool.row[e], :horizon]
        chance = team_mod.availability_flag(r)
        return {"id": int(e), "name": r["web_name"], "team": r["team_short"], "team_code": _team_code(r),
                "position": r["position"],
                "price": float(r["price"]), "availability": chance, "news": r.get("news") or None,
                "expected_points": [round(float(v), 2) for v in x],
                "expected_points_horizon_adjusted": round(float(x.sum()), 2)}

    def analyze_team(self, player_ids: list[int], bank: float, free_transfers: int, horizon: int | None = None,
                     include_pairs: bool = True, top_n: int = 10, allow_club_overflow: bool = False) -> dict:
        """Best XI, captain, weakest players and transfer suggestions for a squad (see team.py)."""
        pool = self.pool
        ids = [int(e) for e in player_ids]
        errors = team_mod.validate_squad(pool.info, ids)
        warnings = []
        if allow_club_overflow:   # FPL lets a squad keep 4 from a club after a player moves there
            warnings = [e for e in errors if e.startswith("At most")]
            errors = [e for e in errors if not e.startswith("At most")]
        if errors:
            raise TeamError(errors)
        h = self._horizon(horizon or len(self.gameweeks))
        a = team_mod.analyze_squad(pool, ids, float(bank), int(free_transfers), horizon=h, top_n=top_n,
                                   pairs=include_pairs)
        lineup = a["lineup"]
        squad = []
        for p in a["players"]:
            e = p["element"]
            r = pool.info.loc[e]
            gws = self.player_gameweeks(e, h)
            squad.append({
                **self._brief(e, h), "full_name": r["name"],
                "chance_of_playing": int(team_mod.chance_or_default(r)),
                "status": r.get("status_text", ""),
                "gameweeks": gws,
                "in_xi": p["in_xi"], "bench_order": p["bench_order"],
                "is_captain": p["is_captain"], "is_vice_captain": p["is_vice_captain"],
            })
        order = {e: n for n, e in enumerate(lineup.starters + lineup.bench)}
        squad.sort(key=lambda s: order[s["id"]])
        by_id = {s["id"]: s for s in squad}
        weakest = []
        for e in a["weakest"]:
            s = by_id[e]
            reason = {"out": "unavailable", "doubtful": "doubtful"}.get(s["availability"], "low expected points")
            weakest.append({"id": e, "name": s["name"], "reason": reason,
                            "expected_points_horizon_adjusted": s["expected_points_horizon_adjusted"]})

        def lineup_out(gw, lu):
            return {"gameweek": gw, "formation": lu.formation, "starters": lu.starters, "bench": lu.bench,
                    "captain": lu.captain, "vice_captain": lu.vice_captain,
                    "expected_points": round(lu.points, 2)}

        def move(c):
            return {"out": [self._brief(e, h) for e in c["out"]], "in": [self._brief(e, h) for e in c["in"]],
                    "gain_per_gameweek": [round(float(v), 2) for v in c["per_gw"]],
                    "gain": round(c["gain"], 2), "hits": c["hits"], "net_gain": round(c["net_gain"], 2),
                    "bank_after": round(c["bank_after"], 1)}

        return {
            "gameweeks": a["gameweeks"], "bank": round(float(bank), 1), "free_transfers": int(free_transfers),
            "squad": squad,
            "lineup": lineup_out(a["gameweeks"][0], lineup),
            "lineups": [lineup_out(gw, lu) for gw, lu in zip(a["gameweeks"], a["lineups"])],
            "squad_expected_points": [round(v, 2) for v in a["squad_points_per_gw"]],
            "weakest": weakest,
            "transfers": [move(c) for c in a["singles"]],
            "transfer_pairs": [move(c) for c in a["pairs"]],
            "warnings": warnings, "limitations": LIMITATIONS,
        }

    def analyze_my_team(self, team: dict | None, horizon: int | None = None, include_pairs: bool = True) -> dict:
        """The agent's view of analyze_team: names instead of ids, top suggestions only."""
        if not team or not team.get("player_ids"):
            return {"error": "No team loaded. Ask the user to load their team on the My team page first "
                             "(FPL team ID or picked by hand)."}
        try:
            a = self.analyze_team(team["player_ids"], team.get("bank", 0.0), team.get("free_transfers", 1),
                                  horizon=horizon, include_pairs=include_pairs, top_n=5,
                                  allow_club_overflow=True)
        except TeamError as e:
            return {"error": f"The loaded team isn't a valid squad: {e}"}
        names = {s["id"]: s["name"] for s in a["squad"]}
        lu = a["lineup"]

        def move(m):
            return {"sell": [p["name"] for p in m["out"]], "buy": [f"{p['name']} ({p['team']}, £{p['price']}m)"
                                                                    for p in m["in"]],
                    "gain_per_gameweek": m["gain_per_gameweek"], "hits": m["hits"], "net_gain": m["net_gain"],
                    "bank_after": m["bank_after"]}

        return {
            "team_name": team.get("team_name"), "gameweeks": a["gameweeks"], "bank": a["bank"],
            "free_transfers": a["free_transfers"],
            "next_gameweek": {"formation": lu["formation"], "captain": names[lu["captain"]],
                              "vice_captain": names[lu["vice_captain"]],
                              "starting_xi": [names[e] for e in lu["starters"]],
                              "bench_in_order": [names[e] for e in lu["bench"]],
                              "expected_points": lu["expected_points"]},
            "squad": [{"name": s["name"], "team": s["team"], "position": s["position"], "price": s["price"],
                       "expected_points_per_gameweek": s["expected_points"],
                       "expected_points_total": s["expected_points_horizon_adjusted"],
                       "availability": s["availability"], "news": s["news"]} for s in a["squad"]],
            "weakest": a["weakest"],
            "best_single_transfers": [move(m) for m in a["transfers"]],
            "best_double_transfers": [move(m) for m in a["transfer_pairs"][:3]],
            "notes": a["warnings"] + ["Gains are expected points over the horizon minus 4 per extra transfer; "
                                      "prices are today's (selling prices may be lower)."],
        }

    def call(self, name: str, args: dict, team: dict | None = None) -> dict:
        if name == "analyze_my_team":
            try:
                return self.analyze_my_team(team, **args)
            except TypeError as e:
                return {"error": f"Bad arguments for {name}: {e}"}
        fn = {"get_predictions": self.get_predictions, "compare_players": self.compare_players,
              "get_news": self.get_news}.get(name)
        if fn is None:
            return {"error": f"Unknown tool {name}"}
        try:
            return fn(**args)
        except TypeError as e:  # the LLM sent bad arguments; tell it so it can retry
            return {"error": f"Bad arguments for {name}: {e}"}


TOOL_SCHEMAS = [
    {"type": "function", "function": {
        "name": "get_predictions",
        "description": ("Ranked expected FPL points for the upcoming gameweek from the LightGBM model, "
                        "adjusted by each player's chance of playing. Use for 'best players', 'who to "
                        "captain', 'best defenders under £5m', etc."),
        "parameters": {"type": "object", "properties": {
            "position": {"type": "string", "enum": POSITIONS},
            "max_price": {"type": "number", "description": "Maximum price in £m, e.g. 6.5"},
            "team": {"type": "string", "description": "Team name or short name, e.g. 'Arsenal' or 'ARS'"},
            "top_n": {"type": "integer", "description": "How many players to return (default 10, max 30)"},
            "include_unavailable": {"type": "boolean", "description": "Include injured/suspended players"},
            "horizon": {"type": "integer", "description": (
                "Gameweeks ahead to include, 1-5 (default 1 = next gameweek only). With more, each "
                "player gets per-gameweek fixtures and expected points. Use for transfers and planning.")},
            "rank_by": {"type": "string", "enum": ["next", "horizon"],
                        "description": "Rank by the next gameweek (default) or the total over the horizon"},
        }},
    }},
    {"type": "function", "function": {
        "name": "compare_players",
        "description": ("Side-by-side comparison of named players: expected points, fixtures, price, "
                        "availability and recent form. Use for transfer and captain choices between players."),
        "parameters": {"type": "object", "properties": {
            "names": {"type": "array", "items": {"type": "string"}, "description": "Player names, 2-6"},
            "horizon": {"type": "integer", "description": "Gameweeks ahead to include, 1-5 (default 1)"},
        }, "required": ["names"]},
    }},
    {"type": "function", "function": {
        "name": "get_news",
        "description": ("Search the latest official FPL injury and availability news. Use when asked "
                        "about injuries, doubts, suspensions or whether someone will play."),
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "What to look for, e.g. 'Arsenal defenders injured'"},
            "top_k": {"type": "integer", "description": "Number of news items (default 5)"},
        }, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "analyze_my_team",
        "description": ("Analyse the user's own FPL squad (loaded in the app): best starting XI for the next "
                        "gameweek, captain and vice-captain, bench order, each player's expected points per "
                        "gameweek, weakest players, and the best transfers within budget ranked by expected "
                        "points gained over the horizon minus 4-point hits. Use for any question about 'my "
                        "team': who to sell, who to captain, who to bench, which transfer to make."),
        "parameters": {"type": "object", "properties": {
            "horizon": {"type": "integer", "description": "Gameweeks to plan over, 1-5 (default 5)"},
            "include_pairs": {"type": "boolean", "description": "Also suggest two transfers together (default true)"},
        }},
    }},
]
