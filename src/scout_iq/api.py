"""FastAPI backend: predictions, comparisons, news search and chat with the agent.

    python scripts/serve.py            # http://localhost:8000

`create_app()` takes its dependencies as arguments so tests can pass fakes instead of the
real model and OpenAI client.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Callable, Literal

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from .data import ROOT
from .tools import ScoutTools
from .upcoming import HORIZON, Upcoming

FRONTEND_DIST = ROOT / "frontend" / "dist"   # built by `npm run build` in frontend/
MAX_SESSIONS = 200
BACKEND_PATHS = ("/api", "/docs", "/redoc", "/openapi.json")  # never answered with the web app

NOT_BUILT_PAGE = """<!doctype html><meta charset="utf-8"><title>scout-iq</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1>scout-iq: the web app isn't built yet</h1>
<p>The API is running (<a href="/docs">API docs</a>), but <code>frontend/dist/</code> doesn't exist. Build it once:</p>
<pre>cd frontend
npm ci
npm run build</pre>
<p>then reload this page. For development, run <code>npm run dev</code> in <code>frontend/</code> instead
and open <a href="http://localhost:5173">http://localhost:5173</a>.</p>
</body>"""


# ---- response models ----------------------------------------------------------
# These describe the dicts the tools already return, so /openapi.json documents every response
# and the frontend can generate its TypeScript types from it. Routes use
# response_model_exclude_unset=True: a key the tools leave out (e.g. "ambiguous") stays out,
# so the JSON is exactly what it was before the models existed.

class ModelCard(BaseModel):
    """Headline evaluation numbers; empty ({}) until scripts/train_evaluate.py has been run."""
    test_season: str | None = None
    evaluation: str | None = None
    mae: dict[str, float] | None = Field(None, description="MAE per method, e.g. 'LightGBM'")
    captain_points_per_gw: dict[str, float] | None = None


class StatusResponse(BaseModel):
    season: str
    gameweek: int
    first_kickoff: str = Field(description="ISO 8601 timestamp of the gameweek's first kickoff")
    data_through_gw: int = Field(description="Latest gameweek with results in the data")
    horizon_gameweeks: list[int] = Field(description="Gameweeks with predictions, the next one first")
    chat_available: bool
    news_available: bool
    model_card: ModelCard


class GameweekPrediction(BaseModel):
    gameweek: int
    fixtures: str = Field(description="e.g. 'ARS (H)', 'ARS (H), CHE (A)' in a double gameweek, '' if blank")
    expected_points: float
    expected_points_adjusted: float


class Player(BaseModel):
    name: str
    full_name: str
    team: str
    position: str
    price: float
    fixtures: str
    expected_points: float
    expected_points_adjusted: float = Field(description="expected_points x chance of playing")
    chance_of_playing: int
    status: str
    news: str | None
    gameweeks: list[GameweekPrediction] | None = Field(
        None, description="Per-gameweek predictions, only when horizon > 1. Later ones are less certain.")
    expected_points_horizon_adjusted: float | None = Field(
        None, description="Sum of expected_points_adjusted over the horizon, only when horizon > 1")


class PredictionsResponse(BaseModel):
    gameweek: int
    season: str
    players: list[Player]
    gameweeks: list[int] | None = Field(None, description="The horizon's gameweeks, only when horizon > 1")


class RecentForm(BaseModel):
    avg_points_last5: float | None
    avg_minutes_last3: float | None
    avg_xgi_last5: float | None
    season_avg_points: float | None
    matches_played: int


class ComparedPlayer(Player):
    recent_form: RecentForm


class CompareResponse(BaseModel):
    gameweek: int
    players: list[ComparedPlayer]
    ambiguous: dict[str, list[str]] | None = Field(
        None, description="Names that match several players -> up to 5 candidates each. Absent if none.")
    not_found: list[str] | None = Field(None, description="Names that match no player. Absent if none.")


class ToolCall(BaseModel):
    tool: str
    args: Any = Field(description="Arguments the agent passed (normally an object)")


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    session_id: str | None = None


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    tools: list[ToolCall]


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


def _frontend_file(dist: Path, path: str) -> Response:
    """A file from the built frontend, or index.html so the browser-side router can show the page.

    Vite puts content-hashed files in assets/ (a new name whenever they change), so those can be
    cached forever; index.html must be revalidated so a rebuild shows up on the next reload.
    """
    index = dist / "index.html"
    if not index.is_file():
        return HTMLResponse(NOT_BUILT_PAGE)
    root = dist.resolve()
    target = (root / path.lstrip("/")).resolve()
    if path.strip("/") and target.is_file() and target.is_relative_to(root):   # no ../ escapes
        cache = "public, max-age=31536000, immutable" if target.parent == root / "assets" else "no-cache"
        return FileResponse(target, headers={"Cache-Control": cache})
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


def create_app(upcoming: Upcoming, tools: ScoutTools,
               agent_factory: Callable[[], object] | None,
               frontend_dist: Path = FRONTEND_DIST) -> FastAPI:
    app = FastAPI(title="scout-iq", version="1.0")
    sessions: dict[str, object] = {}
    card = _model_card()

    @app.get("/", include_in_schema=False)
    def index():
        return _frontend_file(frontend_dist, "")

    # The web app is served from the 404 handler instead of a catch-all route, so the API's own
    # responses don't change at all: a wrong method on an API route is still 405, unknown /api
    # paths are still a JSON 404, and only requests no route matched at all reach the frontend.
    @app.exception_handler(StarletteHTTPException)
    async def frontend_or_error(request: Request, exc: StarletteHTTPException):
        path = request.url.path
        is_backend = any(path == p or path.startswith(p + "/") for p in BACKEND_PATHS)
        if exc.status_code == 404 and request.method in ("GET", "HEAD") and not is_backend:
            return _frontend_file(frontend_dist, path)
        return await http_exception_handler(request, exc)

    @app.get("/api/status", response_model=StatusResponse, response_model_exclude_unset=True)
    def status():
        return {"season": upcoming.season, "gameweek": upcoming.gameweek,
                "first_kickoff": upcoming.deadline.isoformat(),
                "data_through_gw": upcoming.last_played_gw,
                "horizon_gameweeks": list(upcoming.gameweeks),
                "chat_available": agent_factory is not None,
                "news_available": tools.news is not None, "model_card": card}

    @app.get("/api/predictions", response_model=PredictionsResponse, response_model_exclude_unset=True)
    def predictions(position: str | None = None, max_price: float | None = Query(None, gt=0),
                    team: str | None = None, top_n: int = Query(20, ge=1, le=30),
                    include_unavailable: bool = False,
                    horizon: int = Query(1, ge=1, le=HORIZON, description="Gameweeks ahead (1 = next only)"),
                    rank_by: Literal["next", "horizon"] = "next"):
        return tools.get_predictions(position, max_price, team, top_n, include_unavailable, horizon, rank_by)

    @app.get("/api/compare", response_model=CompareResponse, response_model_exclude_unset=True)
    def compare(names: list[str] = Query(..., min_length=1, max_length=6),
                horizon: int = Query(1, ge=1, le=HORIZON)):
        return tools.compare_players(names, horizon)

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
