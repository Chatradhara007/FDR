import { config } from '../config';
import { getPool, maybeOne } from '../db/pool';

export interface Health {
  status: 'ok';
  db: 'up' | 'down';
  mockBank: 'up' | 'down';
  time: string;
}

async function dbStatus(): Promise<'up' | 'down'> {
  try {
    await maybeOne(getPool(), 'SELECT 1');
    return 'up';
  } catch {
    return 'down';
  }
}

async function mockBankStatus(): Promise<'up' | 'down'> {
  try {
    const res = await fetch(`${config.mockBankUrl}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export async function getHealth(): Promise<Health> {
  const [db, mockBank] = await Promise.all([dbStatus(), mockBankStatus()]);
  // Infrastructure timestamp (wall time), not business time; the app clock arrives in Phase 1.
  return { status: 'ok', db, mockBank, time: new Date().toISOString() };
}
