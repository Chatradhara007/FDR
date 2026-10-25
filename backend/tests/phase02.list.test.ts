import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool';
import { api, bearer, createDraftViaApi, readyFdr, resetDb, setToday, userFor, VALID_FDR, type SeededUser } from './helpers';

afterAll(async () => {
  await closePool();
});

let inst1: SeededUser;
let inst2: SeededUser;
let officer: SeededUser;

beforeAll(async () => {
  await resetDb();
  await setToday('2026-10-25');
  inst1 = await userFor('inst1@demo.in');
  inst2 = await userFor('inst2@demo.in');
  officer = await userFor('officer@demo.in');
  // inst1: 3 instruments (one submitted), inst2: 2.
  const submitted = await readyFdr(inst1, { ...VALID_FDR, referenceNo: 'SBIN/FDR/2026/00001', maturityDate: '2026-12-01' });
  await api().post(`/api/v1/instruments/${submitted}/submit`).set(...bearer(inst1)).expect(200);
  await createDraftViaApi(inst1, { ...VALID_FDR, referenceNo: 'HDFC/FD/2026/00002', issuingBank: 'HDFC Bank', maturityDate: '2027-06-30' });
  await createDraftViaApi(inst1, { type: 'SECURITY_DEPOSIT' });
  await createDraftViaApi(inst2, { ...VALID_FDR, referenceNo: 'CNRB/FD/2026/00003', issuingBank: 'Canara Bank', beneficiaryName: 'AICTE Southern' });
  await createDraftViaApi(inst2, { ...VALID_FDR, referenceNo: 'CNRB/FD/2026/00004', issuingBank: 'Canara Bank' });
});

const list = (u: SeededUser, query = '') => api().get(`/api/v1/instruments${query}`).set(...bearer(u));

describe('phase 02 — list', () => {
  it('AC10: an institution sees only its own instruments', async () => {
    const res = await list(inst1);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 25 });
    expect(res.body.items.every((i: { institutionId: string }) => i.institutionId === inst1.institutionId)).toBe(true);
    // A filter for another institution cannot widen the scope.
    expect((await list(inst1, `?institutionId=${inst2.institutionId}`)).body.total).toBe(0);
    expect((await list(officer)).body.total).toBe(5);
  });

  it('AC10: items carry server-computed daysToMaturity and institution name/region; default sort by maturity', async () => {
    const res = await list(inst1);
    const first = res.body.items[0];
    expect(first).toMatchObject({
      referenceNo: 'SBIN/FDR/2026/00001', status: 'SUBMITTED', verificationState: 'UNVERIFIED', amount: '2500000.00',
      maturityDate: '2026-12-01', daysToMaturity: 37, institutionName: expect.stringContaining('Vasavi'), region: 'South-Central',
    });
    expect(res.body.items[2].maturityDate).toBeNull();
    expect(res.body.items[2].daysToMaturity).toBeNull();
  });

  it('AC10: filters work', async () => {
    expect((await list(officer, '?status=DRAFT')).body.total).toBe(4);
    expect((await list(officer, '?status[]=SUBMITTED&status[]=DRAFT')).body.total).toBe(5);
    expect((await list(officer, '?type=SECURITY_DEPOSIT')).body.total).toBe(1);
    expect((await list(officer, '?bank=Canara%20Bank')).body.total).toBe(2);
    expect((await list(officer, '?region=Southern')).body.total).toBe(2);
    expect((await list(officer, `?institutionId=${inst2.institutionId}`)).body.total).toBe(2);
    expect((await list(officer, '?q=hdfc')).body.total).toBe(1);
    expect((await list(officer, '?q=southern')).body.total).toBe(1);
    expect((await list(officer, '?q=venkateswara')).body.total).toBe(2);
    expect((await list(officer, '?q=%25')).body.total).toBe(0);
    expect((await list(officer, '?maturityFrom=2027-01-01&maturityTo=2027-12-31')).body.total).toBe(3);
    const bad = await list(officer, '?status=NOPE&pageSize=0');
    expect(bad.status).toBe(422);
    expect(bad.body.details.map((d: { field: string }) => d.field).sort()).toEqual(['query.pageSize', 'query.status.0']);
  });

  it('AC10: paging and sorting', async () => {
    const p1 = await list(officer, '?pageSize=2&page=1&sort=referenceNo');
    const p3 = await list(officer, '?pageSize=2&page=3&sort=referenceNo');
    expect(p1.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(p1.body.items.map((i: { referenceNo: string }) => i.referenceNo)).toEqual(['CNRB/FD/2026/00003', 'CNRB/FD/2026/00004']);
    expect(p3.body.items).toHaveLength(1);
    const past = await list(officer, '?pageSize=2&page=9');
    expect(past.body).toMatchObject({ total: 5, items: [] });
  });

  it('GET /meta returns banks, doc types, regions and the current rules', async () => {
    const res = await api().get('/api/v1/meta').set(...bearer(inst1));
    expect(res.status).toBe(200);
    expect(res.body.banks).toContain('State Bank of India');
    expect(res.body.docTypes).toContainEqual({ value: 'FDR_COPY', label: 'FDR copy' });
    expect(res.body.regions).toEqual(['South-Central', 'Southern']);
    expect(res.body.requiredDocs).toEqual({ FDR: ['FDR_COPY', 'BANK_LETTER'], SECURITY_DEPOSIT: ['DEPOSIT_CONFIRMATION'] });
    expect(res.body.lienRequired).toEqual({ FDR: true, SECURITY_DEPOSIT: false });
    expect((await api().get('/api/v1/meta')).status).toBe(401);
  });
});
