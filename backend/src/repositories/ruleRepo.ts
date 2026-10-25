import { exec, type Db } from '../db/pool';

export async function insertRuleIfMissing(db: Db, r: { key: string; name: string; type: string; config: unknown }): Promise<void> {
  await exec(
    db,
    'INSERT INTO rules (key, name, type, config) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (key) DO NOTHING',
    [r.key, r.name, r.type, JSON.stringify(r.config)],
  );
}
