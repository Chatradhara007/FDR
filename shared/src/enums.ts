// Domain enums shared by backend and frontend. The const arrays mirror the Postgres enums in 001_init.sql.

export const ROLES = ['institution', 'officer', 'approver', 'admin', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  institution: 'Institution',
  officer: 'Scrutiny officer',
  approver: 'Approver',
  admin: 'Administrator',
  auditor: 'Auditor',
};

export const INSTRUMENT_TYPES = ['FDR', 'SECURITY_DEPOSIT'] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const INSTRUMENT_TYPE_LABELS: Record<InstrumentType, string> = {
  FDR: 'Fixed Deposit Receipt',
  SECURITY_DEPOSIT: 'Security deposit',
};

export const INSTRUMENT_STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'RETURNED', 'ACTIVE', 'EXPIRING',
  'MATURED', 'RENEWED', 'LAPSED', 'RELEASE_REQUESTED', 'RELEASED',
] as const;
export type InstrumentStatus = (typeof INSTRUMENT_STATUSES)[number];

export const STATUS_LABELS: Record<InstrumentStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_SCRUTINY: 'Under scrutiny',
  RETURNED: 'Returned',
  ACTIVE: 'Active',
  EXPIRING: 'Expiring',
  MATURED: 'Matured',
  RENEWED: 'Renewed',
  LAPSED: 'Lapsed',
  RELEASE_REQUESTED: 'Release requested',
  RELEASED: 'Released',
};

export const TRUST_TIERS = ['CLAIMED', 'DOCUMENT', 'BANK_CONFIRMED'] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  CLAIMED: 'Claimed',
  DOCUMENT: 'Document-checked',
  BANK_CONFIRMED: 'Bank-confirmed',
};

export const VERIFICATION_STATES = ['UNVERIFIED', 'PENDING', 'CONFIRMED', 'MISMATCH', 'UNAVAILABLE'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const VERIFICATION_STATE_LABELS: Record<VerificationState, string> = {
  UNVERIFIED: 'Not verified',
  PENDING: 'Bank response pending',
  CONFIRMED: 'Bank-confirmed',
  MISMATCH: 'Mismatch',
  UNAVAILABLE: 'Bank unavailable',
};

export const DOC_TYPES = [
  'FDR_COPY', 'BANK_LETTER', 'DEPOSIT_CONFIRMATION', 'LIEN_LETTER', 'RELEASE_LETTER', 'COMPLIANCE_CERTIFICATE', 'OTHER',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  FDR_COPY: 'FDR copy',
  BANK_LETTER: 'Bank letter',
  DEPOSIT_CONFIRMATION: 'Deposit confirmation',
  LIEN_LETTER: 'Lien letter',
  RELEASE_LETTER: 'Release letter',
  COMPLIANCE_CERTIFICATE: 'Compliance certificate',
  OTHER: 'Other',
};
