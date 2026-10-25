import { INSTRUMENT_STATUSES, STATUS_LABELS } from './enums';

// Human labels for audit actions (verb-style SCREAMING_SNAKE). Later phases add their actions here.
export const EVENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(INSTRUMENT_STATUSES.map((s) => [`STATUS_${s}`, `Status changed to ${STATUS_LABELS[s]}`])),
  CLOCK_ADVANCED: 'App clock advanced',
  CLOCK_SET: 'App clock set',
  CLOCK_RESET: 'App clock reset to real time',
  INSTRUMENT_CREATED: 'Draft created',
  INSTRUMENT_EDITED: 'Details edited',
  INSTRUMENT_SUBMITTED: 'Submitted for scrutiny',
  INSTRUMENT_DRAFT_DELETED: 'Draft deleted',
  DOCUMENT_UPLOADED: 'Document uploaded',
  DOCUMENT_REMOVED: 'Document removed',
  DOCUMENT_ACCESSED: 'Document opened',
};

export function eventLabel(action: string): string {
  return EVENT_LABELS[action] ?? action;
}

/** Events an institution may see on its own passport timeline (D24). */
export const INSTITUTION_VISIBLE_ACTIONS: readonly string[] = [
  ...INSTRUMENT_STATUSES.map((s) => `STATUS_${s}`),
  'INSTRUMENT_CREATED',
  'INSTRUMENT_EDITED',
  'INSTRUMENT_SUBMITTED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_REMOVED',
];
