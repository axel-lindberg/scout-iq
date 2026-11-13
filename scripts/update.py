"""Weekly update in one command: download -> build features -> retrain -> summary.

    python scripts/update.py           # after a gameweek finishes (~2-3 min first run, then faster)
    python scripts/update.py --quick   # between gameweeks: refresh prices, status and injury news only

--quick doesn't change any match data, so no rebuild or retraining is needed. Restart
scripts/serve.py afterwards: the app reads the data once at startup.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))
sys.path.insert(0, str(HERE))

import pandas as pd  # noqa: E402

import build_dataset  # noqa: E402
import download_data  # noqa: E402
import train_evaluate  # noqa: E402
from scout_iq.data import RAW_DIR, ROOT, load_season  # noqa: E402
from scout_iq.upcoming import _load_players, _next_gameweek  # noqa: E402


def summary(season: str) -> dict:
    played = load_season(season)
    fixtures = pd.read_csv(RAW_DIR / season / "fixtures.csv")
    players = _load_players(season)
    feats = ROOT / "data" / "processed" / "features.parquet"
    return {
        "season": season,
        "latest_finished_gw": int(played["GW"].max()) if len(played) else 0,
        "next_gw": _next_gameweek(fixtures, played),
        "rows_current_season": len(played),
        "rows_all_seasons": len(pd.read_parquet(feats, columns=["season"])) if feats.exists() else None,
        "players": len(players),
        "players_with_news": int((players["news"].str.strip() != "").sum()),
    }


def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true", help="only refresh prices, status and news")
    args = ap.parse_args(argv)

    print("== 1. Download")
    res = download_data.main(["--quick"] if args.quick else [])
    if not args.quick:
        print("\n== 2. Build features")
        build_dataset.main()
        print("\n== 3. Train and evaluate")
        train_evaluate.main()

    s = summary(res.season)
    print("\n== Summary")
    print(f"  season              {s['season']}")
    print(f"  latest finished GW  {s['latest_finished_gw']}")
    print(f"  next GW             {s['next_gw']}")
    print(f"  rows                {s['rows_current_season']:,} this season"
          + (f", {s['rows_all_seasons']:,} in features.parquet" if s["rows_all_seasons"] else ""))
    print(f"  players with news   {s['players_with_news']} of {s['players']}")
    if res.stale_gw is not None:
        print(f"  WARNING: GW {res.latest_finished_gw} has finished but the data stops at GW {res.stale_gw}. "
              "Run python scripts/update.py (without --quick).")
    print("Restart scripts/serve.py to load the new data.")
    return s


if __name__ == "__main__":
    main()
