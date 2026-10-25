import { exec, many, maybeOne, one, type Db } from '../db/pool';

export interface EventRow {
  id: number;
  actor_id: string | null;
  actor_label: string;
  action: string;
  entity_type: string;
  entity_id: string;
  instrument_id: string | null;
  before_json: unknown;
  after_json: unknown;
  created_at: Date;
  prev_hash: string | null;
  hash: string;
}

export async function lockChain(db: Db, key: number): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [key]);
}

export async function lastHash(db: Db): Promise<string | null> {
  const row = await maybeOne<{ hash: string }>(db, 'SELECT hash FROM events ORDER BY id DESC LIMIT 1');
  return row?.hash ?? null;
}

export async function nextEventId(db: Db): Promise<number> {
  return (await one<{ id: number }>(db, "SELECT nextval('events_id_seq') AS id")).id;
}

/** before_json / after_json are passed as JSON text (node-pg would turn JS arrays into PG arrays). */
export async function insertEvent(db: Db, e: EventRow): Promise<void> {
  await exec(
    db,
    `INSERT INTO events (id, actor_id, actor_label, action, entity_type, entity_id, instrument_id,
                         before_json, after_json, created_at, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)`,
    [
      e.id, e.actor_id, e.actor_label, e.action, e.entity_type, e.entity_id, e.instrument_id,
      e.before_json === null ? null : JSON.stringify(e.before_json),
      e.after_json === null ? null : JSON.stringify(e.after_json),
      e.created_at, e.prev_hash, e.hash,
    ],
  );
}

export async function eventsAfter(db: Db, afterId: number, limit: number): Promise<EventRow[]> {
  return many<EventRow>(db, 'SELECT * FROM events WHERE id > $1 ORDER BY id LIMIT $2', [afterId, limit]);
}

export async function eventsForEntity(db: Db, entityType: string, entityId: string): Promise<EventRow[]> {
  return many<EventRow>(db, 'SELECT * FROM events WHERE entity_type = $1 AND entity_id = $2 ORDER BY id', [entityType, entityId]);
}
