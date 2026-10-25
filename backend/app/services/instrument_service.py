from __future__ import annotations

from collections.abc import Mapping
from typing import TypedDict, cast

from ..db.pool import Conn, Db, get_pool, transaction
from ..domain import clock
from ..domain.access import AuthUser, actor_of, assert_can_see, scope_instruments_query
from ..domain.audit import record_event
from ..domain.errors import Conflict, InvalidState, NotFound, ValidationFailed
from ..domain.normalize import norm_amount
from ..repositories.document_repo import list_live_documents
from ..repositories.institution_repo import find_institution_by_id, list_regions
from ..repositories.instrument_repo import (
    EditableField,
    InstrumentChanges,
    InstrumentRow,
    ListFilters,
    ListItem,
    NewInstrument,
    delete_instrument,
    find_instrument_by_id,
    find_live_duplicate_ref,
    insert_instrument,
    lock_instrument,
    update_instrument_fields,
)
from ..repositories.instrument_repo import list_instruments as list_instrument_rows
from ..repositories.provenance_repo import ProvenanceRow, list_provenance
from ..repositories.rule_repo import get_rule_config
from ..schemas import InstrumentCreate, InstrumentListQuery, InstrumentPatch, date_order_issue
from ..shared_constants import (
    BANKS,
    DOC_TYPE_LABELS,
    DOC_TYPES,
    INSTRUMENT_TYPE_LABELS,
    INSTRUMENT_TYPES,
    STATUS_LABELS,
    DocType,
    InstrumentType,
)

# Statuses in which the institution may edit fields and documents (2.6).
EDITABLE_STATUSES = ("DRAFT", "RETURNED")


def is_editable(status: str) -> bool:
    return status in EDITABLE_STATUSES


class DocumentInfo(TypedDict):
    id: str
    instrumentId: str
    docType: DocType
    filename: str
    mimeType: str
    sizeBytes: int
    sha256: str
    uploadedBy: str
    uploadedAt: object


class InstrumentDetail(InstrumentRow):
    institutionName: str
    region: str
    documents: list[DocumentInfo]
    provenance: list[ProvenanceRow]
    daysToMaturity: int | None
    requiredDocs: list[DocType]
    missingDocs: list[DocType]
    lienRequired: bool


class DocRules(TypedDict):
    requiredDocs: dict[InstrumentType, list[DocType]]
    lienRequired: dict[InstrumentType, bool]


class TypeOption(TypedDict):
    value: str
    label: str


class Meta(TypedDict):
    banks: list[str]
    docTypes: list[TypeOption]
    instrumentTypes: list[TypeOption]
    regions: list[str]
    requiredDocs: dict[InstrumentType, list[DocType]]
    lienRequired: dict[InstrumentType, bool]


class InstrumentListResponse(TypedDict):
    items: list[ListItem]
    total: int
    page: int
    pageSize: int


def _as_mapping(v: object) -> Mapping[str, object]:
    return v if isinstance(v, dict) else {}


def doc_rules(db: Db) -> DocRules:
    """Current required_docs and lien_required rules (read per operation, rule 11)."""
    required = _as_mapping(get_rule_config(db, "required_docs"))
    lien = _as_mapping(get_rule_config(db, "lien_required"))
    return {
        "requiredDocs": {
            t: cast(list[DocType], list(cast(list[str], required.get(t) or []))) for t in INSTRUMENT_TYPES
        },
        "lienRequired": {t: bool(lien.get(t, False)) for t in INSTRUMENT_TYPES},
    }


def missing_docs(required: list[DocType], present: list[str]) -> list[DocType]:
    return [d for d in required if d not in present]


