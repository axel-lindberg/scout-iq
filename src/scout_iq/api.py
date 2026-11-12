"""FastAPI backend: predictions, comparisons, news search and chat with the agent.

    python scripts/serve.py            # http://localhost:8000

`create_app()` takes its dependencies as arguments so tests can pass fakes instead of the
real model and OpenAI client.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Callable

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .data import ROOT
from .tools import ScoutTools
from .upcoming import Upcoming

STATIC = Path(__file__).resolve().parent / "static"
MAX_SESSIONS = 200


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    session_id: str | None = None


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    tools: list[dict]


def _model_card() -> dict:
    """Headline evaluation numbers from Day 2, read from results/ if they exist."""
    scores, picks = ROOT / "results" / "day2_scores.csv", ROOT / "results" / "day2_picks.csv"
    if not scores.exists():
        return {}
    s = pd.read_csv(scores)
    s = s[s.subset == "relevant"].set_index("method")
    card = {"test_season": "2025-26", "evaluation": "walk-forward, retrained before every gameweek",
            "mae": {m: round(float(s.loc[m, "MAE"]), 3) for m in s.index}}
    if picks.exists():
        p = pd.read_csv(picks).set_index("method")
        card["captain_points_per_gw"] = {m: round(float(p.loc[m, "captain_pts_per_GW"]), 2) for m in p.index}
    return card


def create_app(upcoming: Upcoming, tools: ScoutTools,
               agent_factory: Callable[[], object] | None) -> FastAPI:
    app = FastAPI(title="scout-iq", version="1.0")
    sessions: dict[str, object] = {}
    card = _model_card()

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/status")
    def status():
        return {"season": upcoming.season, "gameweek": upcoming.gameweek,
                "first_kickoff": upcoming.deadline.isoformat(),
                "data_through_gw": upcoming.last_played_gw,
                "chat_available": agent_factory is not None,
                "news_available": tools.news is not None, "model_card": card}

    @app.get("/api/predictions")
    def predictions(position: str | None = None, max_price: float | None = Query(None, gt=0),
                    team: str | None = None, top_n: int = Query(20, ge=1, le=30),
                    include_unavailable: bool = False):
        return tools.get_predictions(position, max_price, team, top_n, include_unavailable)

    @app.get("/api/compare")
    def compare(names: list[str] = Query(..., min_length=1, max_length=6)):
        return tools.compare_players(names)

    @app.get("/api/news")
    def news(q: str = Query(..., min_length=2), top_k: int = Query(5, ge=1, le=10)):
        if tools.news is None:
            raise HTTPException(503, "News search needs OPENAI_API_KEY.")
        return tools.get_news(q, top_k)

    @app.post("/api/chat", response_model=ChatResponse)
    def chat(req: ChatRequest):
        if agent_factory is None:
            raise HTTPException(503, "Chat needs OPENAI_API_KEY in .env.")
        sid = req.session_id if req.session_id in sessions else uuid.uuid4().hex
        if sid not in sessions:
            if len(sessions) >= MAX_SESSIONS:          # simple cap: forget the oldest conversation
                sessions.pop(next(iter(sessions)))
            sessions[sid] = agent_factory()
        agent = sessions[sid]
        try:
            answer = agent.ask(req.message)
        except Exception as e:                          # OpenAI down, bad key, rate limit...
            raise HTTPException(502, f"The language model call failed: {type(e).__name__}") from e
        return ChatResponse(session_id=sid, answer=answer, tools=agent.trace)

    return app


def build_default_app() -> FastAPI:
    """Real app: model predictions + OpenAI (if a key is configured)."""
    import os

    from dotenv import load_dotenv

    from .agent import ScoutAgent
    from .news import NewsIndex
    from .upcoming import predict_next_gameweek

    load_dotenv(ROOT / ".env")
    up = predict_next_gameweek()
    if os.getenv("OPENAI_API_KEY"):
        from openai import OpenAI
        client = OpenAI()
        tools = ScoutTools(up, NewsIndex.build(up.players, client))
        return create_app(up, tools, lambda: ScoutAgent(tools, client))
    return create_app(up, ScoutTools(up), None)
