from __future__ import annotations

import re
import threading
from datetime import UTC, datetime

import psycopg
import pytest
from app.db.pool import exec_, get_pool, many, transaction
from app.domain.audit import Actor, event_hash, record_event, verify_chain
from helpers import reset_db


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_db()


ENTITY = "11111111-1111-1111-1111-111111111111"


def write_some(n: int) -> None:
    for i in range(n):
        with transaction() as tx:
            record_event(
                tx,
                actor=Actor(label="system") if i % 2 else Actor(id=ENTITY, label="Anjali Deshmukh"),
                action="TEST_EVENT",
                entity_type="instrument",
                entity_id=ENTITY,
                instrument_id=None if i % 2 else ENTITY,
                before={"z": i, "a": [1, {"y": "b", "x": "a"}], "nested": {"k2": True, "k1": None}} if i else None,
                after={"amount": "2500000.00", "when": datetime(2027, 3, 31, tzinfo=UTC), "n": i},
            )


def test_ac7_an_intact_chain_verifies_links_and_genesis_are_as_specified() -> None:
    assert verify_chain(get_pool()) == {"ok": True, "checked": 0, "firstBrokenId": None}
    write_some(6)
    assert verify_chain(get_pool()) == {"ok": True, "checked": 6, "firstBrokenId": None}
    rows = many(get_pool(), "SELECT * FROM events ORDER BY id")
    assert [r["id"] for r in rows] == [1, 2, 3, 4, 5, 6]
    assert rows[0]["prev_hash"] is None
    for i in range(1, len(rows)):
        assert rows[i]["prev_hash"] == rows[i - 1]["hash"]
    assert rows[0]["hash"] == event_hash(None, rows[0])
    assert re.fullmatch(r"[0-9a-f]{64}", rows[0]["hash"])
    # JSONB holds the JSON round trip: the timestamp in after_json is an ISO string.
    assert rows[0]["after_json"]["when"] == "2027-03-31T00:00:00.000Z"


def test_ac7_altering_one_event_row_breaks_the_chain_at_that_id() -> None:
    write_some(5)
    with transaction() as tx:
        exec_(tx, "SET LOCAL fdr.allow_tamper = 'on'")
        exec_(tx, """UPDATE events SET after_json = '{"amount":"25.00","n":2}' WHERE id = 3""")
    assert verify_chain(get_pool()) == {"ok": False, "checked": 3, "firstBrokenId": 3}


def test_ac7_deleting_an_event_also_breaks_the_chain() -> None:
    write_some(4)
    with transaction() as tx:
        exec_(tx, "SET LOCAL fdr.allow_tamper = 'on'")
        exec_(tx, "DELETE FROM events WHERE id = 2")
    result = verify_chain(get_pool())
    assert result["ok"] is False and result["firstBrokenId"] == 3


def test_ac8_plain_update_and_delete_on_events_are_rejected() -> None:
    write_some(2)
    with pytest.raises(psycopg.Error, match="append-only"):
        exec_(get_pool(), "UPDATE events SET actor_label = 'x' WHERE id = 1")
    with pytest.raises(psycopg.Error, match="append-only"):
        exec_(get_pool(), "DELETE FROM events WHERE id = 1")
    # The tamper setting is transaction-local: it does not leak to later statements.
    with transaction() as tx:
        exec_(tx, "SET LOCAL fdr.allow_tamper = 'on'")
    with pytest.raises(psycopg.Error, match="append-only"):
        exec_(get_pool(), "UPDATE events SET actor_label = 'x' WHERE id = 1")
    result = verify_chain(get_pool())
    assert result["ok"] is True and result["checked"] == 2


def test_concurrent_writers_still_produce_one_valid_chain() -> None:
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            write_some(2)
        except BaseException as e:
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert verify_chain(get_pool()) == {"ok": True, "checked": 16, "firstBrokenId": None}
