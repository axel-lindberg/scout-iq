"""Pick-quality metrics must not depend on row order when predictions tie."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scout_iq.fpl_metrics import pick_quality  # noqa: E402


def test_ties_broken_by_player_id_regardless_of_row_order():
    # Players 1, 2 and 3 tie on the prediction; the lowest id (1, scoring 2) is the captain.
    pgw = pd.DataFrame({"GW": [1, 1, 1, 1], "element": [3, 1, 2, 4],
                        "actual": [10.0, 2.0, 7.0, 0.0], "pred": [5.0, 5.0, 5.0, 1.0]})
    results = [pick_quality(pgw.sample(frac=1, random_state=s), ["pred"], top_k=2) for s in range(10)]
    for r in results:
        row = r.set_index("method").loc["pred"]
        assert row["captain_pts_per_GW"] == 2.0     # player 1
        assert row["top2_avg_pts"] == 4.5           # players 1 and 2: (2 + 7) / 2
