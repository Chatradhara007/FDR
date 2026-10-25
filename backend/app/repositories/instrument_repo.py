from __future__ import annotations

import re
from collections.abc import Callable
from datetime import datetime
from typing import Literal, TypedDict, cast

from ..db.pool import Db, exec_, many, maybe_one, one
from ..shared_constants import InstrumentStatus, InstrumentType, VerificationState


class InstrumentRow(TypedDict):
    """Row as the API returns it (camelCase via column aliases)."""

    id: str
    institutionId: str
    type: InstrumentType
    referenceNo: str | None
    issuingBank: str | None
    branch: str | None
    amount: str | None
    issueDate: str | None
    maturityDate: str | None
    beneficiaryName: str | None
    lienMarked: bool
    purpose: str | None
    status: InstrumentStatus
    statusBeforeRelease: InstrumentStatus | None
    verificationState: VerificationState
    acceptedWithOverride: bool
    overrideNote: str | None
    assignedOfficerId: str | None
    parentInstrumentId: str | None
    submittedAt: datetime | None
    acceptedAt: datetime | None
    acceptedBy: str | None
    version: int
    createdAt: datetime
    updatedAt: datetime


INSTRUMENT_COLUMNS = """
  i.id, i.institution_id AS "institutionId", i.type, i.reference_no AS "referenceNo", i.issuing_bank AS "issuingBank",
  i.branch, i.amount, i.issue_date AS "issueDate", i.maturity_date AS "maturityDate",
  i.beneficiary_name AS "beneficiaryName", i.lien_marked AS "lienMarked", i.purpose, i.status,
  i.status_before_release AS "statusBeforeRelease", i.verification_state AS "verificationState",
  i.accepted_with_override AS "acceptedWithOverride", i.override_note AS "overrideNote",
  i.assigned_officer_id AS "assignedOfficerId", i.parent_instrument_id AS "parentInstrumentId",
  i.submitted_at AS "submittedAt", i.accepted_at AS "acceptedAt", i.accepted_by AS "acceptedBy",
  i.version, i.created_at AS "createdAt", i.updated_at AS "updatedAt\""""


def find_instrument_by_id(db: Db, instrument_id: str) -> InstrumentRow | None:
    row = maybe_one(db, f"SELECT {INSTRUMENT_COLUMNS} FROM instruments i WHERE i.id = $1", [instrument_id])
    return cast(InstrumentRow | None, row)


def lock_instrument(db: Db, instrument_id: str) -> InstrumentRow:
    return cast(
        InstrumentRow,
        one(
            db,
            f"SELECT {INSTRUMENT_COLUMNS} FROM instruments i WHERE i.id = $1 FOR UPDATE",
            [instrument_id],
            "Instrument not found",
        ),
    )


class NewInstrument(TypedDict, total=False):
    institutionId: str
    type: InstrumentType
    referenceNo: str | None
    issuingBank: str | None
    branch: str | None
    amount: str | None
    issueDate: str | None
    maturityDate: str | None
    beneficiaryName: str | None
    lienMarked: bool
    purpose: str | None
    parentInstrumentId: str | None


def insert_instrument(db: Db, n: NewInstrument, at: datetime) -> InstrumentRow:
    """New instruments always start as DRAFT; created_at/updated_at come from the app clock."""
    row = one(
        db,
        f"""WITH ins AS (
       INSERT INTO instruments (institution_id, type, reference_no, issuing_bank, branch, amount, issue_date,
                                maturity_date, beneficiary_name, lien_marked, purpose, parent_instrument_id,
                                created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       RETURNING *)
     SELECT {INSTRUMENT_COLUMNS} FROM ins i""",
        [
            n["institutionId"], n["type"], n.get("referenceNo"), n.get("issuingBank"), n.get("branch"),
            n.get("amount"), n.get("issueDate"), n.get("maturityDate"), n.get("beneficiaryName"),
            n.get("lienMarked", False), n.get("purpose"), n.get("parentInstrumentId"), at,
        ],
    )  # fmt: skip
    return cast(InstrumentRow, row)