def assert_no_duplicate_ref(
    db: Db, instrument_id: str | None, issuing_bank: str | None, reference_no: str | None, parent_id: str | None
) -> None:
    """D7: 409 DUPLICATE_REFERENCE when another live instrument has the same bank and reference."""
    if not issuing_bank or not reference_no:
        return
    other = find_live_duplicate_ref(db, issuing_bank, reference_no, instrument_id, parent_id)
    if other:
        raise Conflict(
            f"{issuing_bank} reference {reference_no} is already on record (status: {STATUS_LABELS[other['status']]}). "
            "A reference can be lodged again only after the earlier instrument is released or renewed.",
            {"field": "referenceNo", "status": other["status"]},
            "DUPLICATE_REFERENCE",
        )


def lock_own_editable(tx: Conn, user: AuthUser, instrument_id: str, what: str = "edited") -> InstrumentRow:
    """Loads and locks an instrument the institution user owns and may still edit."""
    inst = lock_instrument(tx, instrument_id)
    assert_can_see(user, inst["institutionId"])
    if not is_editable(inst["status"]):
        raise InvalidState(
            f"This instrument is {STATUS_LABELS[inst['status']]} and can no longer be {what}",
            {"status": inst["status"]},
        )
    return inst


def get_instrument(user: AuthUser, instrument_id: str, db: Db | None = None) -> InstrumentDetail:
    db = db or get_pool()
    row = find_instrument_by_id(db, instrument_id)
    if row is None:
        raise NotFound("Instrument not found")
    assert_can_see(user, row["institutionId"])
    institution = find_institution_by_id(db, row["institutionId"])
    documents = list_live_documents(db, instrument_id)
    provenance = list_provenance(db, instrument_id)
    rules = doc_rules(db)
    today = clock.today(db)
    required = rules["requiredDocs"][row["type"]]
    return {
        **row,
        "institutionName": institution["name"] if institution else "",
        "region": institution["region"] if institution else "",
        "documents": [cast(DocumentInfo, {k: v for k, v in d.items() if k != "storagePath"}) for d in documents],
        "provenance": provenance,
        "daysToMaturity": clock.days_between(today, row["maturityDate"]) if row["maturityDate"] else None,
        "requiredDocs": required,
        "missingDocs": missing_docs(required, [d["docType"] for d in documents]),
        "lienRequired": rules["lienRequired"][row["type"]],
    }


def list_instruments(user: AuthUser, q: InstrumentListQuery) -> InstrumentListResponse:
    db = get_pool()
    today = clock.today(db)
    filters: ListFilters = {
        "status": q.status,
        "type": q.type,
        "bank": q.bank,
        "region": q.region,
        "institutionId": q.institution_id,
        "q": q.q,
        "maturityFrom": q.maturity_from,
        "maturityTo": q.maturity_to,
        "sort": q.sort,
        "page": q.page,
        "pageSize": q.page_size,
    }
    rows, total = list_instrument_rows(db, filters, today, lambda params: scope_instruments_query(user, params))
    return {"items": rows, "total": total, "page": q.page, "pageSize": q.page_size}


def get_meta() -> Meta:
    db = get_pool()
    rules = doc_rules(db)
    return {
        "banks": list(BANKS),
        "docTypes": [{"value": v, "label": DOC_TYPE_LABELS[v]} for v in DOC_TYPES],
        "instrumentTypes": [{"value": v, "label": INSTRUMENT_TYPE_LABELS[v]} for v in INSTRUMENT_TYPES],
        "regions": list_regions(db),
        "requiredDocs": rules["requiredDocs"],
        "lienRequired": rules["lienRequired"],
    }


FIELD_KEYS: tuple[EditableField, ...] = (
    "type", "referenceNo", "issuingBank", "branch", "amount", "issueDate", "maturityDate", "beneficiaryName",
    "lienMarked", "purpose",
)  # fmt: skip


def _field_values(row: Mapping[str, object]) -> dict[str, object]:
    return {k: row[k] for k in FIELD_KEYS}


def _same_value(key: EditableField, a: object, b: object) -> bool:
    if key == "amount" and isinstance(a, str) and isinstance(b, str):
        return norm_amount(a) == norm_amount(b)
    return a == b


