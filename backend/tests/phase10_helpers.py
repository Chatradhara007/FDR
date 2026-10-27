"""Helpers for the post-Phase-09 feature tests (verifiable release order, advisory flags, PDF cross-check)."""

from __future__ import annotations

import io
from typing import Any

from app.seed.pdf import sample_document
from helpers import SeededUser, api, bearer, make_instrument, pdf_bytes, user_for
from httpx import Response
from pypdf import PdfReader, PdfWriter

REF = "CNRB/FD/2025/00042"
MATURITY = "2027-12-01"


def _post(user: SeededUser, path: str, body: dict[str, Any] | None = None) -> Response:
    return api().post(f"/api/v1{path}", headers=bearer(user), json=body or {})


def _ok(res: Response, status: int = 200) -> Any:
    assert res.status_code == status, res.text
    return res.json()


def approved_release(ref: str = REF, institution_email: str = "inst1@demo.in") -> tuple[str, str, str]:
    """An instrument released through the real workflow (request, conditions, recommend, approve).
    Returns (instrument id, release request id, order number)."""
    inst1, officer, approver = user_for(institution_email), user_for("officer@demo.in"), user_for("approver@demo.in")
    instrument_id = make_instrument("ACTIVE", MATURITY, ref=ref, institution_email=institution_email)
    view = _ok(_post(inst1, f"/instruments/{instrument_id}/release-requests", {"reason": "Obligation fulfilled"}), 201)
    rid = view["request"]["id"]
    res = api().post(
        f"/api/v1/release-requests/{rid}/documents",
        headers=bearer(inst1),
        data={"docType": "RELEASE_LETTER"},
        files={"file": ("letter.pdf", pdf_bytes(), "application/pdf")},
    )
    assert res.status_code == 201, res.text
    view = _ok(api().get(f"/api/v1/release-requests/{rid}", headers=bearer(officer)))
    for cond in view["conditions"]:
        if not cond["auto"]:
            res = api().patch(
                f"/api/v1/release-conditions/{cond['id']}", headers=bearer(officer),
                json={"met": True, "remarks": f"Checked {cond['code']}"},
            )  # fmt: skip
            assert res.status_code == 200, res.text
    _ok(_post(officer, f"/release-requests/{rid}/recommend", {"remarks": "All conditions met", "level": 1}))
    view = _ok(_post(approver, f"/release-requests/{rid}/decide",
                     {"decision": "APPROVE", "remarks": "Approved for release", "level": 2}))  # fmt: skip
    return instrument_id, rid, str(view["orderNumber"])


# ---- PDFs ----


def fdr_copy_pdf(
    *, reference: str = "SBIN/FDR/2026/00731", amount: str = "₹25,00,000", issue: str = "2026-04-01",
    maturity: str = "2027-04-01", tag: str = "",
) -> bytes:  # fmt: skip
    """A text-based FDR copy (the seed's sample writer) whose printed values we control."""
    rows = [("Deposit number", reference), ("Branch", "Begumpet"), ("Amount", amount), ("Date of issue", issue),
            ("Date of maturity", maturity), ("In favour of", "MEMBER SECRETARY AICTE"), ("Lien", "Marked")]  # fmt: skip
    return sample_document("FDR_COPY", rows, "Test Institution", "State Bank of India", tag)


def with_metadata(pdf: bytes, **metadata: str) -> bytes:
    """Re-writes `pdf` with the given document-info entries (e.g. {"/Producer": "Adobe Photoshop"})."""
    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(pdf)))
    writer.add_metadata(metadata)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def encrypted_pdf(pdf: bytes, password: str = "secret") -> bytes:
    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(pdf)))
    writer.encrypt(password)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def many_pages_pdf(pages: int) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
