"""PDF text cross-check: advisory findings, "text could not be read", the soft metadata signal, and the hard rule
that none of it ever changes a trust tier. Broken, encrypted, huge and many-page files become UNREADABLE."""

from __future__ import annotations

from typing import Any

import pytest
from app.db.pool import get_pool, many
from app.domain import doc_text
from helpers import (
    VALID_FDR,
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
from phase10_helpers import encrypted_pdf, fdr_copy_pdf, many_pages_pdf, with_metadata


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_db()
    set_today("2026-10-25")


_n = 0


def draft() -> tuple[SeededUser, str]:
    """A draft FDR (a fresh reference each time: D7 refuses two live instruments with one reference)."""
    global _n
    _n += 1
    inst1 = user_for("inst1@demo.in")
    return inst1, str(create_draft_via_api(inst1, {**VALID_FDR, "referenceNo": f"SBIN/FDR/2026/{_n:05d}"})["id"])


def ref_of(instrument_id: str) -> str:
    return str(
        many(get_pool(), "SELECT reference_no FROM instruments WHERE id = $1", [instrument_id])[0]["reference_no"]
    )


def findings(instrument_id: str) -> list[dict[str, Any]]:
    res = api().get(f"/api/v1/instruments/{instrument_id}/review", headers=bearer(user_for("officer@demo.in")))
    assert res.status_code == 200, res.text
    items: list[dict[str, Any]] = res.json()["documentFindings"]["items"]
    return items


def by_field(finding: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {c["field"]: c for c in finding["checks"]}


def test_matching_text_is_reported_field_by_field() -> None:
    inst1, instrument_id = draft()
    assert (
        upload_doc(inst1, instrument_id, "FDR_COPY", fdr_copy_pdf(reference=ref_of(instrument_id))).status_code == 201
    )
    [f] = findings(instrument_id)
    assert f["status"] == "READ" and f["docType"] == "FDR_COPY" and f["metadataSignal"] is None
    assert {c["result"] for c in f["checks"]} == {"MATCH"} and set(by_field(f)) == {
        "reference_no", "amount", "issue_date", "maturity_date",
    }  # fmt: skip
    assert "Advisory only" in f["advisoryLabel"]


def test_a_different_amount_says_what_the_document_says_and_what_was_claimed() -> None:
    inst1, instrument_id = draft()
    upload_doc(inst1, instrument_id, "FDR_COPY", fdr_copy_pdf(reference=ref_of(instrument_id), amount="₹20,00,000"))
    [f] = findings(instrument_id)
    amount = by_field(f)["amount"]
    assert (amount["result"], amount["found"], amount["claimed"]) == ("DIFFERENT", "2000000.00", "2500000.00")
    assert by_field(f)["reference_no"]["result"] == "MATCH"
    # Dates too, and a reference the document does not show.
    inst1, other = draft()
    upload_doc(inst1, other, "FDR_COPY", fdr_copy_pdf(reference="SBIN/FDR/2026/99999", maturity="2027-05-01"))
    checks = by_field(findings(other)[0])
    assert checks["reference_no"]["result"] == "DIFFERENT" and checks["reference_no"]["found"] == "SBIN/FDR/2026/99999"
    assert checks["maturity_date"] == {"field": "maturity_date", "claimed": "2027-04-01", "found": "2027-05-01",
                                       "result": "DIFFERENT"}  # fmt: skip


def test_the_comparison_follows_the_current_claim_without_re_reading_the_file() -> None:
    inst1, instrument_id = draft()
    upload_doc(inst1, instrument_id, "FDR_COPY", fdr_copy_pdf(reference=ref_of(instrument_id), amount="₹20,00,000"))
    assert by_field(findings(instrument_id)[0])["amount"]["result"] == "DIFFERENT"
    res = api().patch(f"/api/v1/instruments/{instrument_id}", headers=bearer(inst1),
                      json={"amount": "20,00,000", "version": 1})  # fmt: skip
    assert res.status_code == 200, res.text
    assert by_field(findings(instrument_id)[0])["amount"]["result"] == "MATCH"
    assert many(get_pool(), "SELECT count(*)::int AS n FROM document_findings")[0]["n"] == 1


def test_only_the_main_document_is_compared_but_every_pdf_is_read() -> None:
    inst1, instrument_id = draft()
    upload_doc(inst1, instrument_id, "FDR_COPY", fdr_copy_pdf(reference=ref_of(instrument_id)))
    upload_doc(inst1, instrument_id, "BANK_LETTER", fdr_copy_pdf(amount="₹20,00,000", tag="bank letter"))
    items = {f["docType"]: f for f in findings(instrument_id)}
    assert items["FDR_COPY"]["checks"] and items["BANK_LETTER"]["checks"] == []
    assert items["BANK_LETTER"]["status"] == "READ"


def test_scans_images_and_broken_files_say_the_text_could_not_be_read() -> None:
    inst1, instrument_id = draft()
    assert upload_doc(inst1, instrument_id, "FDR_COPY", many_pages_pdf(1)).status_code == 201  # a blank page: a scan
    from helpers import PNG_BYTES

    assert upload_doc(inst1, instrument_id, "OTHER", PNG_BYTES, "scan.png", "image/png").status_code == 201
    items = {f["docType"]: f for f in findings(instrument_id)}
    scan, image = items["FDR_COPY"], items["OTHER"]
    assert (scan["status"], scan["reason"]) == ("UNREADABLE", "NO_TEXT") and "scan" in scan["message"]
    assert (image["status"], image["reason"]) == ("UNREADABLE", "IMAGE") and image["checks"] == []


def test_a_broken_pdf_is_unreadable_and_the_upload_still_succeeds() -> None:
    inst1, instrument_id = draft()
    broken = b"%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 9 0 R >> endobj\n<<<< truncated \x00\xff\xfe"
    assert upload_doc(inst1, instrument_id, "FDR_COPY", broken).status_code == 201
    [f] = findings(instrument_id)
    assert (f["status"], f["reason"], f["checks"]) == ("UNREADABLE", "BROKEN", [])
    assert doc_text.analyse(broken)["reason"] == "BROKEN"
    assert doc_text.analyse(b"")["reason"] == "BROKEN"
    assert doc_text.analyse(pdf_bytes())["status"] == "UNREADABLE"  # the tests' minimal PDF has no page tree


def test_an_encrypted_pdf_is_unreadable_and_the_upload_still_succeeds() -> None:
    inst1, instrument_id = draft()
    assert upload_doc(inst1, instrument_id, "FDR_COPY", encrypted_pdf(fdr_copy_pdf())).status_code == 201
    [f] = findings(instrument_id)
    assert (f["status"], f["reason"], f["checks"]) == ("UNREADABLE", "ENCRYPTED", [])
    assert "password" in f["message"]


def test_huge_and_many_page_files_are_unreadable_without_being_parsed_to_the_end() -> None:
    assert doc_text.analyse(b"%PDF-1.4\n" + b"0" * (doc_text.MAX_BYTES + 1))["reason"] == "TOO_LARGE"
    assert doc_text.analyse(many_pages_pdf(doc_text.MAX_PAGES + 1))["reason"] == "TOO_MANY_PAGES"
    inst1, instrument_id = draft()
    assert upload_doc(inst1, instrument_id, "FDR_COPY", many_pages_pdf(doc_text.MAX_PAGES + 1)).status_code == 201
    assert findings(instrument_id)[0]["reason"] == "TOO_MANY_PAGES"


def test_analyse_never_raises_whatever_the_reader_does(monkeypatch: pytest.MonkeyPatch) -> None:
    class Boom:
        def __init__(self, *_: object, **__: object) -> None:
            raise RecursionError("hostile file")

    monkeypatch.setattr(doc_text, "PdfReader", Boom)
    assert doc_text.analyse(fdr_copy_pdf())["reason"] == "BROKEN"


def test_metadata_signal_modified_after_created_or_image_editor_is_soft() -> None:
    inst1, instrument_id = draft()
    edited = with_metadata(fdr_copy_pdf(), **{"/CreationDate": "D:20260101090000Z", "/ModDate": "D:20260301090000Z",
                                              "/Producer": "Adobe Photoshop 25"})  # fmt: skip
    upload_doc(inst1, instrument_id, "FDR_COPY", edited)
    [f] = findings(instrument_id)
    assert f["status"] == "READ" and set(f["metadataSignal"]["reasons"]) == {"MODIFIED_AFTER_CREATED", "IMAGE_EDITOR"}
    assert f["metadataSignal"]["producer"] == "Adobe Photoshop 25"
    # Re-saved within a minute is not a signal; a plain producer is not a signal.
    quiet = with_metadata(fdr_copy_pdf(tag="q"), **{"/CreationDate": "D:20260101090000Z",
                                                    "/ModDate": "D:20260101090030Z", "/Producer": "Word"})  # fmt: skip
    inst1, other = draft()
    upload_doc(inst1, other, "FDR_COPY", quiet)
    assert findings(other)[0]["metadataSignal"] is None


def test_nothing_here_changes_a_tier_a_status_or_a_verification_state() -> None:
    inst1, instrument_id = draft()
    before = many(
        get_pool(), "SELECT * FROM field_provenance WHERE instrument_id = $1 ORDER BY field_name", [instrument_id]
    )
    upload_doc(inst1, instrument_id, "FDR_COPY", fdr_copy_pdf(amount="₹1,00,000", reference="XXXX/0000/1111"))
    after = many(
        get_pool(), "SELECT * FROM field_provenance WHERE instrument_id = $1 ORDER BY field_name", [instrument_id]
    )
    assert before == after
    row = many(get_pool(), "SELECT status, verification_state FROM instruments WHERE id = $1", [instrument_id])[0]
    assert row == {"status": "DRAFT", "verification_state": "UNVERIFIED"}
    assert count_events("action = 'DOCUMENT_TEXT_CHECKED'") == 1


def test_institutions_get_no_findings_and_cannot_open_the_review() -> None:
    inst1, instrument_id = draft()
    upload_doc(inst1, instrument_id, "FDR_COPY", fdr_copy_pdf(amount="₹20,00,000"))
    for path in (f"/instruments/{instrument_id}", f"/instruments/{instrument_id}/passport"):
        text = api().get(f"/api/v1{path}", headers=bearer(inst1)).text.lower()
        assert "documentfindings" not in text and "document_text_checked" not in text and "advisory" not in text
    assert api().get(f"/api/v1/instruments/{instrument_id}/review", headers=bearer(inst1)).status_code == 403
    docs = api().get(f"/api/v1/instruments/{instrument_id}", headers=bearer(inst1)).json()["documents"]
    assert docs and all("extracted" not in d and "status" not in d for d in docs)


def test_release_documents_are_not_read() -> None:
    from phase10_helpers import approved_release

    approved_release()
    assert count_events("action = 'DOCUMENT_TEXT_CHECKED'") == 0
