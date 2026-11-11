"""Baselines and evaluation helpers."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .features import TARGET


def baseline_form5(df: pd.DataFrame) -> pd.Series:
    """Average points over the player's last 5 fixtures; 0 with no history this season."""
    return df["pts_last5"].fillna(0.0)


def baseline_season_avg(df: pd.DataFrame) -> pd.Series:
    return df["pts_season"].fillna(0.0)


def relevant_mask(df: pd.DataFrame) -> pd.Series:
    """Players actually in contention: played minutes in at least one of their last 3 fixtures.

    Most rows in FPL data are squad players who never play and score 0. Predicting 0
    for them is trivial and makes every model look good, so we report this subset too.
    """
    return df["mins_last3"].fillna(0) > 0


def mae(y_true: pd.Series, y_pred: pd.Series) -> float:
    return float(np.mean(np.abs(y_true.to_numpy() - y_pred.to_numpy())))


def rmse(y_true: pd.Series, y_pred: pd.Series) -> float:
    return float(np.sqrt(np.mean((y_true.to_numpy() - y_pred.to_numpy()) ** 2)))


def score_table(df: pd.DataFrame, preds: dict[str, pd.Series]) -> pd.DataFrame:
    """MAE/RMSE per prediction method on all rows and on the relevant subset."""
    rel = relevant_mask(df)
    rows = []
    for name, p in preds.items():
        ok = p.notna()
        for subset, m in (("all", ok), ("relevant", ok & rel)):
            rows.append({
                "method": name, "subset": subset, "n": int(m.sum()),
                "MAE": mae(df.loc[m, TARGET], p[m]), "RMSE": rmse(df.loc[m, TARGET], p[m]),
            })
    return pd.DataFrame(rows)


def per_gameweek_mae(df: pd.DataFrame, pred: pd.Series, relevant_only: bool = True) -> pd.Series:
    m = relevant_mask(df) if relevant_only else pd.Series(True, index=df.index)
    err = (df[TARGET] - pred).abs()[m]
    return err.groupby(df.loc[m, "GW"]).mean()
