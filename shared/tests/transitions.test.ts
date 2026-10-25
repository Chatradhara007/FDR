import { describe, expect, it } from 'vitest';
import { INSTRUMENT_STATUSES } from '../src/enums';
import { ALLOWED, TERMINAL_STATUSES, canTransition } from '../src/transitions';

describe('transitions table', () => {
  it('covers every status and only names known statuses', () => {
    expect(Object.keys(ALLOWED).sort()).toEqual([...INSTRUMENT_STATUSES].sort());
    for (const targets of Object.values(ALLOWED)) for (const t of targets) expect(INSTRUMENT_STATUSES).toContain(t);
  });
  it('terminal statuses have no exits', () => {
    for (const s of TERMINAL_STATUSES) expect(ALLOWED[s]).toEqual([]);
  });
  it('canTransition', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('RELEASE_REQUESTED', 'LAPSED')).toBe(true);
  });
});
