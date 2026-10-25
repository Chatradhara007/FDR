import type { Instrument, InstrumentType } from '@fdr/shared';
import { maybeOne, one, type Db } from '../db/pool';

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
