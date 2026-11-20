# scout-iq: project memory

Read at the start of every session. Keep it under ~150 lines, factual and current.
**Keeping it current is part of every task.** At the end of any task that changes the architecture,
commands, conventions, results, status or a decision, update this file in the same branch without
being asked. Delete what is no longer true instead of appending.

## What it is

An FPL (Fantasy Premier League) scout. A LightGBM model predicts each player's expected points for
upcoming gameweeks; an OpenAI tool-calling agent answers questions ("who should I captain?") from
those predictions and official injury news; a FastAPI backend serves a React + TypeScript app.

Headline result (2025-26, walk-forward: retrained before every gameweek, players in contention,
model without ownership; source `results/day2_scores.csv`, `results/day2_picks.csv`):

| method | MAE | RMSE | captain pts/GW | top-11 avg pts | Spearman |
|---|--:|--:|--:|--:|--:|
| LightGBM | 1.877 | 2.746 | 6.97 | 4.75 | 0.450 |
| season average to date (best baseline) | 1.994 | 2.895 | 6.22 | 4.53 | 0.376 |

5.8% lower MAE than the best baseline. Hyperparameters were tuned on 2024-25 only.

## Architecture

Data flow: FPL API (current season) / vaastav repo (past seasons) -> `data/raw/<season>/` (vaastav's
CSV format) -> `features.py` -> LightGBM (`models/lgbm.txt`) -> `upcoming.py` (predictions for the
next 5 gameweeks) -> `tools.py` / `agent.py` -> `api.py` (FastAPI) -> React app in `frontend/`.
Fixture difficulty: played matches' xG -> `difficulty.py` (inside `predict_upcoming`) -> `/api/fixtures`.
My team: FPL entry endpoints (`fpl_api.fetch_entry_team`) or 15 hand-picked ids -> `team.py`
(per-GW xPts from `Upcoming.by_gw`) -> `POST /api/team/analyze` and the agent's `analyze_my_team`.

`src/scout_iq/`
- `data.py`: load and clean `merged_gw.csv` per season into one row per player per fixture.
- `fpl_api.py`: HTTP client for the official FPL API; writes the current season in vaastav's format;
  loads a manager's squad from the public entry endpoints and estimates free transfers.
- `features.py`: leakage-safe rolling features; `feature_columns()` is the whitelist the model sees.
- `evaluate.py`: baselines, MAE/RMSE, "players in contention" mask.
- `model.py`: LightGBM fit, grid search with early stopping (on l2), walk-forward evaluation.
- `fpl_metrics.py`: captain / top-11 pick quality and rank correlation.
- `upcoming.py`: predictions for the next `HORIZON` (5) gameweeks: "not yet played" rows + the normal
  pipeline, built per slot (a team plays at most once per slot) so every future fixture uses form as
  of today; double gameweeks sum, blanks are 0. `by_gw` = one row per player per gameweek. Chance of
  playing: FPL's next-GW figure, kept for later GWs unless the news gives a return date.
  `_load_players` maps each player's team id -> FPL team `code` (`teams.csv`) as `team_code`.
- `difficulty.py`: per-fixture attack / defence / overall scores (1.0 = average) from opponents'
  venue-neutral, recency-weighted, shrunk xG; `to_records()` = the `/api/fixtures` JSON.
