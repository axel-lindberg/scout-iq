"""Check the FPL API data against vaastav for the gameweeks both have.

    python scripts/download_data.py           # API data -> data/raw/<season>/
    python scripts/check_api_vs_vaastav.py    # downloads vaastav's copy to data/cache/vaastav/

For every gameweek vaastav has: the number of player-match rows must match, and total_points,
minutes and expected_goals must be identical per player and fixture (floats to 0.001). Other
shared columns are compared too, as information. Exits with status 1 on a mismatch in the
three key columns.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from scout_iq.data import RAW_DIR, ROOT  # noqa: E402
from scout_iq.upcoming import current_season  # noqa: E402

VAASTAV = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/{season}/gws/merged_gw.csv"
KEYS = ["element", "fixture"]
MUST_MATCH = ["total_points", "minutes", "expected_goals"]
INFO = ["goals_scored", "assists", "clean_sheets", "bonus", "bps", "starts", "saves", "yellow_cards",
        "expected_assists", "expected_goals_conceded", "ict_index", "value", "selected", "was_home",
        "opponent_team", "kickoff_time", "name", "position", "team"]
TOL = 1e-3


def _load_vaastav(season: str, path: Path | None) -> pd.DataFrame:
    if path is None:
        path = ROOT / "data" / "cache" / "vaastav" / season / "merged_gw.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading vaastav {season} -> {path}")
        urllib.request.urlretrieve(VAASTAV.format(season=season), path)
    return pd.read_csv(path)


def _differs(a: pd.Series, b: pd.Series) -> pd.Series:
    if pd.api.types.is_bool_dtype(a) or pd.api.types.is_bool_dtype(b):
        return a.astype(str).str.lower() != b.astype(str).str.lower()
    na, nb = pd.to_numeric(a, errors="coerce"), pd.to_numeric(b, errors="coerce")
    if na.notna().all() and nb.notna().all():
        return (na - nb).abs() > TOL
    return a.astype(str).str.lower() != b.astype(str).str.lower()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", default=None, help="default: the current season in data/raw/")
    ap.add_argument("--vaastav", type=Path, default=None, help="a local vaastav merged_gw.csv instead of downloading")
    args = ap.parse_args(argv)
    season = args.season or current_season()

    api = pd.read_csv(RAW_DIR / season / "merged_gw.csv")
    va = _load_vaastav(season, args.vaastav).drop_duplicates(subset=KEYS)
    gws = sorted(va["GW"].unique())
    api_max = int(api["GW"].max())
    api = api[api["GW"].isin(gws)]
    print(f"\nSeason {season}: comparing GW {gws[0]}-{gws[-1]} (vaastav's range; the API goes to GW {api_max})\n")

    counts = pd.DataFrame({"api": api.groupby("GW").size(), "vaastav": va.groupby("GW").size()}).fillna(0).astype(int)
    counts["diff"] = counts["api"] - counts["vaastav"]
    print("Player-match rows per gameweek")
    print(counts.to_string(), "\n")

    m = api.merge(va, on=KEYS, how="outer", suffixes=("_api", "_va"), indicator=True)
    only_api, only_va = m[m["_merge"] == "left_only"], m[m["_merge"] == "right_only"]
    for label, part, side in (("only in the API", only_api, "_api"), ("only in vaastav", only_va, "_va")):
        if len(part):
            print(f"{len(part)} rows {label}:")
            print(part[KEYS + [f"name{side}", f"GW{side}", f"minutes{side}", f"total_points{side}"]]
                  .head(20).to_string(index=False), "\n")
    both = m[m["_merge"] == "both"]

    bad = 0
    print(f"Per player and fixture ({len(both):,} rows in both)")
    for col in MUST_MATCH + INFO:
        if f"{col}_api" not in both or f"{col}_va" not in both:
            continue
        d = _differs(both[f"{col}_api"], both[f"{col}_va"])
        flag = "MUST MATCH" if col in MUST_MATCH else "info"
        print(f"  {col:<24} {int(d.sum()):>5} differ   ({flag})")
        if d.any() and col in MUST_MATCH:
            bad += int(d.sum())
            print(both.loc[d, KEYS + ["name_api", "GW_api", f"{col}_api", f"{col}_va"]].head(10).to_string(index=False))

    ok = bad == 0 and (counts["diff"] == 0).all()
    print("\nOK: row counts and key stats identical" if ok else
          f"\nMISMATCH: {bad} key-stat differences, row counts differ in {int((counts['diff'] != 0).sum())} GWs")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
