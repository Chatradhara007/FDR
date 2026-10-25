"""Mock bank: stands in for an authorised bank verification API (external system, real clock: D19).

Phase 0 only exposes /health; the verification contract arrives in Phase 3.
Run: `python -m mock_bank.main [--reload]` (port MOCK_BANK_PORT, default 4000).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

app = FastAPI(title="Mock bank", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def main() -> None:
    import uvicorn

    reload = "--reload" in sys.argv[1:]
    port = int(os.environ.get("MOCK_BANK_PORT", "4000"))
    uvicorn.run("mock_bank.main:app", host="0.0.0.0", port=port, reload=reload)


if __name__ == "__main__":
    main()