def _assert_date_order(v: Mapping[str, object]) -> None:
    issue = date_order_issue(v.get("issueDate"), v.get("maturityDate"))
    if issue:
        raise ValidationFailed([issue])


def create_draft(user: AuthUser, data: InstrumentCreate) -> InstrumentDetail:
    values = data.provided()
    _assert_date_order(values)
    assert user.institutionId is not None
    with transaction() as tx:
        assert_no_duplicate_ref(tx, None, values.get("issuingBank"), values.get("referenceNo"), None)
        new = cast(NewInstrument, {**values, "institutionId": user.institutionId})
        row = insert_instrument(tx, new, clock.now(tx))
        record_event(
            tx,
            actor=actor_of(user),
            action="INSTRUMENT_CREATED",
            entity_type="instrument",
            entity_id=row["id"],
            instrument_id=row["id"],
            after=_field_values(row),
        )
        instrument_id = row["id"]
    return get_instrument(user, instrument_id)


def edit_instrument(user: AuthUser, instrument_id: str, data: InstrumentPatch) -> InstrumentDetail:
    """PATCH while DRAFT/RETURNED with the current version (D10); records only the changed fields (2.6)."""
    values = data.provided()
    with transaction() as tx:
        inst = lock_own_editable(tx, user, instrument_id)
        if inst["version"] != data.version:
            raise Conflict(
                "This record changed in another tab or by another user — reload and try again",
                {"currentVersion": inst["version"]},
                "STALE_VERSION",
            )
        if values.get("type") is not None and values["type"] != inst["type"] and inst["status"] != "DRAFT":
            raise ValidationFailed(
                [{"field": "type", "message": "The type can only be changed while the instrument is a draft"}]
            )
        changes: InstrumentChanges = {}
        before: dict[str, object] = {}
        for key in FIELD_KEYS:
            if key not in values or (key == "type" and values[key] is None):
                continue
            value = values[key]
            if _same_value(key, value, inst[key]):
                continue
            changes[key] = value
            before[key] = inst[key]
        if not changes:
            return get_instrument(user, instrument_id, tx)
        merged: dict[str, object] = {**inst, **cast(dict[str, object], changes)}
        _assert_date_order(merged)
        if "referenceNo" in changes or "issuingBank" in changes:
            assert_no_duplicate_ref(
                tx,
                inst["id"],
                cast(str | None, merged["issuingBank"]),
                cast(str | None, merged["referenceNo"]),
                inst["parentInstrumentId"],
            )
        updated = update_instrument_fields(tx, instrument_id, changes, data.version, clock.now(tx))
        if updated is None:
            raise Conflict("This record changed in another tab — reload and try again", None, "STALE_VERSION")
        record_event(
            tx,
            actor=actor_of(user),
            action="INSTRUMENT_EDITED",
            entity_type="instrument",
            entity_id=instrument_id,
            instrument_id=instrument_id,
            before=before,
            after={k: updated[k] for k in changes},
        )
    return get_instrument(user, instrument_id)


def delete_draft(user: AuthUser, instrument_id: str) -> None:
    """DELETE while DRAFT (D7): hard delete incl. provenance and document rows; files stay on disk."""
    with transaction() as tx:
        inst = lock_instrument(tx, instrument_id)
        assert_can_see(user, inst["institutionId"])
        if inst["status"] != "DRAFT":
            raise InvalidState(
                f"Only drafts can be deleted; this instrument is {STATUS_LABELS[inst['status']]}",
                {"status": inst["status"]},
            )
        documents = list_live_documents(tx, instrument_id)
        record_event(
            tx,
            actor=actor_of(user),
            action="INSTRUMENT_DRAFT_DELETED",
            entity_type="instrument",
            entity_id=instrument_id,
            instrument_id=instrument_id,
            before={
                **_field_values(inst),
                "documents": [{"id": d["id"], "docType": d["docType"], "sha256": d["sha256"]} for d in documents],
            },
        )
        delete_instrument(tx, instrument_id)