- `team.py`: deterministic squad feedback: rules check, best XI (try all 8 formations), captain,
  bench order, weakest players, exact single-transfer search, pairs (sum-of-singles estimate, then
  exact re-score). Objective: best XI + captain per GW, summed over the horizon, minus 4 per hit.
  `analyze_squad` also returns the best XI for every GW (`lineups`, used by the pitch's GW arrows).
  `perfect_squad`: the best legal 15 of all players for one GW, an exact integer programme (scipy
  `milp`/HiGHS, ~0.2 s, cached per GW and budget in `tools.py`); returned as `perfect_teams`.
- `news.py`: RAG over injury news (OpenAI embeddings, cosine similarity, cached index).
- `tools.py`: the agent's tools and their JSON schemas (`horizon`, `rank_by`, `analyze_my_team`);
  strict name matching; `analyze_team()` shared by the API and the agent.
- `agent.py`: tool-calling loop, system prompt, optional LangSmith tracing; `ask(q, team=...)` adds a
  system note when the user's squad changes and passes it to `analyze_my_team`.
- `api.py`: FastAPI routes + Pydantic response models; serves `frontend/dist/`. Stateless except chat
  sessions: `/api/team/analyze` takes `team_id` or `player_ids` each time; `/api/players`, `/api/fixtures`.

`frontend/src/`
- `api/`: `client.ts` (fetch + ApiError), `endpoints.ts` (one function per route), `queries.ts`
  (TanStack Query hooks), `schema.gen.ts` (generated, never edit by hand).
- `app/`: `routes.tsx` (all pages), `Layout.tsx` (header + outlet).
- `pages/`: `ScoutPage` (predictions + chat), `MyTeamPage` (team + chat), `FixturesPage`, `NotFoundPage`.
- `features/`: `predictions/`, `compare/`, `chat/`, `fixtures/` (table + `TeamPicker`), `status/`, `team/`
  (load by ID, `SquadBuilder`, `Planner` = editable `Pitch` + `PlayerPicker`, `SquadTable`, `Transfers`).
- `components/` (Card, Tooltip, AvailabilityBadge, `Shirt`), `lib/`: `shirts.ts` (the only shirt URL),
  `teamStore.ts` (loaded squad + saved plan with a squad/lineup per GW in localStorage; the chat sends
  the first GW's planned squad),
  `squad.ts` (squad rules), `plan.ts` (pure draft logic: slots, swaps, armband, per-GW transfers),
  `difficulty.ts` (5 colour steps (`--fdr-*` tokens, `LEVEL_FILL`), sorting, URL state),
  `grade.ts` (xPts grade: percentile vs players in contention that GW, same 5 colours).
- `test/`: fixtures, mocked fetch (`mockApi.ts`), `renderApp()`.

## Commands

```bash
source .venv/bin/activate && pip install -r requirements.txt     # setup (Python 3.10+)
cd frontend && npm ci                                            # setup (Node 24, see .nvmrc)
python scripts/download_data.py      # past seasons + current season
python scripts/update.py             # weekly, after a gameweek finishes: download, rebuild, retrain
python scripts/update.py --quick     # prices, status and news only
python scripts/build_dataset.py      # -> data/processed/features.parquet (evaluate_baseline.py: baselines)
python scripts/train_evaluate.py     # tune, walk-forward, save model -> results/day2_*, models/
python scripts/train_evaluate.py --experiment NAME   # writes results/experiments/NAME/, model untouched
python scripts/serve.py              # API (+ built app) on :8000; reads data once at startup
cd frontend && npm run dev           # dev UI on :5173, proxies /api to :8000
pytest -q                            # backend tests, no network or API key
cd frontend && npm run typecheck && npm run lint && npm run test && npm run build   # build -> dist/
cd frontend && npm run gen:api       # after changing an API response model
```

## Rules that must not break

- Features only use matches that kicked off before the row: sort by kickoff, `shift(1)` before every
  rolling/expanding window, group by player and season. The model only sees `feature_columns()`.
  The perturbation test in `tests/test_features.py` must keep passing; extend it for new features.
- Never evaluate on data used for tuning: hyperparameters come from 2024-25, the test season is 2025-26.
- Past-season evaluation results in `results/` must stay unchanged unless a change is intended and
  explained in the PR and in the decisions log below.
- FPL's own `xP` is never a feature (it was sometimes recorded after the deadline).
- Never ask for the user's FPL password or use logged-in endpoints (`/my-team/`).
- Squad optimisation is deterministic code in `team.py`, never the LLM; the agent only explains it.

## Conventions

- Work on a branch, open a PR, ask Axel before merging. CI (`.github/workflows/ci.yml`) runs pytest
  and the frontend typecheck/lint/test/build plus a check that `schema.gen.ts` matches `openapi.json`.
- One commit per logical change, imperative message describing it (never "Day N").
  Author: `Axel Lindberg <axelahus@gmail.com>`.
- New logic needs tests. Backend tests never hit the network: use saved JSON in `tests/fixtures/`
  and fake OpenAI clients.
- API types: routes declare Pydantic response models; `npm run gen:api` writes `frontend/openapi.json`
  and `src/api/schema.gen.ts`; `test_committed_openapi_schema_is_current` fails if they are stale.
- Frontend: TanStack Query for every call, Tailwind tokens from `styles.css`, accessible markup.
- Shirts are FPL's Premier League-licensed images, hotlinked by team `code` (not id) via
  `lib/shirts.ts`; never commit them, and swap in own SVGs there before hosting publicly.

## How Axel works

Axel is a KTH student learning this project well enough to explain it in interviews. After each
feature, teach it in short lessons: plain words, a tiny worked example, how it maps to the code,
likely interview questions, then 2-4 check questions; give feedback on the answers. Axel implements
some experiments himself, so leave those as next steps instead of doing them.

## Current status

- Predictions cover the next 5 gameweeks (`/api/predictions?horizon=5`, faded columns in the table).
- Fixtures page (`/fixtures`): difficulty by Overall/Attack/Defense, sortable, team comparison.
- My team page + `analyze_my_team` + transfer planner on the pitch (sell ×, buy +, subs, captain,
  Optimise/Save/Reset), all checked on Axel's real team (2026-11-17). Unsaved drafts aren't persisted.
- Pitch GW arrows (‹ ›) step through the 5 predicted GWs; each GW has its own squad, lineup and
  armband (`plan.lineups[gw]`). A transfer in GW k carries into later GWs (`plan.carryForward`, which
  keeps their own transfers), never earlier ones. `plan.planStates` rolls free transfers (left + 1,
  max 5, 1 after a hit), hits and bank week to week. The Bank box is editable per GW (a correction
  for real selling prices, `plan.bankAdjust[gw]`, carried on). Defaults: saved lineup, else that GW's
  best XI, else the previous GW's. Optimise changes the GW shown only. The analysis (best XI,
  suggestions) is for the shown GW's squad but still over all 5 GWs from the next one.
- Pitch chips: dark name bar (`--chip` token); the fixture/xPts bar coloured by the player's xPts that
  GW vs every player above 0.5 xPts (top 5% / 15% / 50% / 20% / bottom 10%; real cut-offs ~3.9,
  3.1, 1.5, 0.8; top 10% made too many squad players dark green). A blank is bottom 10%.
- GW score strip: each GW's lineup points (minus the hit in GW1) as a % of that GW's perfect team;
  click a score to jump to that GW.
- Known limits: no selling prices (public API), free transfers estimated, the agent sometimes adds
  claims the tool didn't give (e.g. "reliable"): an agent eval would catch this.

## Next steps

- **Axel's experiment:** horizon accuracy. How does MAE grow when predicting 1, 2, 3+ gameweeks
  ahead with form frozen at the cutoff (walk-forward, cutoff = kickoff of GW g, predict g+k)? Not
  implemented on purpose; `upcoming_features()` is the piece to reuse.

- Confidence intervals for model vs baselines (gameweek bootstrap) and several random seeds; an
  agent evaluation set (questions with expected tools and facts), traced in LangSmith.
- Transfer suggestions from a later GW's point of view (analysis with a start gameweek in `team.py`).
- Bench value / auto-subs in the team objective (bench points count 0 now), and a "roll the
  transfer" option valued explicitly.
- Link players across seasons so early-season predictions improve.

## Decisions log

- 2026-11-11: Squared-error objective and l2 early stopping: FPL decisions need the mean, and MAE
  early stopping picked an under-trained model that shrank predictions to the median.
- 2026-11-13: Current season from the official FPL API in vaastav's format; only finished gameweeks.
- 2026-11-15: Ownership dropped: same-week, previous-week and no ownership within 0.006 MAE.
- 2026-11-15: Vite + React, not Next.js (no server rendering needed); API types from OpenAPI.
- 2026-11-17: Multi-gameweek predictions build each slot separately instead of one build with all
  future rows, which would count unplayed matches inside the rolling windows. Next-GW output unchanged.
- 2026-11-17: Team optimisation in Python, not the LLM: hard rules (formation, budget, club limit)
  must always hold and the answer must be reproducible and testable.
- 2026-11-17: Team endpoint stateless; the frontend keeps the squad in localStorage.
- 2026-11-17: Planned transfers are counted against the loaded squad, not the last save: buying a sold
  player back is free and Reset just drops the plan. Lineup points are summed in the browser (from
  `/api/players` per-GW xPts) for instant feedback; the best XI still comes only from `team.py`.
- 2026-11-18: Shirt team code mapped in the backend from `teams.csv`; pitch is the main My team view.
- 2026-11-18: Fixture difficulty from our own xG, not FPL (strength_attack/defence are 0 this season)
  or the model's `opp_*_last5` (noisy, ~3% of gain). Half-life 12 matches + shrinkage 5 tuned on
  2024-25 (next-match xG MSE 0.653 vs 0.704 for last-3 unshrunk); FPL `strength_overall` only before
  any match. Runs are summed, not averaged: a double counts twice and a blank adds 0.
- 2026-11-20: GW score = your points / the perfect team's (best 15 of all players, FPL rules, per GW),
  not / your own best XI, so it also reflects transfers. Budget = max(£100m, squad value + bank) so a
  squad that rose in value can't pass 100% just by costing more. Solved exactly (MILP), not greedily.
- 2026-11-20: Transfers per gameweek, counted against the week before, with FPL's roll-over (left + 1,
  max 5). Bank corrections are typed per GW instead of modelling selling prices (not in the public API).
