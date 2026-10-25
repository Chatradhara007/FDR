import type {
  Instrument, InstrumentListItem, InstrumentListQuery, InstrumentStatus, InstrumentType, VerificationState,
} from '@fdr/shared';
import { exec, many, maybeOne, one, type Db } from '../db/pool';

/** Row as the API returns it (camelCase via column aliases; timestamps arrive as Date). */
export type InstrumentRow = Omit<Instrument, 'submittedAt' | 'acceptedAt' | 'createdAt' | 'updatedAt'> & {
  submittedAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const INSTRUMENT_COLUMNS = `
  i.id, i.institution_id AS "institutionId", i.type, i.reference_no AS "referenceNo", i.issuing_bank AS "issuingBank",
  i.branch, i.amount, i.issue_date AS "issueDate", i.maturity_date AS "maturityDate",
  i.beneficiary_name AS "beneficiaryName", i.lien_marked AS "lienMarked", i.purpose, i.status,
  i.status_before_release AS "statusBeforeRelease", i.verification_state AS "verificationState",
  i.accepted_with_override AS "acceptedWithOverride", i.override_note AS "overrideNote",
  i.assigned_officer_id AS "assignedOfficerId", i.parent_instrument_id AS "parentInstrumentId",
  i.submitted_at AS "submittedAt", i.accepted_at AS "acceptedAt", i.accepted_by AS "acceptedBy",
  i.version, i.created_at AS "createdAt", i.updated_at AS "updatedAt"`;

export async function findInstrumentById(db: Db, id: string): Promise<InstrumentRow | null> {
  return maybeOne<InstrumentRow>(db, `SELECT ${INSTRUMENT_COLUMNS} FROM instruments i WHERE i.id = $1`, [id]);
}

export async function lockInstrument(db: Db, id: string): Promise<InstrumentRow> {
  return one<InstrumentRow>(
    db,
    `SELECT ${INSTRUMENT_COLUMNS} FROM instruments i WHERE i.id = $1 FOR UPDATE`,
    [id],
    'Instrument not found',
  );
}

export interface NewInstrument {
  institutionId: string;
  type: InstrumentType;
  referenceNo?: string | null;
  issuingBank?: string | null;
  branch?: string | null;
  amount?: string | null;
  issueDate?: string | null;
  maturityDate?: string | null;
  beneficiaryName?: string | null;
  lienMarked?: boolean;
  purpose?: string | null;
  parentInstrumentId?: string | null;
}

/** New instruments always start as DRAFT; created_at/updated_at come from the app clock. */
export async function insertInstrument(db: Db, n: NewInstrument, at: Date): Promise<InstrumentRow> {
  return one<InstrumentRow>(
    db,
    `WITH ins AS (
       INSERT INTO instruments (institution_id, type, reference_no, issuing_bank, branch, amount, issue_date,
                                maturity_date, beneficiary_name, lien_marked, purpose, parent_instrument_id,
                                created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       RETURNING *)
     SELECT ${INSTRUMENT_COLUMNS} FROM ins i`,
    [
      n.institutionId, n.type, n.referenceNo ?? null, n.issuingBank ?? null, n.branch ?? null, n.amount ?? null,
      n.issueDate ?? null, n.maturityDate ?? null, n.beneficiaryName ?? null, n.lienMarked ?? false,
      n.purpose ?? null, n.parentInstrumentId ?? null, at,
    ],
  );
}

/** Editable columns, API name → column. The only columns updateInstrumentFields may touch. */
const EDITABLE_COLUMNS = {
  type: 'type',
  referenceNo: 'reference_no',
  issuingBank: 'issuing_bank',
  branch: 'branch',
  amount: 'amount',
  issueDate: 'issue_date',
  maturityDate: 'maturity_date',
  beneficiaryName: 'beneficiary_name',
  lienMarked: 'lien_marked',
  purpose: 'purpose',
} as const;
export type EditableField = keyof typeof EDITABLE_COLUMNS;
export type InstrumentChanges = Partial<Record<EditableField, string | boolean | null>>;

/**
 * Applies field edits if the row still has `expectedVersion` (D10); bumps version.
 * Returns the updated row, or null when the version no longer matches.
 */
export async function updateInstrumentFields(
  db: Db,
  id: string,
  changes: InstrumentChanges,
  expectedVersion: number,
  at: Date,
): Promise<InstrumentRow | null> {
  const params: unknown[] = [id, expectedVersion, at];
  const sets = ['version = version + 1', 'updated_at = $3'];
  for (const [key, value] of Object.entries(changes) as [EditableField, unknown][]) {
    params.push(value);
    sets.push(`${EDITABLE_COLUMNS[key]} = $${params.length}`);
  }
  return maybeOne<InstrumentRow>(
    db,
    `WITH upd AS (UPDATE instruments SET ${sets.join(', ')} WHERE id = $1 AND version = $2 RETURNING *)
     SELECT ${INSTRUMENT_COLUMNS} FROM upd i`,
    params,
  );
}

/** Submission bookkeeping (status itself changes only through transition()). */
export async function setSubmissionMeta(
  db: Db,
  id: string,
  m: { submittedAt: Date; verificationState: VerificationState },
): Promise<void> {
  await exec(
    db,
    `UPDATE instruments SET submitted_at = $2, verification_state = $3, version = version + 1, updated_at = $2 WHERE id = $1`,
    [id, m.submittedAt, m.verificationState],
  );
}

/** Hard delete (DRAFT only, checked by the service); provenance and document rows cascade, files stay on disk. */
export async function deleteInstrument(db: Db, id: string): Promise<void> {
  await exec(db, 'DELETE FROM instruments WHERE id = $1', [id]);
}

/**
 * D7: another non-terminal instrument with the same bank and normalised reference,
 * excluding the instrument itself and its own parent.
 */
export async function findLiveDuplicateRef(
  db: Db,
  bank: string,
  referenceNo: string,
  excludeId: string | null,
  parentId: string | null,
): Promise<{ id: string; status: InstrumentStatus; institutionId: string } | null> {
  return maybeOne(
    db,
    `SELECT id, status, institution_id AS "institutionId" FROM instruments
      WHERE issuing_bank = $1
        AND regexp_replace(upper(reference_no), '\\s', '', 'g') = $2
        AND status NOT IN ('RENEWED', 'RELEASED')
        AND ($3::uuid IS NULL OR id <> $3)
        AND ($4::uuid IS NULL OR id <> $4)
      ORDER BY created_at LIMIT 1`,
    [bank, referenceNo, excludeId, parentId],
  );
}

const SORT_SQL: Record<InstrumentListQuery['sort'], string> = {
  maturityDate: 'i.maturity_date ASC NULLS LAST',
  '-maturityDate': 'i.maturity_date DESC NULLS LAST',
  amount: 'i.amount ASC NULLS LAST',
  '-amount': 'i.amount DESC NULLS LAST',
  createdAt: 'i.created_at ASC',
  '-createdAt': 'i.created_at DESC',
  updatedAt: 'i.updated_at ASC',
  '-updatedAt': 'i.updated_at DESC',
  referenceNo: 'i.reference_no ASC NULLS LAST',
  '-referenceNo': 'i.reference_no DESC NULLS LAST',
};

type ListRow = Omit<InstrumentListItem, 'updatedAt'> & { updatedAt: Date; total: number };

/**
 * Filtered, sorted, paged list. `scopeSql` is the access filter from scopeInstrumentsQuery (already
 * pushed onto `params`); `today` is the app clock's business date for daysToMaturity.
 */
export async function listInstruments(
  db: Db,
  q: InstrumentListQuery,
  today: string,
  scope: (params: unknown[]) => string,
): Promise<{ rows: Omit<ListRow, 'total'>[]; total: number }> {
  const params: unknown[] = [today];
  const where: string[] = [`true${scope(params)}`];
  const add = (sql: (p: string) => string, value: unknown): void => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  if (q.status?.length) add((p) => `i.status = ANY(${p}::instrument_status[])`, q.status);
  if (q.type) add((p) => `i.type = ${p}`, q.type);
  if (q.bank) add((p) => `i.issuing_bank = ${p}`, q.bank);
  if (q.region) add((p) => `inst.region = ${p}`, q.region);
  if (q.institutionId) add((p) => `i.institution_id = ${p}`, q.institutionId);
  if (q.maturityFrom) add((p) => `i.maturity_date >= ${p}`, q.maturityFrom);
  if (q.maturityTo) add((p) => `i.maturity_date <= ${p}`, q.maturityTo);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    add((p) => `(i.reference_no ILIKE ${p} OR i.beneficiary_name ILIKE ${p} OR inst.name ILIKE ${p})`, like);
  }
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const rows = await many<ListRow>(
    db,
    `SELECT i.id, i.type, i.reference_no AS "referenceNo", i.issuing_bank AS "issuingBank", i.amount,
            i.issue_date AS "issueDate", i.maturity_date AS "maturityDate", i.status,
            i.verification_state AS "verificationState", i.institution_id AS "institutionId",
            inst.name AS "institutionName", inst.region, (i.maturity_date - $1::date) AS "daysToMaturity",
            i.version, i.updated_at AS "updatedAt", count(*) OVER () AS total
       FROM instruments i JOIN institutions inst ON inst.id = i.institution_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${SORT_SQL[q.sort]}, i.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  let total = rows[0]?.total ?? 0;
  if (!rows.length && q.page > 1) {
    // Past the last page: still report the real total.
    const c = await one<{ n: number }>(
      db,
      `SELECT count(*) AS n, $1::date AS today FROM instruments i JOIN institutions inst ON inst.id = i.institution_id WHERE ${where.join(' AND ')}`,
      params.slice(0, -2),
    );
    total = c.n;
  }
  return { rows: rows.map(({ total: _t, ...r }) => r), total };
}
