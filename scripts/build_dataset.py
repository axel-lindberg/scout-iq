"""Build the feature table from data/raw into data/processed/features.parquet."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from scout_iq.data import ROOT, load_all  # noqa: E402
from scout_iq.features import build_features, feature_columns  # noqa: E402

OUT = ROOT / "data" / "processed" / "features.parquet"


def main() -> None:
    raw = load_all()
    df = build_features(raw)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT, index=False)
    feats = feature_columns(df)
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(df):,} rows, {len(feats)} features")
    print(df.groupby("season").size().rename("rows").to_string())


if __name__ == "__main__":
    main()
