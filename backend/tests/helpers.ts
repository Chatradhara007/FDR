import supertest from 'supertest';
import type { Role } from '@fdr/shared';
import { createApp, type AppOptions } from '../src/app';
import { exec, getPool, many, one, withTransaction } from '../src/db/pool';
import * as clock from '../src/domain/clock';
import { signToken } from '../src/domain/token';
import { insertInstrument, type InstrumentRow, type NewInstrument } from '../src/repositories/instrumentRepo';
import { findUserByEmail } from '../src/repositories/userRepo';
import { seedBase } from '../src/seed/base';

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

/** Fixed rows every test expects: the REAL app clock, default rules, base institutions and users. */
async function insertFixedRows(): Promise<void> {
  const pool = getPool();
  await exec(pool, "INSERT INTO app_clock (id, mode) VALUES (1, 'REAL') ON CONFLICT (id) DO NOTHING");
  await seedBase(pool);
}

export function api(options: AppOptions = {}): supertest.Agent {
  return supertest.agent(createApp(options));
}

export interface SeededUser {
  id: string;
  name: string;
  role: Role;
  institutionId: string | null;
  token: string;
}

/** A seeded user with a valid bearer token (no login round trip, so the login rate limiter is untouched). */
export async function userFor(email: string): Promise<SeededUser> {
  const u = await findUserByEmail(getPool(), email);
  if (!u) throw new Error(`no seeded user ${email}`);
  const user = { id: u.id, name: u.name, role: u.role, institutionId: u.institution_id };
  return { ...user, token: signToken(user) };
}

export function bearer(u: { token: string }): [string, string] {
  return ['Authorization', `Bearer ${u.token}`];
}

export async function institutionId(email: string): Promise<string> {
  const u = await findUserByEmail(getPool(), email);
  if (!u?.institution_id) throw new Error(`${email} is not an institution user`);
  return u.institution_id;
}

/** Inserts a DRAFT instrument directly through the repository. */
export async function createInstrument(overrides: Partial<NewInstrument> & { institutionId: string }): Promise<InstrumentRow> {
  const at = await clock.now(getPool());
  return withTransaction((tx) =>
    insertInstrument(
      tx,
      {
        type: 'FDR',
        referenceNo: 'SBI/FD/2026/0001',
        issuingBank: 'State Bank of India',
        amount: '2500000.00',
        issueDate: '2026-04-01',
        maturityDate: '2027-04-01',
        beneficiaryName: 'Member Secretary, AICTE',
        ...overrides,
      },
      at,
    ),
  );
}

export async function countEvents(where = 'true', params: unknown[] = []): Promise<number> {
  return (await one<{ n: number }>(getPool(), `SELECT count(*) AS n FROM events WHERE ${where}`, params)).n;
}
