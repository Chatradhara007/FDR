import type {
  AlertKind, AlertResolution, AlertStatus, DocType, InstrumentStatus, InstrumentType, ObservationSeverity, Role, TrackedField, TrustTier, VerificationResult, VerificationState,
} from './constants.gen';

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
  /** Lowest trust tier among the seven tracked fields; null before the first submission. */
  weakestTier: TrustTier | null;
  /** Highest escalation level among open alerts on it (institutions: their own copies only); null when none. */
  worstOpenAlertLevel: number | null;
  openAlertCount: number;
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
  weakestTier: TrustTier | null;
  /** Why the instrument was sent back, newest first. */
  returns: ReturnRecord[];
  /** Institution users only receive observations marked visible to them (D24). */
  observations: Observation[];
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

/** Request bodies (validated server-side by backend/app/schemas.py). Blank strings and null clear a field. */
export interface InstrumentFieldsInput {
  referenceNo?: string | null;
  issuingBank?: string | null;
  branch?: string | null;
  amount?: string | number | null;
  issueDate?: string | null;
  maturityDate?: string | null;
  beneficiaryName?: string | null;
  lienMarked?: boolean;
  purpose?: string | null;
}

export interface InstrumentCreateInput extends InstrumentFieldsInput {
  type: InstrumentType;
}

export interface InstrumentPatchInput extends InstrumentFieldsInput {
  type?: InstrumentType;
  version: number;
}

// ---- Phase 03: scrutiny ----

export interface ReturnRecord {
  id: string;
  instrumentId: string;
  officerId: string;
  officerName: string | null;
  reason: string;
  createdAt: string;
}

export interface Observation {
  id: string;
  instrumentId: string;
  authorId: string | null;
  authorName: string | null;
  text: string;
  severity: ObservationSeverity;
  visibleToInstitution: boolean;
  status: 'OPEN' | 'RESOLVED';
  resolutionNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Discrepancy {
  id: string;
  instrumentId: string;
  verificationId: string | null;
  fieldName: TrackedField;
  claimedValue: string;
  confirmedValue: string | null;
  reason: string;
  status: 'OPEN' | 'RESOLVED';
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface BankField {
  submitted: string;
  confirmed: string;
  match: boolean;
}

/** What the bank answered (stored verbatim in verifications.response_payload). */
export interface BankResponse {
  result: Exclude<VerificationResult, 'STALE'>;
  bank?: string;
  response_id?: string;
  responded_at?: string;
  fields?: Partial<Record<TrackedField, BankField>>;
  note?: string;
  retry_after_seconds?: number;
  reason?: string;
}

export interface Verification {
  id: string;
  instrumentId: string;
  source: string;
  requestPayload: Record<string, string>;
  responsePayload: BankResponse | null;
  result: VerificationResult;
  requestedBy: string;
  requestedByName: string | null;
  requestedAt: string;
  respondedAt: string | null;
}

export interface Gap {
  code: string;
  message: string;
  severity: 'blocker' | 'warning';
  ref?: string;
}

export interface ReviewField {
  fieldName: TrackedField;
  value: string;
  tier: TrustTier;
  /** 'institution', 'document:<docId>' or 'bank:<responseId>'. */
  source: string | null;
  updatedAt: string | null;
}

/** GET /instruments/:id/review — everything the officer review page needs. */
export interface ReviewPayload {
  instrument: InstrumentDetail;
  assignedOfficerName: string | null;
  fields: ReviewField[];
  verifications: Verification[];
  discrepancies: Discrepancy[];
  observations: Observation[];
  gaps: Gap[];
  canAccept: boolean;
  /** Only the missing bank confirmation stands in the way; an override note lifts it (D4). */
  canAcceptWithOverride: boolean;
  acceptBlockers: string[];
}

export interface VerifyResponse {
  result: VerificationResult;
  verificationId: string;
  mismatchedFields: TrackedField[];
  retryAfterSeconds: number | null;
  reason?: string;
  review: ReviewPayload;
}

export interface DocumentCheckResponse {
  unchanged: boolean;
  review: ReviewPayload;
}

export interface QueueItem {
  id: string;
  referenceNo: string | null;
  issuingBank: string | null;
  amount: string | null;
  maturityDate: string | null;
  verificationState: VerificationState;
  status: InstrumentStatus;
  assignedOfficerId: string | null;
  assignedOfficerName: string | null;
  institution: string;
  region: string;
  openDiscrepancies: number;
  submittedAt: string | null;
  ageingDays: number | null;
  worstOpenAlertLevel: number | null;
  openAlertCount: number;
}

export interface QueueResponse {
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ObservationInput {
  text: string;
  severity: ObservationSeverity;
  visibleToInstitution: boolean;
}

/** Counters returned by one run of the evaluation job (Phase 04). */
export interface EvaluationSummary {
  asOf: string;
  statusChanges: number;
  alertsCreated: number;
  escalations: number;
  resolved: number;
  superseded: number;
}

/** POST /clock/advance | /clock/set | /clock/reset: the clock moved and the job ran for the new date. */
export interface ClockChange {
  clock: ClockState;
  summary: EvaluationSummary;
}

export interface Alert {
  id: string;
  instrumentId: string;
  kind: AlertKind;
  ruleKey: string;
  subjectId: string;
  level: number;
  rootAlertId: string;
  recipientRole: Role;
  recipientUserId: string | null;
  institutionId: string;
  dueDate: string;
  message: string;
  status: AlertStatus;
  resolution: AlertResolution | null;
  resolutionNote: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  rootCreatedAt: string;
  /** Days since the first alert of the escalation chain (app clock). */
  ageDays: number;
  instrumentReferenceNo: string | null;
  instrumentType: InstrumentType;
  instrumentStatus: InstrumentStatus;
  issuingBank: string | null;
  amount: string | null;
  maturityDate: string | null;
  institutionName: string;
}

export interface AlertListResponse {
  items: Alert[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AlertSummary {
  total: number;
  byKind: Record<AlertKind, number>;
  byLevel: Record<string, number>;
}

export interface OutboxItem {
  id: number;
  alertId: string | null;
  toRole: Role | null;
  toUserId: string | null;
  toUserName: string | null;
  toInstitutionId: string | null;
  toInstitutionName: string | null;
  subject: string;
  body: string;
  createdAt: string;
}

export interface OutboxResponse {
  items: OutboxItem[];
  total: number;
  page: number;
  pageSize: number;
}
