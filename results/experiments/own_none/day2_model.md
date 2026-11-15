# Day 2: LightGBM vs baselines (ownership: none)

Walk-forward on 2025-26: for every gameweek the model is retrained on all fixtures that
kicked off before it, then predicts that gameweek. Hyperparameters were chosen on
2024-25 (trained on 2023-24) before the test season was touched.

**LightGBM improves MAE by 5.8% over the best baseline** for players in contention.

## Players in contention

| method                 |   MAE |   RMSE |
|:-----------------------|------:|-------:|
| LightGBM               | 1.877 |  2.746 |
| season average to date | 1.994 |  2.895 |
| form: mean of last 5   | 2.084 |  3.003 |

## All rows

| method                 |   MAE |   RMSE |
|:-----------------------|------:|-------:|
| LightGBM               | 1.004 |  1.942 |
| season average to date | 1.064 |  2.078 |
| form: mean of last 5   | 1.047 |  2.127 |

## Picks (one row per player per gameweek, players in contention)

`captain_pts_per_GW`: average actual points of each method's #1 pick. `top11_avg_pts`: average
actual points of its 11 highest predictions. `spearman_rho`: rank correlation between predicted
and actual points within each gameweek. `oracle` knows the results and shows the ceiling.

| method                 |   captain_pts_per_GW |   top11_avg_pts |   spearman_rho |
|:-----------------------|---------------------:|----------------:|---------------:|
| LightGBM               |                6.973 |           4.752 |          0.45  |
| season average to date |                6.216 |           4.526 |          0.376 |
| form: mean of last 5   |                4.811 |           4.187 |          0.365 |
| oracle                 |               17.189 |          12.666 |        nan     |

![MAE per gameweek](day2_mae_per_gw.png)

## Feature importance

Permutation importance on the test season: how much MAE gets worse when one feature is
shuffled. Measured with a model trained only on earlier seasons.

| feature       |   MAE_increase |
|:--------------|---------------:|
| mins_last3    |         0.0555 |
| pts_season    |         0.0386 |
| pts_last3     |         0.0119 |
| ict_last3     |         0.0073 |
| bps_season    |         0.0057 |
| bps_last5     |         0.0038 |
| mins_last5    |         0.0034 |
| value         |         0.0031 |
| bps_last3     |         0.0028 |
| opp_xgc_last5 |         0.0023 |
| mins_season   |         0.0016 |
| was_home      |         0.0014 |
| team_xg_last5 |         0.0014 |
| xg_last3      |         0.0011 |
| xgi_last3     |         0.0009 |

![Feature importance](day2_feature_importance.png)

## Hyperparameters

Chosen: num_leaves=15, min_child_samples=100,
n_estimators=113 (early stopping), learning_rate=0.03.
Full grid in `day2_grid.csv`.
