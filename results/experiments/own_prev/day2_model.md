# Day 2: LightGBM vs baselines (ownership: prev)

Walk-forward on 2025-26: for every gameweek the model is retrained on all fixtures that
kicked off before it, then predicts that gameweek. Hyperparameters were chosen on
2024-25 (trained on 2023-24) before the test season was touched.

**LightGBM improves MAE by 5.6% over the best baseline** for players in contention.

## Players in contention

| method                 |   MAE |   RMSE |
|:-----------------------|------:|-------:|
| LightGBM               | 1.883 |  2.745 |
| season average to date | 1.994 |  2.895 |
| form: mean of last 5   | 2.084 |  3.003 |

## All rows

| method                 |   MAE |   RMSE |
|:-----------------------|------:|-------:|
| LightGBM               | 1.001 |  1.941 |
| season average to date | 1.064 |  2.078 |
| form: mean of last 5   | 1.047 |  2.127 |

## Picks (one row per player per gameweek, players in contention)

`captain_pts_per_GW`: average actual points of each method's #1 pick. `top11_avg_pts`: average
actual points of its 11 highest predictions. `spearman_rho`: rank correlation between predicted
and actual points within each gameweek. `oracle` knows the results and shows the ceiling.

| method                 |   captain_pts_per_GW |   top11_avg_pts |   spearman_rho |
|:-----------------------|---------------------:|----------------:|---------------:|
| LightGBM               |                7.081 |           4.781 |          0.449 |
| season average to date |                6.216 |           4.526 |          0.376 |
| form: mean of last 5   |                4.811 |           4.187 |          0.365 |
| oracle                 |               17.189 |          12.666 |        nan     |

![MAE per gameweek](day2_mae_per_gw.png)

## Feature importance

Permutation importance on the test season: how much MAE gets worse when one feature is
shuffled. Measured with a model trained only on earlier seasons.

| feature       |   MAE_increase |
|:--------------|---------------:|
| mins_last3    |         0.0524 |
| pts_season    |         0.0457 |
| bps_season    |         0.0136 |
| pts_last3     |         0.0132 |
| ict_last3     |         0.0068 |
| bps_last5     |         0.0035 |
| bps_last3     |         0.0035 |
| value         |         0.0025 |
| opp_xgc_last5 |         0.0024 |
| mins_last5    |         0.0023 |
| team_xg_last5 |         0.0023 |
| opp_gf_last5  |         0.0022 |
| opp_xg_last5  |         0.0018 |
| was_home      |         0.0015 |
| mins_season   |         0.0009 |

![Feature importance](day2_feature_importance.png)

## Hyperparameters

Chosen: num_leaves=15, min_child_samples=50,
n_estimators=130 (early stopping), learning_rate=0.03.
Full grid in `day2_grid.csv`.
