import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as clock from '../domain/clock';
import { closePool, exec, getPool, many, maybeOne, withTransaction, type Db } from './pool';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Applies migrations/*.sql in filename order, each in its own transaction.
 * applied_at comes from the app clock once app_clock exists (wall time only for the very first migration,
 * when the clock is REAL anyway); callers may pass appliedAt explicitly.
 */
export async function migrate(
  options: { dir?: string; appliedAt?: string } = {},
): Promise<string[]> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const pool = getPool();
  await exec(
    pool,
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL)',
  );
  const done = new Set((await many<{ name: string }>(pool, 'SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [];
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await withTransaction(async (tx) => {
      const appliedAt = options.appliedAt ?? (await clockNowIfAvailable(tx));
      await tx.query(sql);
      await exec(tx, 'INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)', [file, appliedAt]);
    });
    applied.push(file);
  }
  return applied;
}

async function clockNowIfAvailable(db: Db): Promise<Date> {
  const exists = await maybeOne<{ t: string | null }>(db, "SELECT to_regclass('public.app_clock') AS t");
  return exists?.t ? clock.now(db) : new Date();
}

export async function resetSchema(db: Db = getPool()): Promise<void> {
  await exec(db, 'DROP SCHEMA IF EXISTS public CASCADE');
  await exec(db, 'CREATE SCHEMA public');
}

// CLI: `tsx src/db/migrate.ts [--reset]`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    if (process.argv.includes('--reset')) {
      await resetSchema();
      console.log('schema public dropped and recreated');
    }
    const applied = await migrate();
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'no pending migrations');
    await closePool();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