EditableField = Literal[
    "type", "referenceNo", "issuingBank", "branch", "amount", "issueDate", "maturityDate", "beneficiaryName",
    "lienMarked", "purpose",
]  # fmt: skip

# Editable columns, API name -> column. The only columns update_instrument_fields may touch.
EDITABLE_COLUMNS: dict[EditableField, str] = {
    "type": "type",
    "referenceNo": "reference_no",
    "issuingBank": "issuing_bank",
    "branch": "branch",
    "amount": "amount",
    "issueDate": "issue_date",
    "maturityDate": "maturity_date",
    "beneficiaryName": "beneficiary_name",
    "lienMarked": "lien_marked",
    "purpose": "purpose",
}

InstrumentChanges = dict[EditableField, str | bool | None]


def update_instrument_fields(
    db: Db, instrument_id: str, changes: InstrumentChanges, expected_version: int, at: datetime
) -> InstrumentRow | None:
    """Applies field edits if the row still has `expected_version` (D10); bumps version.

    Returns the updated row, or None when the version no longer matches.
    """
    params: list[object] = [instrument_id, expected_version, at]
    sets = ["version = version + 1", "updated_at = $3"]
    for key, value in changes.items():
        params.append(value)
        sets.append(f"{EDITABLE_COLUMNS[key]} = ${len(params)}")
    row = maybe_one(
        db,
        f"""WITH upd AS (UPDATE instruments SET {", ".join(sets)} WHERE id = $1 AND version = $2 RETURNING *)
     SELECT {INSTRUMENT_COLUMNS} FROM upd i""",
        params,
    )
    return cast(InstrumentRow | None, row)


def set_submission_meta(
    db: Db, instrument_id: str, submitted_at: datetime, verification_state: VerificationState
) -> None:
    """Submission bookkeeping (status itself changes only through transition())."""
    exec_(
        db,
        "UPDATE instruments SET submitted_at = $2, verification_state = $3, version = version + 1, updated_at = $2"
        " WHERE id = $1",
        [instrument_id, submitted_at, verification_state],
    )


def delete_instrument(db: Db, instrument_id: str) -> None:
    """Hard delete (DRAFT only, checked by the service); provenance and document rows cascade, files stay on disk."""
    exec_(db, "DELETE FROM instruments WHERE id = $1", [instrument_id])


class DuplicateRef(TypedDict):
    id: str
    status: InstrumentStatus
    institutionId: str


def find_live_duplicate_ref(
    db: Db, bank: str, reference_no: str, exclude_id: str | None, parent_id: str | None
) -> DuplicateRef | None:
    """D7: another non-terminal instrument with the same bank and normalised reference,
    excluding the instrument itself and its own parent."""
    row = maybe_one(
        db,
        """SELECT id, status, institution_id AS "institutionId" FROM instruments
      WHERE issuing_bank = $1
        AND regexp_replace(upper(reference_no), '\\s', '', 'g') = $2
        AND status NOT IN ('RENEWED', 'RELEASED')
        AND ($3::uuid IS NULL OR id <> $3)
        AND ($4::uuid IS NULL OR id <> $4)
      ORDER BY created_at LIMIT 1""",
        [bank, reference_no, exclude_id, parent_id],
    )
    return cast(DuplicateRef | None, row)


InstrumentSort = Literal[
    "maturityDate", "-maturityDate", "amount", "-amount", "createdAt", "-createdAt", "updatedAt", "-updatedAt",
    "referenceNo", "-referenceNo",
]  # fmt: skip

