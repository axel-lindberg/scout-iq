# scout-iq

An FPL (Fantasy Premier League) scout: a machine learning model that predicts how many points each player will score next gameweek, plus an LLM agent that answers questions like *"who should I captain?"* using those predictions and the latest injury news.

## Status

| Day | Goal | Status |
|---|---|---|
| 1 | Data, features, baselines | ✅ Done |
| 2 | Train LightGBM, walk-forward evaluation vs baselines, feature importance | ⏳ |
| 3 | LLM agent with OpenAI tool calling (`get_predictions`, `compare_players`, `get_news` via RAG), LangSmith tracing | ⏳ |
| 4 | FastAPI + simple UI, results write-up | ⏳ |

## Day 1 results

Mean absolute error in points per player per fixture, for players in contention (played in at least one of their last 3 fixtures). Lower is better.

| method | 2023-24 | 2024-25 | 2025-26 |
|:--|--:|--:|--:|
| always predict 0 | 2.147 | 2.138 | 2.365 |
| form: mean of last 5 | 1.962 | 1.894 | 2.084 |
| season average to date | **1.868** | **1.810** | **1.994** |

The bar for the model on Day 2 is the season-average baseline: **1.99 MAE on 2025-26**.

Full tables, including all rows and FPL's own xP as a reference, are in [`results/day1_baseline.md`](results/day1_baseline.md).

### Notes

- **Why a "players in contention" subset?** Most rows are squad players who never play and score 0. Predicting 0 for them is trivial and makes every model look better than it is, so both views are reported.
- **No leakage.** Every feature is computed only from fixtures that kicked off earlier. The tests in `tests/test_features.py` check this, including that changing a fixture's outcome does not change that fixture's features.
- **FPL's xP is not used as a feature.** In 2025-26 it is far more accurate exactly in the gameweeks where the source dataset stored a separate xP snapshot, and worse than the simple baselines elsewhere. That suggests it can contain post-deadline information.

## Data

Historical gameweek data from [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League): seasons 2023-24, 2024-25 and 2025-26, one row per player per fixture (about 87,000 rows).

## Features (53)

Computed per player from previous fixtures in the same season:

- **Recent form:** points, minutes, starts, bonus and BPS over the last 3 and 5 fixtures, plus season-to-date averages
- **Underlying stats:** xG, xA, xGI, goals, assists, clean sheets, saves, ICT index, threat, creativity, influence
- **Availability:** share of the last 5 fixtures with 60+ minutes, number of fixtures played
- **Fixture:** home/away; own team and opponent goals for/against and xG for/against over their last 5 fixtures
- **Market:** price and log ownership
- **Position:** GK / DEF / MID / FWD

## Run it

```bash
pip install -r requirements.txt
python scripts/download_data.py      # ~15 MB into data/raw/
python scripts/build_dataset.py      # -> data/processed/features.parquet
python scripts/evaluate_baseline.py  # -> results/day1_baseline.md
pytest
```

## Layout

```
src/scout_iq/data.py       load and clean raw gameweek data
src/scout_iq/features.py   leakage-safe feature engineering
src/scout_iq/evaluate.py   baselines, MAE/RMSE, per-gameweek error
scripts/                   download, build, evaluate
tests/                     leakage and sanity tests
results/                   tables and plots
```
