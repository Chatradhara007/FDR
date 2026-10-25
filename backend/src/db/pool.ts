import pg from 'pg';
import { config } from '../config';
import { NotFound } from '../domain/errors';

// DATE stays 'YYYY-MM-DD' (no timezone shifts); INT8 → number (counts); NUMERIC stays string.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));

export type Db = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2000 });
    pool.on('error', (err) => console.error('pg pool error', err));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

export async function many<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(sql, params);
  return res.rows as T[];
}

export async function maybeOne<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const res = await db.query(sql, params);
  return (res.rows[0] as T | undefined) ?? null;
}

export async function one<T>(db: Db, sql: string, params: unknown[] = [], notFoundMessage?: string): Promise<T> {
  const row = await maybeOne<T>(db, sql, params);
  if (row === null) throw new NotFound(notFoundMessage);
  return row;
}

export async function exec(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const res = await db.query(sql, params);
  return res.rowCount ?? 0;
}

export async function withTransaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
