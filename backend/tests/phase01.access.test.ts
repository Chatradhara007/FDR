import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool';
import { scopeInstrumentsQuery } from '../src/domain/access';
import { api, bearer, createInstrument, institutionId, resetDb, userFor } from './helpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDb();
});

describe('phase 01 — access scoping', () => {
  it("AC3: another institution's instrument is 404 for institution users, 200 for officers", async () => {
    const inst = await createInstrument({ institutionId: await institutionId('inst2@demo.in') });
    const path = `/api/v1/instruments/${inst.id}`;

    const inst1 = await userFor('inst1@demo.in');
    const other = await api().get(path).set(...bearer(inst1));
    expect(other.status).toBe(404);
    expect(other.body).toEqual({ code: 'NOT_FOUND', message: expect.any(String), details: null });

    const own = await api().get(path).set(...bearer(await userFor('inst2@demo.in')));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ id: inst.id, status: 'DRAFT', amount: '2500000.00', maturityDate: '2027-04-01', version: 1 });

    for (const email of ['officer@demo.in', 'approver@demo.in', 'admin@demo.in', 'auditor@demo.in']) {
      const res = await api().get(path).set(...bearer(await userFor(email)));
      expect(res.status, email).toBe(200);
    }
  });

  it('unknown or malformed ids are 404; no token is 401', async () => {
    const officer = await userFor('officer@demo.in');
    expect((await api().get('/api/v1/instruments/00000000-0000-0000-0000-000000000001').set(...bearer(officer))).status).toBe(404);
    expect((await api().get('/api/v1/instruments/not-a-uuid').set(...bearer(officer))).status).toBe(404);
    expect((await api().get('/api/v1/instruments/not-a-uuid')).status).toBe(401);
  });

  it('scopeInstrumentsQuery adds an institution filter only for institution users', async () => {
    const inst1 = await userFor('inst1@demo.in');
    const officer = await userFor('officer@demo.in');
    const params: unknown[] = ['x'];
    expect(scopeInstrumentsQuery(inst1, params)).toBe(' AND i.institution_id = $2');
    expect(params).toEqual(['x', inst1.institutionId]);
    const p2: unknown[] = [];
    expect(scopeInstrumentsQuery(officer, p2)).toBe('');
    expect(p2).toEqual([]);
  });
});
