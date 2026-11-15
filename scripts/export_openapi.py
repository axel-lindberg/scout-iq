"""Write the API's OpenAPI schema to frontend/openapi.json (the frontend generates its types from it).

    python scripts/export_openapi.py            # or, in frontend/: npm run gen:api

The schema only depends on the routes and response models, not on data, so this doesn't load
the model or need an API key. tests/test_api.py fails if the committed file is out of date.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from scout_iq.api import create_app  # noqa: E402

OUT = ROOT / "frontend" / "openapi.json"


def schema() -> dict:
    # Route handlers only use these objects when a request arrives, never to build the schema.
    return create_app(upcoming=None, tools=None, agent_factory=None).openapi()  # type: ignore[arg-type]


def as_text(s: dict) -> str:
    return json.dumps(s, indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(as_text(schema()), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
