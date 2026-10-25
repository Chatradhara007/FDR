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
