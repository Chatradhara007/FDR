// Generated from shared/constants.json by scripts/gen_shared_types.py. Do not edit by hand.

export type Role = 'institution' | 'officer' | 'approver' | 'admin' | 'auditor';
export type InstrumentType = 'FDR' | 'SECURITY_DEPOSIT';
export type InstrumentStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_SCRUTINY' | 'RETURNED' | 'ACTIVE' | 'EXPIRING' | 'MATURED' | 'RENEWED' | 'LAPSED' | 'RELEASE_REQUESTED' | 'RELEASED';
export type TrustTier = 'CLAIMED' | 'DOCUMENT' | 'BANK_CONFIRMED';
export type VerificationState = 'UNVERIFIED' | 'PENDING' | 'CONFIRMED' | 'MISMATCH' | 'UNAVAILABLE';
export type DocType = 'FDR_COPY' | 'BANK_LETTER' | 'DEPOSIT_CONFIRMATION' | 'LIEN_LETTER' | 'RELEASE_LETTER' | 'COMPLIANCE_CERTIFICATE' | 'OTHER';
export type TrackedField = 'reference_no' | 'issuing_bank' | 'amount' | 'issue_date' | 'maturity_date' | 'beneficiary_name' | 'lien_marked';
export type Bank = 'State Bank of India' | 'Punjab National Bank' | 'Bank of Baroda' | 'Canara Bank' | 'Union Bank of India' | 'HDFC Bank' | 'ICICI Bank' | 'Axis Bank' | 'Bank of India' | 'Indian Overseas Bank' | 'Kotak Mahindra Bank';
