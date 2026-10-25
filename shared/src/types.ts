import type { DocType, InstrumentStatus, InstrumentType, Role, TrustTier, VerificationState } from './enums';
import type { TrackedField } from './fields';

/** API shapes (camelCase) shared by backend responses and the frontend. */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  institutionId: string | null;
  institutionName: string | null;
  designation: string | null;
}

export interface LoginResponse {
  token: string;
  user: SessionUser;
}

export interface DemoUser {
  email: string;
  name: string;
  role: Role;
  institutionName: string | null;
}

export interface ClockState {
  mode: 'REAL' | 'SIMULATED';
  now: string;
  today: string;
  warning?: 'CLOCK_MOVED_BACKWARDS';
}

export interface Instrument {
  id: string;
  institutionId: string;
  type: InstrumentType;
  referenceNo: string | null;
  issuingBank: string | null;
  branch: string | null;
  amount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  beneficiaryName: string | null;
  lienMarked: boolean;
  purpose: string | null;
  status: InstrumentStatus;
  statusBeforeRelease: InstrumentStatus | null;
  verificationState: VerificationState;
  acceptedWithOverride: boolean;
  overrideNote: string | null;
  assignedOfficerId: string | null;
  parentInstrumentId: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InstrumentListItem {
  id: string;
  type: InstrumentType;
  referenceNo: string | null;
  issuingBank: string | null;
  amount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  status: InstrumentStatus;
  verificationState: VerificationState;
  institutionId: string;
  institutionName: string;
  region: string;
  /** Calendar days from the app clock's today to maturity; null while the draft has no maturity date. */
  daysToMaturity: number | null;
  version: number;
  updatedAt: string;
}

export interface InstrumentListResponse {
  items: InstrumentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DocumentInfo {
  id: string;
  instrumentId: string;
  docType: DocType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ProvenanceRow {
  fieldName: TrackedField;
  value: string;
  tier: TrustTier;
  source: string | null;
  updatedAt: string;
}

export interface InstrumentDetail extends Instrument {
  institutionName: string;
  region: string;
  documents: DocumentInfo[];
  provenance: ProvenanceRow[];
  daysToMaturity: number | null;
  requiredDocs: DocType[];
  missingDocs: DocType[];
  lienRequired: boolean;
}

export interface UploadResponse {
  document: DocumentInfo;
  /** Set when a live document with the same checksum already exists on this instrument. */
  duplicateOf: string | null;
}

/** `details` of the 422 returned by POST /instruments/:id/submit. */
export interface SubmitErrorDetails {
  fields: { field: string; message: string }[];
  missingDocuments: DocType[];
}

export interface Meta {
  banks: readonly string[];
  docTypes: { value: DocType; label: string }[];
  instrumentTypes: { value: InstrumentType; label: string }[];
  regions: string[];
  requiredDocs: Record<InstrumentType, DocType[]>;
  lienRequired: Record<InstrumentType, boolean>;
}
