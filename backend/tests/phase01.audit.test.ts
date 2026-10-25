import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, exec, getPool, many, withTransaction } from '../src/db/pool';
import { eventHash, recordEvent, verifyChain } from '../src/domain/audit';
import type { EventRow } from '../src/repositories/eventRepo';
import { resetDb } from './helpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDb();
});

const ENTITY = '11111111-1111-1111-1111-111111111111';

async function writeSome(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await withTransaction((tx) =>
      recordEvent(tx, {
        actor: i % 2 ? { label: 'system' } : { id: ENTITY, label: 'Anjali Deshmukh' },
        action: 'TEST_EVENT',
        entityType: 'instrument',
        entityId: ENTITY,
        instrumentId: i % 2 ? undefined : ENTITY,
        before: i ? { z: i, a: [1, { y: 'b', x: 'a' }], nested: { k2: true, k1: null } } : undefined,
        after: { amount: '2500000.00', when: new Date('2027-03-31T00:00:00Z'), n: i },
      }),
    );
  }
}

describe('phase 01 — hash-chained audit log', () => {
  it('AC7: an intact chain verifies; links and genesis are as specified', async () => {
    expect(await verifyChain(getPool())).toEqual({ ok: true, checked: 0, firstBrokenId: null });
    await writeSome(6);
    expect(await verifyChain(getPool())).toEqual({ ok: true, checked: 6, firstBrokenId: null });

    const rows = await many<EventRow>(getPool(), 'SELECT * FROM events ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows[0].prev_hash).toBeNull();
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
    expect(rows[0].hash).toBe(eventHash(null, rows[0]));
    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('AC7: altering one event row breaks the chain at that id', async () => {
    await writeSome(5);
    await withTransaction(async (tx) => {
      await tx.query("SET LOCAL fdr.allow_tamper = 'on'");
      await exec(tx, `UPDATE events SET after_json = '{"amount":"25.00","n":2}' WHERE id = 3`);
    });
    expect(await verifyChain(getPool())).toEqual({ ok: false, checked: 3, firstBrokenId: 3 });
  });

  it('AC7: deleting an event also breaks the chain', async () => {
    await writeSome(4);
    await withTransaction(async (tx) => {
      await tx.query("SET LOCAL fdr.allow_tamper = 'on'");
      await exec(tx, 'DELETE FROM events WHERE id = 2');
    });
    expect(await verifyChain(getPool())).toMatchObject({ ok: false, firstBrokenId: 3 });
  });

  it('AC8: plain UPDATE and DELETE on events are rejected (append-only)', async () => {
    await writeSome(2);
    await expect(exec(getPool(), "UPDATE events SET actor_label = 'x' WHERE id = 1")).rejects.toThrow(/append-only/);
    await expect(exec(getPool(), 'DELETE FROM events WHERE id = 1')).rejects.toThrow(/append-only/);
    // The tamper setting is transaction-local: it does not leak to later statements.
    await withTransaction(async (tx) => {
      await tx.query("SET LOCAL fdr.allow_tamper = 'on'");
    });
    await expect(exec(getPool(), "UPDATE events SET actor_label = 'x' WHERE id = 1")).rejects.toThrow(/append-only/);
    expect(await verifyChain(getPool())).toMatchObject({ ok: true, checked: 2 });
  });

  it('concurrent writers still produce one valid chain', async () => {
    await Promise.all(Array.from({ length: 8 }, () => writeSome(2)));
    expect(await verifyChain(getPool())).toEqual({ ok: true, checked: 16, firstBrokenId: null });
  });
});
