import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, exec, getPool, many, one } from '../src/db/pool';
import {
  api, bearer, countEvents, createDraftViaApi, readyFdr, resetDb, setToday, uploadDoc, userFor, VALID_FDR, type SeededUser,
} from './helpers';

afterAll(async () => {
  await closePool();
});

let inst1: SeededUser;
let inst2: SeededUser;

beforeEach(async () => {
  await resetDb();
  await setToday('2026-10-25');
  inst1 = await userFor('inst1@demo.in');
  inst2 = await userFor('inst2@demo.in');
});

const submit = (u: SeededUser, id: string) => api().post(`/api/v1/instruments/${id}/submit`).set(...bearer(u));

describe('phase 02 — submission', () => {
  it('AC1: missing document and invalid fields are reported together (422)', async () => {
    const { id } = await createDraftViaApi(inst1, { type: 'FDR', referenceNo: 'SBIN/FDR/2026/00731', amount: '25,00,000' });
    await uploadDoc(inst1, id, 'FDR_COPY').expect(201);
    const res = await submit(inst1, id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.missingDocuments).toEqual(['BANK_LETTER']);
    expect(res.body.details.fields.map((f: { field: string }) => f.field).sort()).toEqual(
      ['beneficiaryName', 'issueDate', 'issuingBank', 'maturityDate'],
    );
    expect((await one<{ status: string }>(getPool(), 'SELECT status FROM instruments WHERE id = $1', [id])).status).toBe('DRAFT');
  });

  it('AC2: a full submission creates seven CLAIMED provenance rows and both events', async () => {
    const id = await readyFdr(inst1);
    const res = await submit(inst1, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'SUBMITTED', verificationState: 'UNVERIFIED', missingDocs: [] });
    expect(res.body.submittedAt).toBe('2026-10-25T04:30:00.000Z');

    const prov = await many<{ field_name: string; tier: string; source: string; value: string }>(
      getPool(), 'SELECT field_name, tier, source, value FROM field_provenance WHERE instrument_id = $1 ORDER BY field_name', [id],
    );
    expect(prov).toHaveLength(7);
    expect(prov.every((p) => p.tier === 'CLAIMED' && p.source === 'institution')).toBe(true);
    expect(Object.fromEntries(prov.map((p) => [p.field_name, p.value]))).toEqual({
      amount: '2500000.00', beneficiary_name: 'Member Secretary, AICTE', issue_date: '2026-04-01', issuing_bank: 'State Bank of India',
      lien_marked: 'true', maturity_date: '2027-04-01', reference_no: 'SBIN/FDR/2026/00731',
    });
    expect(await countEvents("instrument_id = $1 AND action = 'STATUS_SUBMITTED'", [id])).toBe(1);
    expect(await countEvents("instrument_id = $1 AND action = 'INSTRUMENT_SUBMITTED'", [id])).toBe(1);
    const ev = await one<{ after_json: Record<string, unknown> }>(getPool(),
      "SELECT after_json FROM events WHERE instrument_id = $1 AND action = 'INSTRUMENT_SUBMITTED'", [id]);
    expect(ev.after_json).toMatchObject({ amount: '2500000.00', reference_no: 'SBIN/FDR/2026/00731' });
  });

  it('AC3: submitting twice → 409 INVALID_TRANSITION', async () => {
    const id = await readyFdr(inst1);
    expect((await submit(inst1, id)).status).toBe(200);
    const again = await submit(inst1, id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_TRANSITION');
    expect(await countEvents("instrument_id = $1 AND action = 'STATUS_SUBMITTED'", [id])).toBe(1);
  });

  it('AC7: PATCH with an old version → 409 STALE_VERSION', async () => {
    const { id, version } = await createDraftViaApi(inst1);
    const first = await api().patch(`/api/v1/instruments/${id}`).set(...bearer(inst1)).send({ amount: '30,00,000', version });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ amount: '3000000.00', version: version + 1 });
    const second = await api().patch(`/api/v1/instruments/${id}`).set(...bearer(inst1)).send({ amount: '35,00,000', version });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('STALE_VERSION');

    const edited = await one<{ before_json: unknown; after_json: unknown }>(getPool(),
      "SELECT before_json, after_json FROM events WHERE instrument_id = $1 AND action = 'INSTRUMENT_EDITED'", [id]);
    expect(edited).toEqual({ before_json: { amount: '2500000.00' }, after_json: { amount: '3000000.00' } });
  });

  it('AC8: duplicate bank + reference against a live instrument → 409; against a RELEASED one → allowed (D7)', async () => {
    const first = await readyFdr(inst1);
    await submit(inst1, first).expect(200);

    const dup = await api().post('/api/v1/instruments').set(...bearer(inst2)).send({ ...VALID_FDR, referenceNo: 'sbin/fdr/2026/00731' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_REFERENCE');
    expect(dup.body.message).toMatch(/Submitted/);

    // A draft without the reference can't take it at submit time either.
    const { id: other, version } = await createDraftViaApi(inst2, { ...VALID_FDR, referenceNo: 'SBIN/FDR/2026/99999' });
    const patch = await api().patch(`/api/v1/instruments/${other}`).set(...bearer(inst2)).send({ referenceNo: 'SBIN/FDR/2026/00731', version });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe('DUPLICATE_REFERENCE');

    // Once the first is released (set up directly: release workflow is Phase 6), the reference is free again.
    await exec(getPool(), `UPDATE instruments SET status = 'RELEASED' WHERE id = $1`, [first]);
    const ok = await api().post('/api/v1/instruments').set(...bearer(inst2)).send(VALID_FDR);
    expect(ok.status).toBe(201);
  });

  it('AC9 (D5): resubmission resets only the changed field to CLAIMED', async () => {
    const id = await readyFdr(inst1);
    await submit(inst1, id).expect(200);
    // Simulate Phase 3 outcome via repository-level SQL: two fields bank-confirmed, then returned.
    await exec(getPool(), `UPDATE field_provenance SET tier = 'BANK_CONFIRMED', source = 'bank'
                            WHERE instrument_id = $1 AND field_name IN ('amount', 'issue_date')`, [id]);
    await exec(getPool(), `UPDATE instruments SET status = 'RETURNED', verification_state = 'MISMATCH' WHERE id = $1`, [id]);

    const cur = await api().get(`/api/v1/instruments/${id}`).set(...bearer(inst1));
    await api().patch(`/api/v1/instruments/${id}`).set(...bearer(inst1)).send({ amount: '20,00,000', version: cur.body.version }).expect(200);
    const res = await submit(inst1, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'SUBMITTED', verificationState: 'UNVERIFIED' });
    const tiers = Object.fromEntries(
      (res.body.provenance as { fieldName: string; tier: string; value: string }[]).map((p) => [p.fieldName, `${p.tier}:${p.value}`]),
    );
    expect(tiers.amount).toBe('CLAIMED:2000000.00');
    expect(tiers.issue_date).toBe('BANK_CONFIRMED:2026-04-01');
  });

  it('D5: resubmission with no change keeps tiers and verification_state', async () => {
    const id = await readyFdr(inst1);
    await submit(inst1, id).expect(200);
    await exec(getPool(), `UPDATE field_provenance SET tier = 'BANK_CONFIRMED' WHERE instrument_id = $1`, [id]);
    await exec(getPool(), `UPDATE instruments SET status = 'RETURNED', verification_state = 'CONFIRMED' WHERE id = $1`, [id]);
    const res = await submit(inst1, id);
    expect(res.body.verificationState).toBe('CONFIRMED');
    expect((res.body.provenance as { tier: string }[]).every((p) => p.tier === 'BANK_CONFIRMED')).toBe(true);
  });

  it('maturity date in the past at submit → 422 on maturityDate (D25)', async () => {
    const id = await readyFdr(inst1, { ...VALID_FDR, issueDate: '2025-01-01', maturityDate: '2026-01-01' });
    const res = await submit(inst1, id);
    expect(res.status).toBe(422);
    expect(res.body.details).toEqual({ fields: [{ field: 'maturityDate', message: expect.any(String) }], missingDocuments: [] });
  });

  it('maturity before issue is rejected on save (422, not a DB error)', async () => {
    const res = await api().post('/api/v1/instruments').set(...bearer(inst1)).send({ ...VALID_FDR, maturityDate: '2026-03-01' });
    expect(res.status).toBe(422);
    expect(res.body.details).toEqual([{ field: 'maturityDate', message: expect.any(String) }]);
  });

  it('upload or edit after submission → 409 INVALID_STATE', async () => {
    const id = await readyFdr(inst1);
    await submit(inst1, id).expect(200);
    const up = await uploadDoc(inst1, id, 'OTHER');
    expect(up.status).toBe(409);
    expect(up.body.code).toBe('INVALID_STATE');
    const cur = await api().get(`/api/v1/instruments/${id}`).set(...bearer(inst1));
    const patch = await api().patch(`/api/v1/instruments/${id}`).set(...bearer(inst1)).send({ branch: 'X', version: cur.body.version });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe('INVALID_STATE');
  });

  it('roles and ownership: only the owning institution creates, edits and submits', async () => {
    const officer = await userFor('officer@demo.in');
    expect((await api().post('/api/v1/instruments').set(...bearer(officer)).send(VALID_FDR)).status).toBe(403);
    const id = await readyFdr(inst1);
    expect((await submit(inst2, id)).status).toBe(404);
    expect((await api().patch(`/api/v1/instruments/${id}`).set(...bearer(inst2)).send({ version: 1, branch: 'x' })).status).toBe(404);
    expect((await api().delete(`/api/v1/instruments/${id}`).set(...bearer(inst2))).status).toBe(404);
  });

  it('DELETE draft: hard delete with event; refused once submitted', async () => {
    const id = await readyFdr(inst1);
    const del = await api().delete(`/api/v1/instruments/${id}`).set(...bearer(inst1));
    expect(del.status).toBe(204);
    expect((await api().get(`/api/v1/instruments/${id}`).set(...bearer(inst1))).status).toBe(404);
    expect(await countEvents("instrument_id = $1 AND action = 'INSTRUMENT_DRAFT_DELETED'", [id])).toBe(1);

    const id2 = await readyFdr(inst1);
    await submit(inst1, id2).expect(200);
    const refused = await api().delete(`/api/v1/instruments/${id2}`).set(...bearer(inst1));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('INVALID_STATE');
  });

  it('every write keeps the audit chain intact', async () => {
    const id = await readyFdr(inst1);
    await submit(inst1, id).expect(200);
    const { verifyChain } = await import('../src/domain/audit');
    expect(await verifyChain(getPool())).toMatchObject({ ok: true, firstBrokenId: null });
  });
});
