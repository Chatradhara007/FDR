import supertest from 'supertest';
import { createApp, type AppOptions } from '../src/app';
import { exec, getPool, many } from '../src/db/pool';

/** Truncates every table except schema_migrations, then re-inserts fixed rows. */
export async function resetDb(): Promise<void> {
  const pool = getPool();
  const tables = await many<{ tablename: string }>(
    pool,
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
  );
  if (tables.length) {
    await exec(pool, `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await insertFixedRows();
}

/** Fixed rows every test expects (Phase 1 adds the app_clock row). */
async function insertFixedRows(): Promise<void> {
  // none yet
}

export function api(options: AppOptions = {}): supertest.Agent {
  return supertest.agent(createApp(options));
}
