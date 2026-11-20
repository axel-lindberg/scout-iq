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

from . import fpl_api
from .data import ROOT
from .difficulty import to_records as difficulty_records
from .tools import ScoutTools, TeamError
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


class TeamContext(BaseModel):
    """The user's squad, sent with chat messages so the agent can analyse it."""
    player_ids: list[int] = Field(min_length=15, max_length=15)
    bank: float = Field(0.0, ge=0, le=100, description="£m")
    free_transfers: int = Field(1, ge=0, le=5)
    team_name: str | None = Field(None, max_length=60)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    session_id: str | None = None
    team: TeamContext | None = Field(None, description="The user's squad from the My team page, if loaded")


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    tools: list[ToolCall]


# ---- my team -----------------------------------------------------------------------

def _team_code_field():
    return Field(None, description="FPL team code (not the team id): the key for shirt images")


class SquadPlayerBrief(BaseModel):
    id: int
    name: str
    team: str
    team_code: int | None = _team_code_field()
    position: str
    price: float = Field(description="Today's price in £m (selling prices aren't public)")
    availability: Literal["fit", "doubtful", "out"]
    news: str | None
    expected_points: list[float] = Field(description="Per horizon gameweek, chance-of-playing adjusted")
    expected_points_horizon_adjusted: float


class SquadPlayer(SquadPlayerBrief):
    full_name: str
    chance_of_playing: int
    status: str
    gameweeks: list[GameweekPrediction]
    in_xi: bool
    bench_order: int | None = Field(description="1 = first on the bench (the reserve GK), None if starting")
    is_captain: bool
    is_vice_captain: bool


class LineupOut(BaseModel):
    gameweek: int
    formation: str = Field(description="DEF-MID-FWD, e.g. '4-4-2'")
    starters: list[int]
    bench: list[int] = Field(description="In order: reserve GK first, then outfield by expected points")
    captain: int
    vice_captain: int
    expected_points: float = Field(description="XI total with the captain counted twice")


class PerfectTeamOut(BaseModel):
    gameweek: int
    player_ids: list[int] = Field(description="The best possible 15 for this gameweek (GK, DEF, MID, FWD)")
    starters: list[int]
    captain: int
    cost: float = Field(description="£m, at most `perfect_budget`")
    expected_points: float = Field(description="XI + captain again: the 100% mark for a gameweek score")


class WeakPlayer(BaseModel):
    id: int
    name: str
    reason: Literal["unavailable", "doubtful", "low expected points"]
    expected_points_horizon_adjusted: float


class TransferOut(BaseModel):
    out: list[SquadPlayerBrief]
    in_: list[SquadPlayerBrief] = Field(alias="in")
    gain_per_gameweek: list[float]
    gain: float = Field(description="Expected points gained over the horizon, before hits")
    hits: int = Field(description="Points deducted: 4 per transfer beyond the free ones")
    net_gain: float
    bank_after: float


class EntryInfo(BaseModel):
    team_id: int
    team_name: str
    overall_rank: int | None
    picks_gameweek: int
    captain: int | None
    vice_captain: int | None
    bank: float
    squad_value: float
    free_transfers: int = Field(description="Estimate for the next gameweek")
    free_transfers_note: str
    active_chip: str | None
    chips_used: list[dict[str, Any]]
    notes: list[str]


class TeamAnalysis(BaseModel):
    source: Literal["fpl", "manual"]
    entry: EntryInfo | None = Field(None, description="The FPL team, when loaded by team ID")
    player_ids: list[int]
    gameweeks: list[int]
    bank: float
    free_transfers: int
    squad: list[SquadPlayer] = Field(description="Starters (GK, DEF, MID, FWD) then the bench in order")
    lineup: LineupOut = Field(description="Best XI for the next gameweek (= lineups[0])")
    lineups: list[LineupOut] = Field(description="Best XI for each gameweek in the horizon")
    squad_expected_points: list[float] = Field(description="Best XI + captain, per gameweek")
    perfect_budget: float = Field(description="£100m, or the squad's value + bank if that is more")
    perfect_teams: list[PerfectTeamOut] = Field(description="Best possible squad under FPL rules, per gameweek")
    weakest: list[WeakPlayer]
    transfers: list[TransferOut]
    transfer_pairs: list[TransferOut]
    warnings: list[str]
    limitations: list[str]


class TeamRequest(BaseModel):
    team_id: int | None = Field(None, ge=1, description="FPL team ID (the number in your Points page URL)")
    player_ids: list[int] | None = Field(None, description="15 player ids, instead of team_id")
    bank: float | None = Field(None, ge=0, le=100, description="£m; default: from FPL, or 0")
    free_transfers: int | None = Field(None, ge=0, le=5, description="Default: estimated from FPL, or 1")
    horizon: int = Field(HORIZON, ge=1, le=HORIZON)
    include_pairs: bool = True


