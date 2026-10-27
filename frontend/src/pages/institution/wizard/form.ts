import type { InstrumentDetail, InstrumentType } from '@fdr/shared';

/** Wizard form state: strings as typed (the server normalises), amount shown with Indian grouping. */
export interface FormValues {
  type: InstrumentType;
  referenceNo: string;
  issuingBank: string;
  branch: string;
  amount: string;
  issueDate: string;
  maturityDate: string;
  beneficiaryName: string;
  lienMarked: boolean;
  purpose: string;
}

export const EMPTY_FORM: FormValues = {
  type: 'FDR', referenceNo: '', issuingBank: '', branch: '', amount: '', issueDate: '', maturityDate: '',
  beneficiaryName: '', lienMarked: false, purpose: '',
};

export const BENEFICIARY_HINT = 'Member Secretary, AICTE';

/** '2500000' / '25,00,000.5' → '25,00,000.5' while typing (digits and one dot only; no floats). */
export function groupAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const [intPart = '', ...rest] = cleaned.split('.');
  const digits = intPart.replace(/^0+(?=\d)/, '');
  const grouped = digits.length <= 3 ? digits : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`;
  return rest.length ? `${grouped}.${rest.join('').slice(0, 2)}` : grouped;
}

export function fromDetail(d: InstrumentDetail): FormValues {
  return {
    type: d.type,
    referenceNo: d.referenceNo ?? '',
    issuingBank: d.issuingBank ?? '',
    branch: d.branch ?? '',
    amount: d.amount ? groupAmountInput(d.amount.replace(/\.00$/, '')) : '',
    issueDate: d.issueDate ?? '',
    maturityDate: d.maturityDate ?? '',
    beneficiaryName: d.beneficiaryName ?? '',
    lienMarked: d.lienMarked,
    purpose: d.purpose ?? '',
  };
}

/** Request body: empty strings become null (the field is cleared). */
export function toBody(v: FormValues) {
  const n = (s: string) => (s.trim() === '' ? null : s);
  return {
    referenceNo: n(v.referenceNo),
    issuingBank: n(v.issuingBank),
    branch: n(v.branch),
    amount: n(v.amount),
    issueDate: n(v.issueDate),
    maturityDate: n(v.maturityDate),
    beneficiaryName: n(v.beneficiaryName),
    lienMarked: v.lienMarked,
    purpose: n(v.purpose),
  };
}

export const REQUIRED_FIELDS: { key: keyof FormValues; label: string }[] = [
  { key: 'referenceNo', label: 'Reference number' },
  { key: 'issuingBank', label: 'Issuing bank' },
  { key: 'amount', label: 'Amount' },
  { key: 'issueDate', label: 'Issue date' },
  { key: 'maturityDate', label: 'Maturity date' },
  { key: 'beneficiaryName', label: 'Beneficiary name' },
];

export const FIELD_LABELS: Record<string, string> = Object.fromEntries([
  ...REQUIRED_FIELDS.map((f) => [f.key, f.label]),
  ['type', 'Type'], ['branch', 'Branch'], ['lienMarked', 'Lien marked'], ['purpose', 'Purpose'],
]);

export const inputCls =
  'gov-input disabled:bg-subtle disabled:text-muted';
