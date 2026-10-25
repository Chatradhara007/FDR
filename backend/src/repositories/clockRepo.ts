import { exec, one, type Db } from '../db/pool';

export interface ClockRow {
  mode: 'REAL' | 'SIMULATED';
  simulated_now: Date | null;
}

export async function readClock(db: Db, forUpdate = false): Promise<ClockRow> {
  return one<ClockRow>(
    db,
    `SELECT mode, simulated_now FROM app_clock WHERE id = 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [],
    'app_clock row missing (run migrations)',
  );
}

export async function writeClock(db: Db, mode: ClockRow['mode'], simulatedNow: Date | null): Promise<void> {
  await exec(db, 'UPDATE app_clock SET mode = $1, simulated_now = $2 WHERE id = 1', [mode, simulatedNow]);
}
