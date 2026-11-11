"""Day 2: tune LightGBM on 2024-25, walk-forward test on 2025-26, compare with baselines.

Writes results/day2_model.md (+ csv/png) and models/lgbm.txt (trained on all seasons, for the agent).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.inspection import permutation_importance  # noqa: E402

from scout_iq.data import ROOT  # noqa: E402
from scout_iq.evaluate import (  # noqa: E402
    baseline_form5, baseline_season_avg, per_gameweek_mae, relevant_mask, score_table,
)
from scout_iq.features import TARGET, feature_columns  # noqa: E402
from scout_iq.fpl_metrics import per_player_gw, pick_quality  # noqa: E402
from scout_iq.model import fit, select_params, walk_forward  # noqa: E402

FEATURES = ROOT / "data" / "processed" / "features.parquet"
RESULTS = ROOT / "results"
MODELS = ROOT / "models"
TRAIN_S, VALID_S, TEST_S = "2023-24", "2024-25", "2025-26"


def main() -> None:
    df = pd.read_parquet(FEATURES)
    feats = feature_columns(df)
    RESULTS.mkdir(exist_ok=True)
    MODELS.mkdir(exist_ok=True)

    # 1. Hyperparameters: train on 2023-24, validate on 2024-25. The test season is not touched.
    print(f"1/4 Selecting hyperparameters (train {TRAIN_S}, validate {VALID_S})")
    params, n_est, grid = select_params(df[df.season == TRAIN_S], df[df.season == VALID_S], feats)
    grid.to_csv(RESULTS / "day2_grid.csv", index=False)
    print(grid.head(5).round(4).to_string(index=False))

    # 2. Walk-forward on the test season.
    print(f"2/4 Walk-forward evaluation on {TEST_S}")
    pred = walk_forward(df, TEST_S, feats, params, n_est)
    test = df[df.season == TEST_S]
    preds = {
        "LightGBM": pred.loc[test.index],
        "season average to date": baseline_season_avg(test),
        "form: mean of last 5": baseline_form5(test),
    }
    table = score_table(test, preds)
    table.to_csv(RESULTS / "day2_scores.csv", index=False)
    out = test[["season", "GW", "element", "name", "team_name", "position", TARGET]].copy()
    out["pred_lgbm"] = pred.loc[test.index]
    out.to_parquet(ROOT / "data" / "processed" / f"predictions_{TEST_S}.parquet", index=False)

    # 3. FPL pick quality.
    pgw = per_player_gw(test, preds)
    picks = pick_quality(pgw, list(preds))
    picks.to_csv(RESULTS / "day2_picks.csv", index=False)

    # 4. Feature importance: permutation importance on the test season with a model that never saw it.
    print("3/4 Feature importance")
    pre_test = df[df.season != TEST_S]
    model_pre = fit(pre_test, feats, params, n_est)
    rel = test[relevant_mask(test)].sample(n=min(15000, int(relevant_mask(test).sum())), random_state=0)
    perm = permutation_importance(model_pre, rel[feats], rel[TARGET], scoring="neg_mean_absolute_error",
                                  n_repeats=3, random_state=0, n_jobs=-1)
    imp = (pd.DataFrame({"feature": feats, "MAE_increase": perm.importances_mean})
           .sort_values("MAE_increase", ascending=False))
    imp.to_csv(RESULTS / "day2_feature_importance.csv", index=False)

    # Final model on all seasons, for predictions in the agent.
    print("4/4 Training final model on all seasons")
    final = fit(df, feats, params, n_est)
    final.booster_.save_model(str(MODELS / "lgbm.txt"))
    (MODELS / "lgbm_meta.json").write_text(json.dumps(
        {"features": feats, "params": {k: v for k, v in params.items() if k != "n_jobs"},
         "n_estimators": n_est, "trained_on": sorted(df.season.unique().tolist())}, indent=2))

    # Plots.
    fig, ax = plt.subplots(figsize=(9, 4))
    for name in ("LightGBM", "season average to date", "form: mean of last 5"):
        per_gameweek_mae(test, preds[name]).plot(ax=ax, label=name, marker="o", ms=3)
    ax.set(title=f"MAE per gameweek, {TEST_S} walk-forward (players in contention)",
           xlabel="Gameweek", ylabel="MAE (points)")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(RESULTS / "day2_mae_per_gw.png", dpi=140)

    top = imp.head(15).iloc[::-1]
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.barh(top.feature, top.MAE_increase, color="#1f5fbf")
    ax.set(title="Permutation importance (MAE increase when shuffled)", xlabel="MAE increase (points)")
    ax.grid(alpha=0.3, axis="x")
    fig.tight_layout()
    fig.savefig(RESULTS / "day2_feature_importance.png", dpi=140)

    # Report.
    rel_t = table[table.subset == "relevant"].set_index("method")[["MAE", "RMSE"]]
    all_t = table[table.subset == "all"].set_index("method")[["MAE", "RMSE"]]
    base = rel_t.loc["season average to date", "MAE"]
    gain = 100 * (base - rel_t.loc["LightGBM", "MAE"]) / base
    best_row = grid.iloc[0]
    md = [
        "# Day 2: LightGBM vs baselines",
        "",
        f"Walk-forward on {TEST_S}: for every gameweek the model is retrained on all fixtures that",
        "kicked off before it, then predicts that gameweek. Hyperparameters were chosen on",
        f"{VALID_S} (trained on {TRAIN_S}) before the test season was touched.",
        "",
        f"**LightGBM improves MAE by {gain:.1f}% over the best baseline** for players in contention.",
        "",
        "## Players in contention",
        "",
        rel_t.round(3).to_markdown(),
        "",
        "## All rows",
        "",
        all_t.round(3).to_markdown(),
        "",
        "## Picks (one row per player per gameweek, players in contention)",
        "",
        "`captain_pts_per_GW`: average actual points of each method's #1 pick. `top11_avg_pts`: average",
        "actual points of its 11 highest predictions. `spearman_rho`: rank correlation between predicted",
        "and actual points within each gameweek. `oracle` knows the results and shows the ceiling.",
        "",
        picks.round(3).to_markdown(index=False),
        "",
        "![MAE per gameweek](day2_mae_per_gw.png)",
        "",
        "## Feature importance",
        "",
        "Permutation importance on the test season: how much MAE gets worse when one feature is",
        "shuffled. Measured with a model trained only on earlier seasons.",
        "",
        imp.head(15).round(4).to_markdown(index=False),
        "",
        "![Feature importance](day2_feature_importance.png)",
        "",
        "## Hyperparameters",
        "",
        f"Chosen: num_leaves={int(best_row.num_leaves)}, min_child_samples={int(best_row.min_child_samples)},",
        f"n_estimators={int(best_row.n_estimators)} (early stopping), learning_rate={params['learning_rate']}.",
        "Full grid in `day2_grid.csv`.",
    ]
    (RESULTS / "day2_model.md").write_text("\n".join(md) + "\n")
    print("\n".join(md[6:24]))
    print(picks.round(3).to_string(index=False))
    print(imp.head(10).round(4).to_string(index=False))


if __name__ == "__main__":
    main()
