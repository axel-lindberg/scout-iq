"""Run the scout-iq web app: python scripts/serve.py, then open http://localhost:8000"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import uvicorn  # noqa: E402

from scout_iq.api import build_default_app  # noqa: E402

if __name__ == "__main__":
    print("Loading model and predicting the next gameweek...")
    app = build_default_app()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"scout-iq running at http://localhost:{port}  (API docs at /docs)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
