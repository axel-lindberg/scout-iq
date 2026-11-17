# scout-iq: project memory

Claude Code reads this at the start of every session. Keep it under ~150 lines, factual and current.

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
next gameweeks) -> `tools.py` / `agent.py` -> `api.py` (FastAPI) -> React app in `frontend/`.

`src/scout_iq/`
- `data.py`: load and clean `merged_gw.csv` per season into one row per player per fixture.
- `fpl_api.py`: HTTP client for the official FPL API; writes the current season in vaastav's format.
- `features.py`: leakage-safe rolling features; `feature_columns()` is the whitelist the model sees.
- `evaluate.py`: baselines, MAE/RMSE, "players in contention" mask.
- `model.py`: LightGBM fit, grid search with early stopping (on l2), walk-forward evaluation.
- `fpl_metrics.py`: captain / top-11 pick quality and rank correlation.
- `upcoming.py`: predictions for unplayed gameweeks ("not yet played" rows + the normal pipeline).
- `news.py`: RAG over injury news (OpenAI embeddings, cosine similarity, cached index).
- `tools.py`: the agent's tools and their JSON schemas; strict player-name matching.
- `agent.py`: tool-calling loop, system prompt, optional LangSmith tracing.
- `api.py`: FastAPI routes + Pydantic response models; serves `frontend/dist/`.

`frontend/src/`
- `api/`: `client.ts` (fetch + ApiError), `endpoints.ts` (one function per route), `queries.ts`
  (TanStack Query hooks), `schema.gen.ts` (generated, never edit by hand).
- `app/`: `routes.tsx` (all pages), `Layout.tsx` (header + outlet).
- `pages/`: `ScoutPage` (predictions + chat), `NotFoundPage`.
- `features/`: `predictions/`, `compare/`, `chat/`, `status/` (header, model card).
- `components/`, `lib/`: shared UI (Card, Tooltip, AvailabilityBadge) and helpers.
- `test/`: fixtures, mocked fetch (`mockApi.ts`), `renderApp()`.

## Commands

```bash
source .venv/bin/activate && pip install -r requirements.txt     # setup (Python 3.10+)
cd frontend && npm ci                                            # setup (Node 24, see .nvmrc)
python scripts/download_data.py      # past seasons + current season
python scripts/update.py             # weekly, after a gameweek finishes: download, rebuild, retrain
python scripts/update.py --quick     # prices, status and news only
python scripts/build_dataset.py      # -> data/processed/features.parquet
python scripts/evaluate_baseline.py  # -> results/day1_baseline.md
python scripts/train_evaluate.py     # tune, walk-forward, save model -> results/day2_*, models/
python scripts/train_evaluate.py --experiment NAME   # writes results/experiments/NAME/, model untouched
python scripts/serve.py              # API (+ built app) on :8000; reads data once at startup
cd frontend && npm run dev           # dev UI on :5173, proxies /api to :8000
cd frontend && npm run build         # production build -> frontend/dist/ (served by serve.py)
pytest -q                            # backend tests, no network or API key
cd frontend && npm run typecheck && npm run lint && npm run test && npm run build
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
- Never ask for the user's FPL password or use logged-in endpoints.

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

## How Axel works

Axel is a KTH student learning this project well enough to explain it in interviews. After each
feature, teach it in short lessons: plain words, a tiny worked example, how it maps to the code,
likely interview questions, then 2-4 check questions; give feedback on the answers. Axel implements
some experiments himself, so leave those as next steps instead of doing them.

## Current status

- Model, agent, API and React app are done; CI is green on `main`.

## Next steps

- Confidence intervals for model vs baselines (gameweek bootstrap) and several random seeds.
- An agent evaluation set (questions with expected tools and facts), traced in LangSmith.
- Link players across seasons so early-season predictions improve.

## Decisions log

- 2026-11-11: Squared-error objective and l2 early stopping: FPL decisions need the mean, and MAE
  early stopping picked an under-trained model that shrank predictions to the median.
- 2026-11-11: FPL's `xP` is a reference only, never a feature (possible post-deadline snapshots).
- 2026-11-13: Current season from the official FPL API in vaastav's format; only finished gameweeks.
- 2026-11-15: Ownership removed from the final model: same-week, previous-week and no ownership
  were within 0.006 MAE; no ownership was marginally best (MAE 1.877).
- 2026-11-15: Vite + React, not Next.js: the backend is FastAPI, no server rendering is needed.
- 2026-11-15: API types generated from FastAPI's OpenAPI schema so backend and frontend can't drift.
