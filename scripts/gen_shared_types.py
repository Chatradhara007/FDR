"""Writes shared/src/constants.gen.ts (TypeScript literal union types) from shared/constants.json.

shared/constants.json is the single source of truth; the frontend imports the JSON for values and this
generated file for types. Run via `npm run gen:shared` after editing the JSON (a test checks it is in sync).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "shared" / "constants.json"
TARGET = ROOT / "shared" / "src" / "constants.gen.ts"

# TS type name -> key of a string array in constants.json
UNIONS = {
    "Role": "roles",
    "InstrumentType": "instrumentTypes",
    "InstrumentStatus": "instrumentStatuses",
    "TrustTier": "trustTiers",
    "VerificationState": "verificationStates",
    "DocType": "docTypes",
    "TrackedField": "trackedFields",
    "Bank": "banks",
    "VerificationResult": "verificationResults",
    "ObservationSeverity": "observationSeverities",
}


def render() -> str:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    lines = [
        "// Generated from shared/constants.json by scripts/gen_shared_types.py. Do not edit by hand.",
        "",
    ]
    for name, key in UNIONS.items():
        members = " | ".join(json.dumps(v, ensure_ascii=False).replace('"', "'") for v in data[key])
        lines.append(f"export type {name} = {members};")
    return "\n".join(lines) + "\n"


def main() -> int:
    content = render()
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != content:
            print(f"{TARGET.relative_to(ROOT)} is out of date; run `npm run gen:shared`", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(content, encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
