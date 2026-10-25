import type { ClockState } from '@fdr/shared';
import type { PoolClient } from 'pg';
import { getPool, withTransaction, type Db } from '../db/pool';
import { actorOf, type AuthUser } from '../domain/access';
import { NIL_UUID, recordEvent } from '../domain/audit';
import * as clock from '../domain/clock';
import { readClock } from '../repositories/clockRepo';

async function state(db: Db): Promise<ClockState> {
  const now = await clock.now(db);
  return { mode: await clock.mode(db), now: now.toISOString(), today: clock.istDate(now) };
}

export async function getClock(): Promise<ClockState> {
  return state(getPool());
}

/** Locks the clock row, applies the change, writes the audit event; warns when the date moved back. */
async function change(user: AuthUser, action: string, apply: (tx: PoolClient) => Promise<void>, extra?: object): Promise<ClockState> {
  return withTransaction(async (tx) => {
    await readClock(tx, true);
    const before = await state(tx);
    await apply(tx);
    const after = await state(tx);
    await recordEvent(tx, {
      actor: actorOf(user),
      action,
      entityType: 'clock',
      entityId: NIL_UUID,
      before,
      after: { ...after, ...extra },
    });
    return after.today < before.today ? { ...after, warning: 'CLOCK_MOVED_BACKWARDS' } : after;
  });
}

export async function advance(user: AuthUser, days: number): Promise<ClockState> {
  return change(user, 'CLOCK_ADVANCED', (tx) => clock.advanceDays(tx, days), { days });
}

export async function setDate(user: AuthUser, date: string): Promise<ClockState> {
  return change(user, 'CLOCK_SET', (tx) => clock.setSimulated(tx, date));
}

export async function reset(user: AuthUser): Promise<ClockState> {
  return change(user, 'CLOCK_RESET', (tx) => clock.resetToReal(tx));
}
