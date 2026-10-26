from __future__ import annotations

import hashlib
import re

import pytest
from app.config import config
from app.db.pool import get_pool, one
from app.services.storage import read_stored
from helpers import (
    PNG_BYTES,
    SeededUser,
    api,
    bearer,
    count_events,
    create_draft_via_api,
    pdf_bytes,
    reset_db,
    set_today,
    upload_doc,
    user_for,
)


@pytest.fixture
def inst1() -> SeededUser:
    reset_db()
    set_today("2026-10-25")
    return user_for("inst1@demo.in")


def doc_url(instrument_id: str, doc_id: str, kind: str = "download") -> str:
    return f"/api/v1/instruments/{instrument_id}/documents/{doc_id}/{kind}"


def test_stores_the_file_under_storage_dir_with_checksum_never_the_original_name(inst1: SeededUser) -> None:
    instrument_id = create_draft_via_api(inst1)["id"]
    data = pdf_bytes("fixed")
    res = upload_doc(inst1, instrument_id, "FDR_COPY", data, '../../etc/My "FDR".pdf')
    assert res.status_code == 201
    body = res.json()
    assert body["duplicateOf"] is None
    doc = body["document"]
    assert (doc["docType"], doc["mimeType"], doc["sizeBytes"], doc["filename"]) == (
        "FDR_COPY", "application/pdf", len(data), "My FDR.pdf",
    )  # fmt: skip
    assert "storagePath" not in doc

    row = one(get_pool(), "SELECT storage_path, sha256 FROM documents WHERE id = $1", [doc["id"]])
    assert re.fullmatch(rf"{instrument_id}/[0-9a-f-]{{36}}\.pdf", row["storage_path"])
    assert (config.storage_dir / row["storage_path"]).exists()
    assert read_stored(row["storage_path"]) == data  # encrypted at rest since Phase 8 (test_phase08_security)
    assert row["sha256"] == hashlib.sha256(data).hexdigest()
    assert count_events("action = 'DOCUMENT_UPLOADED' AND instrument_id = $1", [instrument_id]) == 1


def test_ac4_inst2_cant_download_inst1_file_officer_can_every_download_logs(inst1: SeededUser) -> None:
    instrument_id = create_draft_via_api(inst1)["id"]
    data = pdf_bytes()
    doc_id = upload_doc(inst1, instrument_id, "FDR_COPY", data, "fdr copy.pdf").json()["document"]["id"]

    inst2 = user_for("inst2@demo.in")
    assert api().get(doc_url(instrument_id, doc_id), headers=bearer(inst2)).status_code == 404
    assert api().get(doc_url(instrument_id, doc_id, "preview"), headers=bearer(inst2)).status_code == 404
    assert count_events("action = 'DOCUMENT_ACCESSED'") == 0

    officer = user_for("officer@demo.in")
    dl = api().get(doc_url(instrument_id, doc_id), headers=bearer(officer))
    assert dl.status_code == 200
    assert dl.headers["content-type"] == "application/pdf"
    assert dl.headers["content-disposition"].startswith('attachment; filename="fdr copy.pdf"')
    assert dl.content == data

    pv = api().get(doc_url(instrument_id, doc_id, "preview"), headers=bearer(officer))
    assert pv.status_code == 200
    assert pv.headers["content-disposition"].startswith("inline;")

    assert api().get(doc_url(instrument_id, doc_id), headers=bearer(inst1)).status_code == 200
    for email in ("approver@demo.in", "admin@demo.in", "auditor@demo.in"):
        assert api().get(doc_url(instrument_id, doc_id), headers=bearer(user_for(email))).status_code == 200, email
    assert count_events("action = 'DOCUMENT_ACCESSED' AND entity_id = $1", [doc_id]) == 6
    assert api().get(doc_url(instrument_id, doc_id)).status_code == 401


def test_ac5_a_renamed_non_pdf_with_pdf_extension_is_rejected(inst1: SeededUser) -> None:
    instrument_id = create_draft_via_api(inst1)["id"]
    res = upload_doc(inst1, instrument_id, "FDR_COPY", b"MZ\x90\x00 this is really an executable or text", "fdr.pdf")
    assert res.status_code == 422
    assert res.json()["code"] == "UNSUPPORTED_FILE_TYPE"
    assert count_events("action = 'DOCUMENT_UPLOADED'") == 0
    # PNG and JPEG are accepted by content.
    png = upload_doc(inst1, instrument_id, "BANK_LETTER", PNG_BYTES, "letter.pdf")
    assert png.status_code == 201
    assert png.json()["document"]["mimeType"] == "image/png"


def test_ac6_uploading_the_same_bytes_again_returns_duplicate_of(inst1: SeededUser) -> None:
    instrument_id = create_draft_via_api(inst1)["id"]
    data = pdf_bytes("same")
    a = upload_doc(inst1, instrument_id, "FDR_COPY", data)
    b = upload_doc(inst1, instrument_id, "BANK_LETTER", data)
    assert b.status_code == 201
    assert b.json()["duplicateOf"] == a.json()["document"]["id"]


def test_d15_delete_is_soft_hides_the_document_keeps_the_file_ignored_by_duplicates(inst1: SeededUser) -> None:
    instrument_id = create_draft_via_api(inst1)["id"]
    data = pdf_bytes("soft")
    doc_id = upload_doc(inst1, instrument_id, "FDR_COPY", data).json()["document"]["id"]
    deleted = api().delete(f"/api/v1/instruments/{instrument_id}/documents/{doc_id}", headers=bearer(inst1))
    assert deleted.status_code == 204

    detail = api().get(f"/api/v1/instruments/{instrument_id}", headers=bearer(inst1)).json()
    assert detail["documents"] == []
    assert detail["missingDocs"] == ["FDR_COPY", "BANK_LETTER"]
    row = one(get_pool(), "SELECT deleted_at, storage_path FROM documents WHERE id = $1", [doc_id])
    assert row["deleted_at"] is not None
    assert (config.storage_dir / row["storage_path"]).exists()
    assert count_events("action = 'DOCUMENT_REMOVED' AND entity_id = $1", [doc_id]) == 1
    assert api().get(doc_url(instrument_id, doc_id), headers=bearer(inst1)).status_code == 404

    again = upload_doc(inst1, instrument_id, "FDR_COPY", data)
    assert again.json()["duplicateOf"] is None


def test_upload_validation_missing_file_and_doc_type_listed_together_too_large_422(inst1: SeededUser) -> None:
    instrument_id = create_draft_via_api(inst1)["id"]
    res = api().post(
        f"/api/v1/instruments/{instrument_id}/documents",
        headers=bearer(inst1),
        files={"docType": (None, "NOPE")},
    )
    assert res.status_code == 422
    assert sorted(d["field"] for d in res.json()["details"]) == ["docType", "file"]

    big = pdf_bytes() + bytes(10 * 1024 * 1024)
    too_big = upload_doc(inst1, instrument_id, "FDR_COPY", big)
    assert too_big.status_code == 422
    assert too_big.json()["code"] == "FILE_TOO_LARGE"


def test_other_institutions_and_aicte_roles_cant_upload(inst1: SeededUser) -> None:
    instrument_id = create_draft_via_api(inst1)["id"]
    assert upload_doc(user_for("inst2@demo.in"), instrument_id, "FDR_COPY").status_code == 404
    assert upload_doc(user_for("officer@demo.in"), instrument_id, "FDR_COPY").status_code == 403
