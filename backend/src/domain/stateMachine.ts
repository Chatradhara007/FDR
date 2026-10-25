import type { PoolClient } from 'pg';
import { canTransition, type InstrumentStatus } from '@fdr/shared';
import { exec } from '../db/pool';
import { recordEvent, type Actor } from './audit';
import * as clock from './clock';
import { Conflict, InvalidTransition } from './errors';

// The only place instruments.status changes (CLAUDE.md rule 4; guarded by phase01.sourceGuard.test.ts).

export interface TransitionTarget {
  id: string;
  status: InstrumentStatus;
  version?: number;
}

export async function transition(
  tx: PoolClient,
  inst: TransitionTarget,
  to: InstrumentStatus,
  actor: Actor,
  extra?: Record<string, unknown>,
): Promise<void> {
  const from = inst.status;
  if (!canTransition(from, to)) throw new InvalidTransition(from, to);
  const updated = await exec(
    tx,
    `UPDATE instruments
        SET status = $1::instrument_status,
            status_before_release = CASE WHEN $1::instrument_status = 'RELEASE_REQUESTED' THEN $3::instrument_status ELSE status_before_release END,
            version = version + 1,
            updated_at = $4
      WHERE id = $2 AND status = $3::instrument_status`,
    [to, inst.id, from, await clock.now(tx)],
  );
  if (updated === 0) {
    throw new Conflict('The instrument was changed by someone else; reload and try again', { from, to }, 'STATUS_CHANGED');
  }
  await recordEvent(tx, {
    actor,
    action: `STATUS_${to}`,
    entityType: 'instrument',
    entityId: inst.id,
    instrumentId: inst.id,
    before: { status: from },
    after: { status: to, ...extra },
  });
}
