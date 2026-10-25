import type { Instrument } from '@fdr/shared';
import { getPool } from '../db/pool';
import { assertCanSee, type AuthUser } from '../domain/access';
import { NotFound } from '../domain/errors';
import { findInstrumentById } from '../repositories/instrumentRepo';

export async function getInstrument(user: AuthUser, id: string): Promise<Instrument> {
  const row = await findInstrumentById(getPool(), id);
  if (!row) throw new NotFound('Instrument not found');
  assertCanSee(user, row);
  return JSON.parse(JSON.stringify(row)) as Instrument;
}
