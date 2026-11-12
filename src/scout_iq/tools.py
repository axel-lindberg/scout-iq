"""The tools the LLM agent can call, plus their JSON schemas for OpenAI tool calling.

Each tool is a plain Python function returning small JSON-friendly data. The LLM never
sees the model or the data directly; it asks through these tools and reads the answers.
"""

from __future__ import annotations

import re
import unicodedata

import pandas as pd
from rapidfuzz import fuzz

from .news import NewsIndex
from .upcoming import Upcoming

POSITIONS = ["GK", "DEF", "MID", "FWD"]
FUZZY_CUTOFF = 85  # high on purpose: "Salah" must not silently become "Salia"


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

    # ---- helpers -------------------------------------------------------------
    def _row(self, r: pd.Series) -> dict:
        return {
            "name": r["web_name"], "full_name": r["name"], "team": r["team_short"], "position": r["position"],
            "price": r["price"], "fixtures": r["fixtures"],
            "expected_points": round(float(r["xpts"]), 2),
            "expected_points_adjusted": round(float(r["xpts_adjusted"]), 2),
            "chance_of_playing": int(r["chance_of_playing"]),
            "status": r["status_text"], "news": r["news"] or None,
        }

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
                        team: str | None = None, top_n: int = 10, include_unavailable: bool = False) -> dict:
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
        d = d.sort_values("xpts_adjusted", ascending=False)
        return {"gameweek": self.up.gameweek, "season": self.up.season,
                "players": [self._row(r) for _, r in d.head(max(1, min(top_n, 30))).iterrows()]}

    def compare_players(self, names: list[str]) -> dict:
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
            row = self._row(r)
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

    def call(self, name: str, args: dict) -> dict:
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
        }},
    }},
    {"type": "function", "function": {
        "name": "compare_players",
        "description": ("Side-by-side comparison of named players: expected points, fixtures, price, "
                        "availability and recent form. Use for transfer and captain choices between players."),
        "parameters": {"type": "object", "properties": {
            "names": {"type": "array", "items": {"type": "string"}, "description": "Player names, 2-6"},
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
]