SORT_SQL: dict[str, str] = {
    "maturityDate": "i.maturity_date ASC NULLS LAST",
    "-maturityDate": "i.maturity_date DESC NULLS LAST",
    "amount": "i.amount ASC NULLS LAST",
    "-amount": "i.amount DESC NULLS LAST",
    "createdAt": "i.created_at ASC",
    "-createdAt": "i.created_at DESC",
    "updatedAt": "i.updated_at ASC",
    "-updatedAt": "i.updated_at DESC",
    "referenceNo": "i.reference_no ASC NULLS LAST",
    "-referenceNo": "i.reference_no DESC NULLS LAST",
}


class ListFilters(TypedDict):
    status: list[InstrumentStatus] | None
    type: InstrumentType | None
    bank: str | None
    region: str | None
    institutionId: str | None
    q: str | None
    maturityFrom: str | None
    maturityTo: str | None
    sort: InstrumentSort
    page: int
    pageSize: int


class ListItem(TypedDict):
    id: str
    type: InstrumentType
    referenceNo: str | None
    issuingBank: str | None
    amount: str | None
    issueDate: str | None
    maturityDate: str | None
    status: InstrumentStatus
    verificationState: VerificationState
    institutionId: str
    institutionName: str
    region: str
    daysToMaturity: int | None
    version: int
    updatedAt: datetime


def list_instruments(
    db: Db, q: ListFilters, today: str, scope: Callable[[list[object]], str]
) -> tuple[list[ListItem], int]:
    """Filtered, sorted, paged list. `scope` returns the access filter (appending its parameter);
    `today` is the app clock's business date for daysToMaturity."""
    params: list[object] = [today]
    where: list[str] = [f"true{scope(params)}"]

    def add(sql: Callable[[str], str], value: object) -> None:
        params.append(value)
        where.append(sql(f"${len(params)}"))

    if q["status"]:
        add(lambda p: f"i.status = ANY({p}::instrument_status[])", q["status"])
    if q["type"]:
        add(lambda p: f"i.type = {p}", q["type"])
    if q["bank"]:
        add(lambda p: f"i.issuing_bank = {p}", q["bank"])
    if q["region"]:
        add(lambda p: f"inst.region = {p}", q["region"])
    if q["institutionId"]:
        add(lambda p: f"i.institution_id = {p}", q["institutionId"])
    if q["maturityFrom"]:
        add(lambda p: f"i.maturity_date >= {p}", q["maturityFrom"])
    if q["maturityTo"]:
        add(lambda p: f"i.maturity_date <= {p}", q["maturityTo"])
    if q["q"]:
        like = "%" + re.sub(r"[\\%_]", lambda m: "\\" + m.group(0), q["q"]) + "%"
        add(lambda p: f"(i.reference_no ILIKE {p} OR i.beneficiary_name ILIKE {p} OR inst.name ILIKE {p})", like)
    params.extend([q["pageSize"], (q["page"] - 1) * q["pageSize"]])
    rows = many(
        db,
        f"""SELECT i.id, i.type, i.reference_no AS "referenceNo", i.issuing_bank AS "issuingBank", i.amount,
            i.issue_date AS "issueDate", i.maturity_date AS "maturityDate", i.status,
            i.verification_state AS "verificationState", i.institution_id AS "institutionId",
            inst.name AS "institutionName", inst.region, (i.maturity_date - $1::date) AS "daysToMaturity",
            i.version, i.updated_at AS "updatedAt", count(*) OVER () AS total
       FROM instruments i JOIN institutions inst ON inst.id = i.institution_id
      WHERE {" AND ".join(where)}
      ORDER BY {SORT_SQL[q["sort"]]}, i.id
      LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        params,
    )
    total = int(rows[0]["total"]) if rows else 0
    if not rows and q["page"] > 1:
        # Past the last page: still report the real total.
        c = one(
            db,
            "SELECT count(*) AS n, $1::date AS today FROM instruments i JOIN institutions inst"
            f" ON inst.id = i.institution_id WHERE {' AND '.join(where)}",
            params[:-2],
        )
        total = int(c["n"])
    items = [cast(ListItem, {k: v for k, v in r.items() if k != "total"}) for r in rows]
    return items, total
