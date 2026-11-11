"""Day 1: score simple baselines on every season and write results/day1_baseline.md."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from scout_iq.data import ROOT  # noqa: E402
from scout_iq.evaluate import (  # noqa: E402
    baseline_form5, baseline_season_avg, per_gameweek_mae, score_table,
)

FEATURES = ROOT / "data" / "processed" / "features.parquet"
RESULTS = ROOT / "results"


def main() -> None:
    df = pd.read_parquet(FEATURES)
    preds = {
        "zero (always 0)": pd.Series(0.0, index=df.index),
        "form: mean of last 5": baseline_form5(df),
        "season average to date": baseline_season_avg(df),
        "FPL xP (reference)": df["xP"],
    }

    tables = []
    for season, part in df.groupby("season"):
        t = score_table(part, {k: v.loc[part.index] for k, v in preds.items()})
        t.insert(0, "season", season)
        tables.append(t)
    table = pd.concat(tables, ignore_index=True)
    rel = table[table.subset == "relevant"].pivot(index="method", columns="season", values="MAE")
    allr = table[table.subset == "all"].pivot(index="method", columns="season", values="MAE")

    RESULTS.mkdir(exist_ok=True)
    table.to_csv(RESULTS / "day1_baseline.csv", index=False)

    test = df[df.season == df.season.max()]
    fig, ax = plt.subplots(figsize=(9, 4))
    for name in ("form: mean of last 5", "season average to date", "FPL xP (reference)"):
        per_gameweek_mae(test, preds[name].loc[test.index]).plot(ax=ax, label=name, marker="o", ms=3)
    ax.set_title(f"Baseline MAE per gameweek, {test.season.iloc[0]} (players in contention)")
    ax.set_xlabel("Gameweek")
    ax.set_ylabel("MAE (points)")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(RESULTS / "day1_baseline_per_gw.png", dpi=140)

    md = [
        "# Day 1: baselines",
        "",
        "Mean absolute error (points per player per fixture). Lower is better.",
        "",
        "## Players in contention (played in at least one of their last 3 fixtures)",
        "",
        rel.round(3).to_markdown(),
        "",
        "## All rows (includes squad players who never play)",
        "",
        allr.round(3).to_markdown(),
        "",
        "`FPL xP` is the official expected-points figure stored in the dataset. It is a reference,",
        "not a fair baseline: we can't verify when it was captured, so it may include information",
        "from after the deadline. The per-gameweek plot backs this up: in 2025-26 xP is far more",
        "accurate exactly in the gameweeks where the dataset has a separate xP snapshot",
        "(GW 1-9, 24, 29, 38) and worse than the simple baselines elsewhere, so we never use it",
        "as a feature.",
        "",
        "![MAE per gameweek](day1_baseline_per_gw.png)",
    ]
    (RESULTS / "day1_baseline.md").write_text("\n".join(md) + "\n")
    print("\n".join(md[:13]))


if __name__ == "__main__":
    main()
