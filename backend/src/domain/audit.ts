import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { canonicalJson } from '@fdr/shared';
import type { Db } from '../db/pool';
import { eventsAfter, insertEvent, lastHash, lockChain, nextEventId, type EventRow } from '../repositories/eventRepo';
import * as clock from './clock';

// Hash-chained, append-only audit log (D16).

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const CHAIN_LOCK = 7001;

export interface Actor {
  id?: string | null;
  label: string;
}

export const SYSTEM_ACTOR: Actor = { label: 'system' };

export interface EventInput {
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string;
  instrumentId?: string;
  before?: unknown;
  after?: unknown;
}

/** Round-trips through JSON so the hashed value is exactly what JSONB gives back. */
function toJsonValue(v: unknown): unknown {
  return v === undefined || v === null ? null : JSON.parse(JSON.stringify(v));
}

export function eventHash(prevHash: string | null, e: Omit<EventRow, 'prev_hash' | 'hash'>): string {
  const payload = canonicalJson({
    id: e.id,
    actor_id: e.actor_id,
    actor_label: e.actor_label,
    action: e.action,
    entity_type: e.entity_type,
    entity_id: e.entity_id,
    instrument_id: e.instrument_id,
    before_json: e.before_json,
    after_json: e.after_json,
    created_at: e.created_at.toISOString(),
  });
  return createHash('sha256').update(`${prevHash ?? 'GENESIS'}|${payload}`).digest('hex');
}

/** Must run inside the caller's transaction: the advisory lock serialises the chain until commit. */
export async function recordEvent(tx: PoolClient, e: EventInput): Promise<void> {
  await lockChain(tx, CHAIN_LOCK);
  const prev = await lastHash(tx);
  const row = {
    id: await nextEventId(tx),
    actor_id: e.actor.id ?? null,
    actor_label: e.actor.label,
    action: e.action,
    entity_type: e.entityType,
    entity_id: e.entityId,
    instrument_id: e.instrumentId ?? null,
    before_json: toJsonValue(e.before),
    after_json: toJsonValue(e.after),
    created_at: await clock.now(tx),
  };
  await insertEvent(tx, { ...row, prev_hash: prev, hash: eventHash(prev, row) });
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  firstBrokenId: number | null;
}

/** Recomputes every hash in id order; the first row whose link or hash does not match is reported. */
export async function verifyChain(db: Db): Promise<ChainCheck> {
  let prev: string | null = null;
  let afterId = 0;
  let checked = 0;
  for (;;) {
    const rows = await eventsAfter(db, afterId, 1000);
    if (!rows.length) return { ok: true, checked, firstBrokenId: null };
    for (const row of rows) {
      checked++;
      if (row.prev_hash !== prev || eventHash(prev, row) !== row.hash) {
        return { ok: false, checked, firstBrokenId: row.id };
      }
      prev = row.hash;
      afterId = row.id;
    }
  }
}
