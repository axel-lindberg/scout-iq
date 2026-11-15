"""Compare the ownership experiments gameweek by gameweek (players in contention)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np
import pandas as pd

from scout_iq.data import ROOT
from scout_iq.evaluate import relevant_mask

TEST_S = "2025-26"
VARIANTS = ("current", "prev", "none")

feat = pd.read_parquet(ROOT / "data" / "processed" / "features.parquet")
test = feat[feat.season == TEST_S].reset_index(drop=True)
rel = relevant_mask(test)

err = {}
for v in VARIANTS:
    p = pd.read_parquet(ROOT / "results" / "experiments" / f"own_{v}" / f"predictions_{TEST_S}.parquet")
    # The prediction file was written in the same row order as `test`. Check before trusting it.
    assert (p.element.to_numpy() == test.element.to_numpy()).all()
    assert (p.GW.to_numpy() == test.GW.to_numpy()).all()
    abs_err = (test.total_points - p.pred_lgbm).abs()
    err[v] = abs_err[rel].groupby(test.GW[rel]).mean()

gw = pd.DataFrame(err)
print(gw.round(3).to_string(), "\n")

rng = np.random.default_rng(0)
for a, b in (("prev", "current"), ("none", "current"), ("none", "prev")):
    d = (gw[a] - gw[b]).to_numpy()
    # Bootstrap over gameweeks: resample the 38 GWs with replacement, 2000 times.
    boots = d[rng.integers(0, len(d), size=(2000, len(d)))].mean(axis=1)
    lo, hi = np.percentile(boots, [2.5, 97.5])
    print(f"{a:>4} - {b:<7}: mean {d.mean():+.4f}   {a} better in {(d < 0).sum()}/{len(d)} GWs   "
          f"95% CI [{lo:+.4f}, {hi:+.4f}]")