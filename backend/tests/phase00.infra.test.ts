import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate';
import { closePool, exec, getPool, many, maybeOne, one, withTransaction } from '../src/db/pool';
import { authenticate, signToken } from '../src/middleware/authenticate';
import { requireRole } from '../src/middleware/requireRole';
import { api, resetDb } from './helpers';

afterAll(async () => {
  await exec(getPool(), 'DROP TABLE IF EXISTS zz_phase00_probe');
  await exec(getPool(), "DELETE FROM schema_migrations WHERE name LIKE 'zz_%'");
  await closePool();
});

describe('phase 00 — db helpers and migrator', () => {
  it('applies migrations once, in order, and is idempotent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdr-mig-'));
    fs.writeFileSync(path.join(dir, 'zz_002_b.sql'), 'ALTER TABLE zz_phase00_probe ADD COLUMN d date;');
    fs.writeFileSync(path.join(dir, 'zz_001_a.sql'), 'CREATE TABLE zz_phase00_probe (id int, amount numeric(14,2));');
    expect(await migrate({ dir })).toEqual(['zz_001_a.sql', 'zz_002_b.sql']);
    expect(await migrate({ dir })).toEqual([]);
  });

  it('type parsers keep DATE and NUMERIC as strings', async () => {
    await resetDb();
    await exec(getPool(), "INSERT INTO zz_phase00_probe VALUES (1, 2500000.5, '2027-03-31')");
    const row = await one<{ amount: string; d: string; n: number }>(
      getPool(),
      'SELECT amount, d, count(*) OVER () AS n FROM zz_phase00_probe',
    );
    expect(row).toEqual({ amount: '2500000.50', d: '2027-03-31', n: 1 });
  });

  it('one() throws NotFound, maybeOne() returns null, transactions roll back', async () => {
    await resetDb();
    await expect(one(getPool(), 'SELECT 1 FROM zz_phase00_probe')).rejects.toMatchObject({ httpStatus: 404 });
    expect(await maybeOne(getPool(), 'SELECT 1 FROM zz_phase00_probe')).toBeNull();
    await expect(
      withTransaction(async (tx) => {
        await exec(tx, 'INSERT INTO zz_phase00_probe (id) VALUES (7)');
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await many(getPool(), 'SELECT * FROM zz_phase00_probe')).toEqual([]);
  });
});

describe('phase 00 — authenticate and requireRole', () => {
  const app = () =>
    api({
      mountTestRoutes: (router) => {
        router.get('/__test/admin-only', authenticate, requireRole('admin'), (req, res) => {
          res.json({ user: req.user });
        });
      },
    });

  it('401 without or with a bad token', async () => {
    expect((await app().get('/api/v1/__test/admin-only')).status).toBe(401);
    const bad = await app().get('/api/v1/__test/admin-only').set('Authorization', 'Bearer nope');
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('UNAUTHORIZED');
  });

  it('403 for the wrong role, 200 for the right one', async () => {
    const officer = signToken({ id: 'u1', role: 'officer', institutionId: null });
    const admin = signToken({ id: 'u2', role: 'admin', institutionId: null });
    const res403 = await app().get('/api/v1/__test/admin-only').set('Authorization', `Bearer ${officer}`);
    expect(res403.status).toBe(403);
    expect(res403.body).toMatchObject({ code: 'FORBIDDEN', details: null });
    const ok = await app().get('/api/v1/__test/admin-only').set('Authorization', `Bearer ${admin}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toEqual({ id: 'u2', role: 'admin', institutionId: null });
  });
});
