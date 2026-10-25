import { maybeOne, one, type Db } from '../db/pool';

export interface InstitutionRow {
  id: string;
  aicte_id: string;
  name: string;
  region: string;
  state: string;
  contact_email: string | null;
}

export async function upsertInstitution(db: Db, i: Omit<InstitutionRow, 'id'>): Promise<InstitutionRow> {
  return one<InstitutionRow>(
    db,
    `INSERT INTO institutions (aicte_id, name, region, state, contact_email) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (aicte_id) DO UPDATE SET aicte_id = EXCLUDED.aicte_id
     RETURNING *`,
    [i.aicte_id, i.name, i.region, i.state, i.contact_email],
  );
}

export async function findInstitutionById(db: Db, id: string): Promise<InstitutionRow | null> {
  return maybeOne<InstitutionRow>(db, 'SELECT * FROM institutions WHERE id = $1', [id]);
}
