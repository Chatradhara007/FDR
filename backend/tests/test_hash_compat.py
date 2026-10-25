"""Golden vectors produced by the original TypeScript implementation (canonicalJson + eventHash) before
the backend moved to Python. Chains written by the old backend must still verify, byte for byte."""

from __future__ import annotations

import json
from pathlib import Path

from app.domain.audit import event_hash
from app.domain.canonical_json import canonical_json

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "ts_hash_vectors.json").read_text(encoding="utf-8"))


def test_canonical_json_matches_the_typescript_output() -> None:
    for case in VECTORS["canonical"]:
        assert canonical_json(case["value"]) == case["json"], case["json"]


def test_event_hashes_and_links_match_the_typescript_chain() -> None:
    prev = None
    for e in VECTORS["events"]:
        assert e["prev_hash"] == prev
        assert event_hash(prev, e) == e["hash"], e["id"]
        prev = e["hash"]
