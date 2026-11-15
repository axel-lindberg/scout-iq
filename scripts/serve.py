"""Run the scout-iq web app: python scripts/serve.py, then open http://localhost:8000

Serves the API and the built React frontend (frontend/dist/, from `npm run build` in frontend/).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import uvicorn  # noqa: E402

from scout_iq.api import FRONTEND_DIST, build_default_app  # noqa: E402

if __name__ == "__main__":
    if not (FRONTEND_DIST / "index.html").is_file():
        print("Note: the web app isn't built (frontend/dist/ is missing), so only the API will be served.\n"
              "  Build it:   cd frontend && npm ci && npm run build   (needs Node 20.19+ or 22.12+)\n"
              "  Or develop: cd frontend && npm run dev   and open http://localhost:5173\n")
    print("Loading model and predicting the next gameweek...")
    app = build_default_app()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"scout-iq running at http://localhost:{port}  (API docs at /docs)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