class PlayerOption(BaseModel):
    id: int
    name: str
    full_name: str
    team: str
    team_code: int | None = _team_code_field()
    position: str
    price: float
    status: str
    availability: Literal["fit", "doubtful", "out"]
    expected_points: list[float] = Field(description="Chance-adjusted, one per gameweek in `gameweeks`")
    fixtures: list[str] = Field(description="Per gameweek, e.g. 'ARS (H)'; '' = blank")
    expected_points_horizon_adjusted: float


class PlayersResponse(BaseModel):
    gameweeks: list[int]
    players: list[PlayerOption]



# ---- fixture difficulty ---------------------------------------------------------------------

class RatedFixture(BaseModel):
    opponent: str = Field(description="Opponent short name, e.g. 'SUN'")
    opponent_name: str
    home: bool
    kickoff_time: str
    xg_for: float = Field(description="Expected goals for the team in this match")
    xg_against: float = Field(description="Expected goals against")
    cs_chance: float = Field(description="Clean-sheet chance, exp(-xg_against)")
    attack: float = Field(description="xg_for / league average: 1 = average, higher = easier to score")
    defence: float = Field(description="cs_chance / an average fixture's: higher = easier clean sheet")
    overall: float = Field(description="Mean of attack and defence")


class FixtureCell(BaseModel):
    gameweek: int
    fixtures: list[RatedFixture] = Field(description="[] = blank gameweek, two = double gameweek")


class TeamStrength(BaseModel):
    attack: float = Field(description="xG created per match at a neutral ground (recency-weighted, shrunk)")
    defence: float = Field(description="xG conceded per match at a neutral ground")
    matches: int


class RunTotals(BaseModel):
    overall: float
    attack: float
    defence: float


class FixtureTeam(BaseModel):
    id: int
    short_name: str
    name: str
    code: int | None = Field(None, description="FPL team code (for badges/shirts), not the id")
    strength: TeamStrength
    totals: RunTotals = Field(description="Scores summed over the horizon: a blank adds 0, a double both")
    gameweeks: list[FixtureCell]


class FixturesResponse(BaseModel):
    gameweeks: list[int]
    league_xg: float
    home_factor: float = Field(description="Home xG x this, away xG / this")
    half_life: float = Field(description="Matches until a past match counts half")
    prior_matches: float = Field(description="Shrinkage toward the league average, in matches")
    teams: list[FixtureTeam]


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
               frontend_dist: Path = FRONTEND_DIST,
               fpl_client: object | None = None) -> FastAPI:
    """fpl_client: anything with .get(path) -> JSON (default: the real FPL API), for loading teams."""
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
        team = req.team.model_dump() if req.team else None
        try:
            answer = agent.ask(req.message, team=team)
        except Exception as e:                          # OpenAI down, bad key, rate limit...
            raise HTTPException(502, f"The language model call failed: {type(e).__name__}") from e
        return ChatResponse(session_id=sid, answer=answer, tools=agent.trace)

    fixtures_payload = difficulty_records(getattr(upcoming, "difficulty", None))   # same for everyone

    @app.get("/api/fixtures", response_model=FixturesResponse)
    def fixtures():
        return fixtures_payload

    @app.get("/api/players", response_model=PlayersResponse)
    def players():
        return {"gameweeks": tools.gameweeks, "players": tools.player_list()}

    @app.post("/api/team/analyze", response_model=TeamAnalysis, response_model_by_alias=True)
    def analyze_team(req: TeamRequest):
        if (req.team_id is None) == (req.player_ids is None):
            raise HTTPException(422, "Send either team_id or player_ids.")
        entry = None
        if req.team_id is not None:
            client = fpl_client or fpl_api.FplClient(retries=2)
            try:
                entry = fpl_api.fetch_entry_team(client, req.team_id)
            except fpl_api.EntryNotFound as e:
                raise HTTPException(404, str(e)) from e
            except Exception as e:  # FPL down, rate limited, offline...
                raise HTTPException(502, f"Couldn't load the team from the FPL API ({type(e).__name__}). "
                                         "Try again, or pick your squad by hand.") from e
            ids = entry.player_ids
            bank = entry.bank if req.bank is None else req.bank
            ft = entry.free_transfers if req.free_transfers is None else req.free_transfers
        else:
            ids = req.player_ids
            bank = 0.0 if req.bank is None else req.bank
            ft = 1 if req.free_transfers is None else req.free_transfers
        try:
            res = tools.analyze_team(ids, bank, ft, horizon=req.horizon, include_pairs=req.include_pairs,
                                     allow_club_overflow=entry is not None)
        except TeamError as e:
            raise HTTPException(422, "Invalid squad: " + " ".join(e.errors)) from e
        return {"source": "fpl" if entry else "manual",
                "entry": vars(entry) if entry else None, "player_ids": ids, **res}

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
