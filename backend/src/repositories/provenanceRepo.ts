import type { TrackedField, TrustTier } from '@fdr/shared';
import { exec, many, type Db } from '../db/pool';

export interface ProvenanceDbRow {
  fieldName: TrackedField;
  value: string;
  tier: TrustTier;
  source: string | null;
  updatedAt: Date;
}

export async function listProvenance(db: Db, instrumentId: string): Promise<ProvenanceDbRow[]> {
  return many<ProvenanceDbRow>(
    db,
    `SELECT field_name AS "fieldName", value, tier, source, updated_at AS "updatedAt"
       FROM field_provenance WHERE instrument_id = $1 ORDER BY field_name`,
    [instrumentId],
  );
}

/** Inserts or overwrites one field's provenance with the given value, tier and source. */
export async function upsertProvenance(
  db: Db,
  instrumentId: string,
  p: { fieldName: TrackedField; value: string; tier: TrustTier; source: string },
  at: Date,
): Promise<void> {
  await exec(
    db,
    `INSERT INTO field_provenance (instrument_id, field_name, value, tier, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (instrument_id, field_name)
     DO UPDATE SET value = EXCLUDED.value, tier = EXCLUDED.tier, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`,
    [instrumentId, p.fieldName, p.value, p.tier, p.source, at],
  );
}
