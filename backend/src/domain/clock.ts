import type { Db } from '../db/pool';
import { readClock, writeClock } from '../repositories/clockRepo';

// The one clock (CLAUDE.md rule 2). Business code reads time only through now()/today().
// This file is the only place that reads wall time for business purposes.

const DAY_MS = 86_400_000;
const istFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type ClockMode = 'REAL' | 'SIMULATED';

export async function mode(db: Db): Promise<ClockMode> {
  return (await readClock(db)).mode;
}

/** SIMULATED ? simulated_now : wall time. */
export async function now(db: Db): Promise<Date> {
  const row = await readClock(db);
  return row.mode === 'SIMULATED' && row.simulated_now ? row.simulated_now : new Date();
}

/** Business date 'YYYY-MM-DD' in Asia/Kolkata. */
export async function today(db: Db): Promise<string> {
  return istDate(await now(db));
}

/** Calendar date of an instant in Asia/Kolkata. */
export function istDate(d: Date): string {
  return istFormatter.format(d);
}

/** Simulates `date` at 10:00 IST. */
export async function setSimulated(db: Db, date: string): Promise<void> {
  await writeClock(db, 'SIMULATED', new Date(`${date}T10:00:00+05:30`));
}

/** Moves n days from the current now() (keeps the time of day) and switches to SIMULATED. */
export async function advanceDays(db: Db, n: number): Promise<void> {
  const current = await now(db);
  await writeClock(db, 'SIMULATED', new Date(current.getTime() + n * DAY_MS));
}

export async function resetToReal(db: Db): Promise<void> {
  await writeClock(db, 'REAL', null);
}

function utcDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar days b - a for 'YYYY-MM-DD' strings (D22: no business-day logic). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcDay(b) - utcDay(a)) / DAY_MS);
}

/** 'YYYY-MM-DD' plus n calendar days. */
export function addDays(date: string, n: number): string {
  return new Date(utcDay(date) + n * DAY_MS).toISOString().slice(0, 10);
}
