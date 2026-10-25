import type { InstrumentStatus } from './enums';

type Status = InstrumentStatus;

/** The only allowed lifecycle moves; enforced by backend/src/domain/stateMachine.ts. */
export const ALLOWED: Record<Status, readonly Status[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_SCRUTINY', 'RETURNED'],
  UNDER_SCRUTINY: ['ACTIVE', 'RETURNED'],
  RETURNED: ['SUBMITTED'],
  ACTIVE: ['EXPIRING', 'RELEASE_REQUESTED'],
  EXPIRING: ['MATURED', 'RENEWED', 'RELEASE_REQUESTED'],
  MATURED: ['RENEWED', 'LAPSED', 'RELEASE_REQUESTED'],
  LAPSED: ['RENEWED', 'RELEASE_REQUESTED'],
  RELEASE_REQUESTED: ['RELEASED', 'ACTIVE', 'EXPIRING', 'MATURED', 'LAPSED'],
  RENEWED: [],
  RELEASED: [],
};

export const LIVE_STATUSES: readonly Status[] = ['ACTIVE', 'EXPIRING', 'MATURED', 'LAPSED', 'RELEASE_REQUESTED'];
export const TERMINAL_STATUSES: readonly Status[] = ['RENEWED', 'RELEASED'];

export function canTransition(from: Status, to: Status): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
