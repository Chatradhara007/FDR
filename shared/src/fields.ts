import { normAmount, normBool, normName, normRef } from './normalize';

// The seven tracked fields whose trust tier is recorded per instrument (D8).
export const TRACKED_FIELDS = [
  'reference_no', 'issuing_bank', 'amount', 'issue_date', 'maturity_date', 'beneficiary_name', 'lien_marked',
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export const FIELD_LABELS: Record<TrackedField, string> = {
  reference_no: 'Reference number',
  issuing_bank: 'Issuing bank',
  amount: 'Amount',
  issue_date: 'Issue date',
  maturity_date: 'Maturity date',
  beneficiary_name: 'Beneficiary name',
  lien_marked: 'Lien marked in favour of AICTE',
};

/** The tracked fields as the API names them (camelCase). */
export const TRACKED_FIELD_KEYS: Record<TrackedField, string> = {
  reference_no: 'referenceNo',
  issuing_bank: 'issuingBank',
  amount: 'amount',
  issue_date: 'issueDate',
  maturity_date: 'maturityDate',
  beneficiary_name: 'beneficiaryName',
  lien_marked: 'lienMarked',
};

export interface TrackedValues {
  referenceNo: string | null;
  issuingBank: string | null;
  amount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  beneficiaryName: string | null;
  lienMarked: boolean;
}

/** Canonical string form stored in field_provenance.value (normalised so equal values compare equal). */
export function trackedValue(field: TrackedField, v: TrackedValues): string {
  switch (field) {
    case 'reference_no':
      return normRef(v.referenceNo ?? '');
    case 'issuing_bank':
      return v.issuingBank ?? '';
    case 'amount':
      return v.amount === null ? '' : normAmount(v.amount);
    case 'issue_date':
      return v.issueDate ?? '';
    case 'maturity_date':
      return v.maturityDate ?? '';
    case 'beneficiary_name':
      return (v.beneficiaryName ?? '').trim().replace(/\s+/g, ' ');
    case 'lien_marked':
      return normBool(v.lienMarked);
  }
}

/** Whether two stored values of a field mean the same thing (names ignore case and punctuation). */
export function sameTrackedValue(field: TrackedField, a: string, b: string): boolean {
  if (field === 'beneficiary_name') return normName(a) === normName(b);
  if (field === 'reference_no') return normRef(a) === normRef(b);
  return a === b;
}
