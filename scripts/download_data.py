"""Download FPL data into data/raw/<season>/.

Past seasons come from vaastav/Fantasy-Premier-League. The current season comes from the
official FPL API by default, written in the same files and columns, so it has every finished
gameweek plus live prices, injury news and the real next gameweek.

Usage:
    python scripts/download_data.py                  # past seasons (if missing) + current from the API
    python scripts/download_data.py --quick          # only prices, status, news and fixtures (seconds)
    python scripts/download_data.py --full           # refetch every player history, ignoring the cache
    python scripts/download_data.py --source vaastav # old behaviour: everything from vaastav
    python scripts/download_data.py 2024-25          # (re)download specific past seasons from vaastav

Past seasons are final, so they're only downloaded when missing or when named explicitly.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scout_iq import fpl_api  # noqa: E402
from scout_iq.data import RAW_DIR  # noqa: E402

BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
PAST_SEASONS = ["2023-24", "2024-25", "2025-26"]
FILES = {
    "gws/merged_gw.csv": "merged_gw.csv",   # one row per player per played fixture
    "teams.csv": "teams.csv",
    "fixtures.csv": "fixtures.csv",         # all fixtures, including ones not played yet
    "players_raw.csv": "players_raw.csv",   # current price, status and injury news
}


def download_vaastav(season: str, raw_dir: Path = RAW_DIR) -> None:
    out = raw_dir / season
    out.mkdir(parents=True, exist_ok=True)
    for remote, local in FILES.items():
        url = f"{BASE}/{season}/{remote}"
        dest = out / local
        print(f"  {url} -> {dest}")
        urllib.request.urlretrieve(url, dest)


def _have(season: str) -> bool:
    return all((RAW_DIR / season / f).exists() for f in FILES.values())


def download_current(quick: bool = False, full: bool = False) -> fpl_api.DownloadResult:
    mode = "quick: prices, news, fixtures" if quick else "full"
    print(f"Current season from the FPL API ({mode})")
    res = fpl_api.write_season(quick=quick, full=full)
    print(f"  season {res.season}: {res.players} players, latest finished GW {res.latest_finished_gw}, "
          f"next GW {res.next_gw}")
    if res.rows is not None:
        print(f"  {res.fetched} player histories fetched ({res.players - res.fetched} up to date in cache), "
              f"{res.rows:,} player-match rows -> {RAW_DIR / res.season / 'merged_gw.csv'}")
    if res.stale_gw is not None:
        print(f"  WARNING: merged_gw.csv only goes to GW {res.stale_gw} but GW {res.latest_finished_gw} has "
              "finished. Run without --quick to add the new results, otherwise the app will predict a "
              "gameweek that's already been played.")
    return res


def main(argv: list[str] | None = None) -> fpl_api.DownloadResult | None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("seasons", nargs="*", help="past seasons to (re)download from vaastav")
    ap.add_argument("--source", choices=["api", "vaastav"], default="api",
                    help="where the current season comes from (default: api)")
    ap.add_argument("--quick", action="store_true", help="only refresh bootstrap-static and fixtures")
    ap.add_argument("--full", action="store_true", help="refetch all player histories (ignore the cache)")
    args = ap.parse_args(argv)
    if args.quick and args.source != "api":
        ap.error("--quick needs --source api")

    if args.source == "vaastav":
        for s in args.seasons or [*PAST_SEASONS, fpl_api.season_for_date()]:
            print(f"Season {s} (vaastav)")
            download_vaastav(s)
        return None

    if not args.quick:
        for s in args.seasons or [s for s in PAST_SEASONS if not _have(s)]:
            if s == fpl_api.season_for_date():
                print(f"Season {s} is the current season: it comes from the API (use --source vaastav to override)")
                continue
            print(f"Season {s} (vaastav)")
            download_vaastav(s)
    return download_current(quick=args.quick, full=args.full)


if __name__ == "__main__":
    main()
