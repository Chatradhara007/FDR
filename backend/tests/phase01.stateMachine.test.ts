import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { InstrumentStatus } from '@fdr/shared';
import { closePool, getPool, withTransaction } from '../src/db/pool';
import { SYSTEM_ACTOR } from '../src/domain/audit';
import { transition } from '../src/domain/stateMachine';
import { findInstrumentById, lockInstrument } from '../src/repositories/instrumentRepo';
import { eventsForEntity } from '../src/repositories/eventRepo';
import { countEvents, createInstrument, institutionId, resetDb } from './helpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDb();
});

async function move(id: string, to: InstrumentStatus, extra?: Record<string, unknown>): Promise<void> {
  await withTransaction(async (tx) => {
    const inst = await lockInstrument(tx, id);
    await transition(tx, inst, to, { id: null, label: 'Test officer' }, extra);
  });
}

describe('phase 01 — state machine', () => {
  it('AC4: DRAFT → ACTIVE is rejected with INVALID_TRANSITION and writes no event', async () => {
    const inst = await createInstrument({ institutionId: await institutionId('inst1@demo.in') });
    await expect(move(inst.id, 'ACTIVE')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      httpStatus: 409,
      details: { from: 'DRAFT', to: 'ACTIVE' },
    });
    expect(await countEvents()).toBe(0);
    const after = await findInstrumentById(getPool(), inst.id);
    expect(after).toMatchObject({ status: 'DRAFT', version: 1 });
  });

  it('AC4: DRAFT → SUBMITTED updates status, bumps version and writes exactly one STATUS_SUBMITTED', async () => {
    const inst = await createInstrument({ institutionId: await institutionId('inst1@demo.in') });
    await move(inst.id, 'SUBMITTED', { note: 'first submission' });

    const after = await findInstrumentById(getPool(), inst.id);
    expect(after).toMatchObject({ status: 'SUBMITTED', version: 2 });
    expect(after!.updatedAt).toBeInstanceOf(Date);

    const events = await eventsForEntity(getPool(), 'instrument', inst.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'STATUS_SUBMITTED',
      actor_label: 'Test officer',
      instrument_id: inst.id,
      before_json: { status: 'DRAFT' },
      after_json: { status: 'SUBMITTED', note: 'first submission' },
    });
    expect(await countEvents()).toBe(1);
  });

  it('a stale status (changed concurrently) is a 409 conflict and writes nothing', async () => {
    const inst = await createInstrument({ institutionId: await institutionId('inst1@demo.in') });
    await move(inst.id, 'SUBMITTED');
    // Caller still believes the instrument is DRAFT.
    await expect(
      withTransaction((tx) => transition(tx, { id: inst.id, status: 'DRAFT' }, 'SUBMITTED', SYSTEM_ACTOR)),
    ).rejects.toMatchObject({ httpStatus: 409, code: 'STATUS_CHANGED' });
    expect(await countEvents()).toBe(1);
  });

  it('AC5: entering RELEASE_REQUESTED stores status_before_release', async () => {
    const inst = await createInstrument({ institutionId: await institutionId('inst1@demo.in') });
    for (const s of ['SUBMITTED', 'UNDER_SCRUTINY', 'ACTIVE', 'EXPIRING'] as const) await move(inst.id, s);
    expect((await findInstrumentById(getPool(), inst.id))!.statusBeforeRelease).toBeNull();

    await move(inst.id, 'RELEASE_REQUESTED');
    const after = await findInstrumentById(getPool(), inst.id);
    expect(after).toMatchObject({ status: 'RELEASE_REQUESTED', statusBeforeRelease: 'EXPIRING', version: 6 });

    // Restoring keeps the column (later phases read it); the next request overwrites it.
    await move(inst.id, 'EXPIRING');
    expect((await findInstrumentById(getPool(), inst.id))!.statusBeforeRelease).toBe('EXPIRING');
    expect(await countEvents("action LIKE 'STATUS_%'")).toBe(6);
  });
});
