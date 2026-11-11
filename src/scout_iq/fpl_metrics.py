"""FPL-flavoured metrics: how good are a method's picks, not just its point estimates."""

from __future__ import annotations

import pandas as pd
from scipy.stats import spearmanr

from .evaluate import relevant_mask
from .features import TARGET


def per_player_gw(df: pd.DataFrame, preds: dict[str, pd.Series]) -> pd.DataFrame:
    """Sum fixtures into one row per player per gameweek (double gameweeks count twice)."""
    m = relevant_mask(df)
    cols = {"actual": df.loc[m, TARGET]}
    cols.update({k: v[m] for k, v in preds.items()})
    out = pd.DataFrame(cols)
    out["GW"], out["element"], out["name"] = df.loc[m, "GW"], df.loc[m, "element"], df.loc[m, "name"]
    agg = {k: "sum" for k in ["actual", *preds]}
    agg["name"] = "first"
    return out.groupby(["GW", "element"]).agg(agg).reset_index()


def pick_quality(pgw: pd.DataFrame, methods: list[str], top_k: int = 11) -> pd.DataFrame:
    """Per method: avg actual points of its #1 pick (captain), of its top-k, and rank correlation."""
    rows = []
    for m in [*methods, "oracle"]:
        cap, topk, rho = [], [], []
        for _, g in pgw.groupby("GW"):
            key = "actual" if m == "oracle" else m
            ranked = g.sort_values(key, ascending=False)
            cap.append(ranked.iloc[0]["actual"])
            topk.append(ranked.head(top_k)["actual"].mean())
            if m != "oracle":
                rho.append(spearmanr(g[m], g["actual"]).statistic)
        rows.append({
            "method": m,
            "captain_pts_per_GW": sum(cap) / len(cap),
            f"top{top_k}_avg_pts": sum(topk) / len(topk),
            "spearman_rho": (sum(rho) / len(rho)) if rho else float("nan"),
        })
    return pd.DataFrame(rows)
