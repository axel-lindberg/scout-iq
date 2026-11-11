"""LightGBM model: training, hyperparameter selection and walk-forward evaluation."""

from __future__ import annotations

import itertools
import time
import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd

from .evaluate import mae, relevant_mask, rmse

warnings.filterwarnings("ignore", category=lgb.basic.LGBMDeprecationWarning if hasattr(lgb.basic, "LGBMDeprecationWarning") else DeprecationWarning)
warnings.filterwarnings("ignore", message=".*eval_set.*")
from .features import TARGET

BASE_PARAMS = {
    "objective": "regression",  # squared error -> predicts expected points, which is what FPL decisions need
    "learning_rate": 0.03,
    "min_child_samples": 50,
    "subsample": 0.8,
    "subsample_freq": 1,
    "colsample_bytree": 0.8,
    "reg_lambda": 1.0,
    "verbose": -1,
    "n_jobs": -1,
}

GRID = {
    "num_leaves": [15, 31, 63],
    "min_child_samples": [20, 50, 100],
}


def fit(train: pd.DataFrame, features: list[str], params: dict, n_estimators: int) -> lgb.LGBMRegressor:
    model = lgb.LGBMRegressor(**params, n_estimators=n_estimators, random_state=0)
    model.fit(train[features], train[TARGET])
    return model


def select_params(train: pd.DataFrame, valid: pd.DataFrame, features: list[str]) -> tuple[dict, int, pd.DataFrame]:
    """Small grid search on players in contention.

    Early stopping and model choice use squared error (RMSE), the same loss the model optimises.
    Stopping on MAE instead rewards under-trained models that shrink every prediction towards the
    median, which looks good on MAE but is useless for ranking players.
    """
    rel = relevant_mask(valid)
    rows, best = [], None
    for leaves, mcs in itertools.product(GRID["num_leaves"], GRID["min_child_samples"]):
        params = {**BASE_PARAMS, "num_leaves": leaves, "min_child_samples": mcs}
        model = lgb.LGBMRegressor(**params, n_estimators=3000, random_state=0)
        model.fit(
            train[features], train[TARGET],
            eval_set=[(valid.loc[rel, features], valid.loc[rel, TARGET])],
            eval_metric="l2",
            callbacks=[lgb.early_stopping(100, verbose=False)],
        )
        n = model.best_iteration_ or 3000
        p = pd.Series(model.predict(valid.loc[rel, features], num_iteration=n))
        y = valid.loc[rel, TARGET].reset_index(drop=True)
        score = rmse(y, p)
        rows.append({"num_leaves": leaves, "min_child_samples": mcs, "n_estimators": n,
                     "valid_RMSE": score, "valid_MAE": mae(y, p)})
        if best is None or score < best[0]:
            best = (score, params, n)
    return best[1], best[2], pd.DataFrame(rows).sort_values("valid_RMSE")


def walk_forward(df: pd.DataFrame, test_season: str, features: list[str], params: dict,
                 n_estimators: int, log=print) -> pd.Series:
    """For each gameweek of the test season, train on everything that kicked off earlier and predict it."""
    preds = pd.Series(np.nan, index=df.index)
    test = df[df.season == test_season]
    for gw in sorted(test.GW.unique()):
        gw_rows = test[test.GW == gw]
        cutoff = gw_rows.kickoff_time.min()
        train = df[df.kickoff_time < cutoff]
        t0 = time.time()
        model = fit(train, features, params, n_estimators)
        preds.loc[gw_rows.index] = model.predict(gw_rows[features])
        log(f"  GW{gw:>2}: trained on {len(train):>6,} rows in {time.time() - t0:4.1f}s")
    return preds
