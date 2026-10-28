from __future__ import annotations

from typing import TypedDict, cast

from ..db.pool import Db, many, maybe_one, one


class NewInstitution(TypedDict):
    aicte_id: str
    name: str
    region: str
    state: str
    contact_email: str | None


class InstitutionRow(NewInstitution):
    id: str


def upsert_institution(db: Db, i: NewInstitution, institution_id: str | None = None) -> InstitutionRow:
    """Inserts unless the AICTE id exists. `institution_id` fixes the row id (the demo seed's stable ids)."""
    row = one(
        db,
        """INSERT INTO institutions (id, aicte_id, name, region, state, contact_email)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)
     ON CONFLICT (aicte_id) DO UPDATE SET aicte_id = EXCLUDED.aicte_id
     RETURNING *""",
        [institution_id, i["aicte_id"], i["name"], i["region"], i["state"], i["contact_email"]],
    )
    return cast(InstitutionRow, row)


def find_institution_by_id(db: Db, institution_id: str) -> InstitutionRow | None:
    return cast(InstitutionRow | None, maybe_one(db, "SELECT * FROM institutions WHERE id = $1", [institution_id]))


def list_regions(db: Db) -> list[str]:
    return [
        r["region"] for r in many(db, 'SELECT region FROM institutions GROUP BY region ORDER BY region COLLATE "C"')
    ]
