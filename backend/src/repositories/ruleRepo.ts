import { exec, maybeOne, type Db } from '../db/pool';

export async function insertRuleIfMissing(db: Db, r: { key: string; name: string; type: string; config: unknown }): Promise<void> {
  await exec(
    db,
    'INSERT INTO rules (key, name, type, config) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (key) DO NOTHING',
    [r.key, r.name, r.type, JSON.stringify(r.config)],
  );
}

/** Current config of an active rule; null when missing or inactive. Read at the start of each operation (rule 11). */
export async function getRuleConfig<T>(db: Db, key: string): Promise<T | null> {
  const row = await maybeOne<{ config: T }>(db, 'SELECT config FROM rules WHERE key = $1 AND active', [key]);
  return row?.config ?? null;
}
