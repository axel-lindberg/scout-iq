"""Download historical FPL gameweek data from vaastav/Fantasy-Premier-League.

Usage:
    python scripts/download_data.py                # default seasons
    python scripts/download_data.py 2024-25 2025-26

Files land in data/raw/<season>/{merged_gw.csv,teams.csv}.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
DEFAULT_SEASONS = ["2023-24", "2024-25", "2025-26"]
FILES = {"gws/merged_gw.csv": "merged_gw.csv", "teams.csv": "teams.csv"}

RAW_DIR = Path(__file__).resolve().parents[1] / "data" / "raw"


def download(season: str) -> None:
    out = RAW_DIR / season
    out.mkdir(parents=True, exist_ok=True)
    for remote, local in FILES.items():
        url = f"{BASE}/{season}/{remote}"
        dest = out / local
        print(f"  {url} -> {dest.relative_to(RAW_DIR.parent.parent)}")
        urllib.request.urlretrieve(url, dest)


def main(argv: list[str]) -> None:
    seasons = argv or DEFAULT_SEASONS
    for s in seasons:
        print(f"Season {s}")
        download(s)


if __name__ == "__main__":
    main(sys.argv[1:])
