import type {
  AlertKind, AlertResolution, AlertStatus, DocType, InstrumentStatus, InstrumentType, ObservationSeverity, ReleaseDecision, ReleaseLevelAction,
  ReleaseRequestStatus, Role, TrackedField, TrustTier, VerificationResult, VerificationState,
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
  /** Set on documents attached to a release request (Phase 6). */
  releaseRequestId?: string | null;
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
  /** DEMO_MODE (D17): demo tools, quick sign-in and the header ribbon. */
  demoMode: boolean;
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
  /** Advisory pattern flags (officers only; never blocks anything). */
  advisoryFlags: AdvisoryFlag[];
  /** PDF text cross-check (officers only; never changes a trust tier). */
  documentFindings: DocumentFindings;
}

export type AdvisoryFlagKind = 'DUPLICATE_REFERENCE' | 'HIGH_AMOUNT' | 'BENEFICIARY_NEAR_MISS';

export interface AdvisoryFlag {
  id: string;
  instrumentId: string;
  kind: AdvisoryFlagKind;
  /** Plain-language reason. */
  reason: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export type TextCheckField = 'reference_no' | 'amount' | 'issue_date' | 'maturity_date';

export interface TextCheck {
  field: TextCheckField;
  claimed: string;
  /** What the document's text prints next to the field's label, when it prints one. */
  found: string | null;
  result: 'MATCH' | 'DIFFERENT' | 'NOT_FOUND';
}

export interface MetadataSignal {
  reasons: Array<'MODIFIED_AFTER_CREATED' | 'IMAGE_EDITOR'>;
  producer: string | null;
  creator: string | null;
  created: string | null;
  modified: string | null;
}

export interface DocumentFinding {
  documentId: string;
  filename: string;
  docType: DocType;
  status: 'READ' | 'UNREADABLE';
  reason: string | null;
  /** Why the text could not be read, in plain words. */
  message: string | null;
  /** Only for the main document (FDR copy / deposit confirmation). */
  checks: TextCheck[];
  metadataSignal: MetadataSignal | null;
  advisoryLabel: string;
}

export interface DocumentFindings {
  items: DocumentFinding[];
  note: string;
}

/** GET /verify/release/:orderNo (public). Nothing but these fields, and `{ valid: false }` when not found. */
export type ReleaseVerification =
  | { valid: false }
  | {
      valid: true;
      orderNumber: string;
      status: string;
      instrumentReference: string | null;
      approvedDate: string;
      approverDesignation: string;
      eventHash: string;
    };

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

// ---- Phase 05: renewal chain and passport ----

/** One link of a renewal chain, oldest first. `gapDaysFromPrevious`: positive = gap, negative = overlap. */
export interface ChainLink {
  id: string;
  referenceNo: string | null;
  issuingBank: string | null;
  amount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  status: InstrumentStatus;
  depth: number;
  isCurrent: boolean;
  gapDaysFromPrevious: number | null;
  gapKind: 'gap' | 'overlap' | 'continuous' | 'unknown' | null;
}

/** Institutions get the outcome and per-field match only (D24); AICTE roles also the raw payloads. */
export interface PassportVerification {
  id: string;
  result: VerificationResult;
  requestedAt: string;
  respondedAt: string | null;
  fieldMatches: Partial<Record<TrackedField, boolean>>;
  requestedByName?: string | null;
  source?: string;
  requestPayload?: Record<string, string>;
  responsePayload?: BankResponse | null;
}

export type TimelineIcon =
  | 'status' | 'renewal' | 'view' | 'document' | 'bank' | 'discrepancy' | 'observation' | 'alert' | 'return' | 'accept' | 'edit'
  | 'clock' | 'release' | 'event';

export interface TimelineEvent {
  id: number;
  action: string;
  label: string;
  icon: TimelineIcon;
  actor: string;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface PassportSummary {
  daysToMaturity: number | null;
  weakestTier: TrustTier | null;
  openProblems: Gap[];
  acceptedWithOverride: boolean;
  overrideNote: string | null;
  openAlertCount: number;
  worstOpenAlertLevel: number | null;
}

/** GET /instruments/:id/passport — the whole story of one instrument, filtered by role. */
export interface Passport {
  instrument: InstrumentDetail;
  fields: ReviewField[];
  weakestTier: TrustTier | null;
  chain: ChainLink[];
  documents: DocumentInfo[];
  verifications: PassportVerification[];
  discrepancies: Discrepancy[];
  observations: Observation[];
  returns: ReturnRecord[];
  alerts: Alert[];
  releaseRequests: ReleaseView[];
  summary: PassportSummary;
  timeline: TimelineEvent[];
}

// ---- Phase 06: release requests ----

/** One level of a request's approval chain, frozen when the request was made. */
export interface ReleaseLevel {
  level: number;
  role: Role;
  action: ReleaseLevelAction;
  label: string;
}

export interface ReleaseRequest {
  id: string;
  instrumentId: string;
  institutionId: string;
  requestedBy: string;
  requestedByName: string;
  reason: string;
  status: ReleaseRequestStatus;
  requiredLevels: ReleaseLevel[];
  currentLevel: number;
  returnMessage: string | null;
  refundReference: string | null;
  requestedAt: string;
  stageStartedAt: string;
  closedAt: string | null;
}

export interface ConditionLink {
  type: 'discrepancy' | 'observation' | 'verification' | 'documents';
  id?: string;
  field?: TrackedField;
}

/** Auto conditions are evaluated live on every read; manual ones as an officer recorded them. */
export interface ReleaseCondition {
  id: string;
  code: string;
  description: string;
  mandatory: boolean;
  auto: boolean;
  met: boolean;
  reason: string | null;
  link: ConditionLink | null;
  checkedByName: string | null;
  checkedAt: string | null;
  remarks: string | null;
  metAtRecommendation: boolean | null;
  changedSinceRecommendation: boolean;
}

export interface SnapshotCondition {
  code: string;
  description: string;
  mandatory: boolean;
  auto: boolean;
  met: boolean;
  reason: string | null;
}

export interface ReleaseApproval {
  id: string;
  level: number;
  label: string;
  role: Role;
  approverName: string;
  approverDesignation: string | null;
  decision: ReleaseDecision;
  /** Institutions only get the remarks of returns and rejections (D24). */
  remarks: string | null;
  conditionsSnapshot: SnapshotCondition[] | null;
  decidedAt: string;
}

/** GET /release-requests/:id (and each entry of the passport's releaseRequests). */
export interface ReleaseView {
  request: ReleaseRequest;
  statusLabel: string;
  currentLevelInfo: ReleaseLevel | null;
  instrument: InstrumentDetail;
  documents: DocumentInfo[];
  conditions: ReleaseCondition[];
  blocked: boolean;
  blockers: string[];
  approvals: ReleaseApproval[];
  orderNumber: string | null;
  /** Public address that verifies the order, and the same address as a QR code (inline SVG); null until approved. */
  verifyUrl: string | null;
  qrSvg: string | null;
  canRecommend: boolean;
  canDecide: boolean;
  canApprove: boolean;
  /** Why the signed-in user cannot recommend / approve right now. */
  actionBlockers: string[];
  canEditConditions: boolean;
  canUploadDocuments: boolean;
  canResubmit: boolean;
  canCancel: boolean;
}

export interface ReleaseListItem {
  id: string;
  instrumentId: string;
  status: ReleaseRequestStatus;
  currentLevel: number;
  requiredLevels: ReleaseLevel[];
  reason: string;
  requestedAt: string;
  stageStartedAt: string;
  closedAt: string | null;
  ageDays: number;
  referenceNo: string | null;
  instrumentType: InstrumentType;
  instrumentStatus: InstrumentStatus;
  issuingBank: string | null;
  amount: string | null;
  maturityDate: string | null;
  institutionId: string;
  institutionName: string;
}

export interface ReleaseListResponse {
  items: ReleaseListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DecideInput {
  decision: 'APPROVE' | 'REJECT' | 'RETURN';
  remarks: string;
  refundReference?: string;
  level: number;
}

// ---- Phase 07: dashboard, my day, institutions, reports, improvement ----

export interface CountAmount { count: number; amount: string }

export interface Dashboard {
  asOf: string;
  filters: { region?: string | null; type?: InstrumentType | null };
  kpis: {
    live: CountAmount;
    confirmedAmount: string;
    confirmedPct: number | null;
    pendingScrutiny: number;
    openDiscrepancies: number;
    openEscalations: number;
    /** Open advisory flags on submitted instruments (officers only). */
    advisoryFlags: number;
  };
  byStatus: Array<CountAmount & { key: string; label: string; statuses: InstrumentStatus[] }>;
  verification: { byState: Record<VerificationState, number>; acceptedWithOverride: number };
  maturityBuckets: Array<CountAmount & { key: 'overdue' | 'd0_30' | 'd31_60' | 'd61_90'; label: string }>;
  maturityByMonth: Array<CountAmount & { month: string }>;
  byRegion: Array<CountAmount & { region: string; atRisk: number }>;
  byBank: Array<{
    bank: string; count: number; verified: number; verifications: number; mismatches: number;
    mismatchRate: number | null; unavailable: number; discrepancies: number;
  }>;
  alerts: { byKind: Record<AlertKind, number>; byLevel: Record<string, number>; total: number };
}

export interface RiskWeights {
  amount: number; urgency: number; verification: number; discrepancy: number; escalation: number;
  amountCap: string; urgencyHorizonDays: number;
}

export interface WorkItem {
  kind: 'instrument' | 'release';
  id: string;
  instrumentId: string;
  title: string;
  institution: string;
  referenceNo: string | null;
  amount: string | null;
  score: number;
  components: { amount: number; urgency: number; verification: number; discrepancy: number; escalation: number };
  daysLeft: number | null;
  reasons: string[];
  nextAction: string;
  link: string;
}

export interface MyDay { asOf: string; weights: RiskWeights; items: WorkItem[] }

export interface InstitutionSummary {
  id: string;
  aicteId: string;
  name: string;
  region: string;
  state: string;
  contactEmail: string | null;
  byStatus: Partial<Record<InstrumentStatus, CountAmount>>;
  liveCount: number;
  liveAmount: string;
  openProblems: { openDiscrepancies: number; overdue: number; returned: number; openAlerts: number; total: number };
}

export interface InstitutionListResponse { items: InstitutionSummary[]; total: number; page: number; pageSize: number }

export interface InstitutionAlert {
  id: string; instrumentId: string; referenceNo: string | null; kind: AlertKind; level: number; recipientRole: Role;
  dueDate: string; message: string; status: AlertStatus;
}

export interface InstitutionProfile {
  institution: InstitutionSummary;
  asOf: string;
  instruments: InstrumentListItem[];
  alerts: InstitutionAlert[];
  releaseRequests: ReleaseListItem[];
}

export type ReportColumnKind = 'text' | 'date' | 'amount' | 'int' | 'status' | 'verification' | 'result' | 'releaseStatus' | 'field';

export interface Report {
  preset: string;
  title: string;
  asOf: string;
  filters: Record<string, unknown>;
  columns: Array<{ key: string; label: string; kind: ReportColumnKind }>;
  rows: Array<Record<string, unknown>>;
  total: number;
}

export interface ImprovementFigure { value: number | null; display: string }

export interface ImprovementMetric {
  key: string;
  title: string;
  unit: string;
  better: 'lower' | 'higher';
  portal: ImprovementFigure;
  manual: ImprovementFigure;
  sampleSize: number | null;
  explanation: string;
  label: string;
}

export interface Improvement { label: string; asOf: string; baselineNote: string; metrics: ImprovementMetric[] }

// ---- Phase 08: rules administration, users, audit ----

export interface RuleView {
  key: string;
  name: string;
  type: string;
  config: unknown;
  defaultConfig: unknown;
  active: boolean;
  version: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface ReminderOffsetConfig { days: number; recipients: Role[] }
export interface ReminderConfig { offsets: ReminderOffsetConfig[] }
export interface EscalationLevelConfig { level: number; role: Role; afterDays: number }
export interface EscalationConfig { levels: EscalationLevelConfig[]; kinds: AlertKind[] }
export interface ApprovalLevelConfig { level: number; role: Role; action: ReleaseLevelAction; label: string }
export interface ApprovalLevelsConfig {
  levels: ApprovalLevelConfig[];
  extraApprovalAbove?: string | null;
  extraLevel?: { role: Role; action: ReleaseLevelAction; label: string } | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  institutionId: string | null;
  institutionName: string | null;
  designation: string | null;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface AuditEvent {
  id: number;
  createdAt: string;
  actorId: string | null;
  actorLabel: string;
  action: string;
  label: string;
  entityType: string;
  entityId: string;
  instrumentId: string | null;
  referenceNo: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditPage { items: AuditEvent[]; total: number; page: number; pageSize: number }

export interface IntegrityResult { ok: boolean; checked: number; firstBrokenId: number | null; verifiedAt: string }

export interface DocumentAccessRow {
  id: number;
  createdAt: string;
  actorId: string | null;
  actorLabel: string;
  documentId: string;
  instrumentId: string | null;
  referenceNo: string | null;
  filename: string | null;
  docType: DocType | null;
  mode: 'download' | 'preview' | null;
  role: Role | null;
}

// ---- Phase 9: demo tools (DEMO_MODE only) ----

export interface DemoResetResult { d0: string; instruments: number; events: number; alerts: number; durationMs: number }

export interface BankRecordView {
  bank: string; referenceNo: string; amount: string; issueDate: string; maturityDate: string;
  beneficiaryName: string; lienMarked: boolean; status: string;
}

export interface DemoAnchor {
  code: string;
  reference: string;
  bank: string;
  purpose: string;
  signInAs: string;
  signInAsName: string | null;
  instrumentId: string | null;
  status: InstrumentStatus | null;
  verificationState: VerificationState | null;
  maturityDate: string | null;
  /** A1: the bank's record to type in step 1; A4: the replacement's record for step 6. */
  bankRecord: BankRecordView | null;
}

export interface BankCorrectionInput {
  bank: string;
  referenceNo: string;
  fields: { amount?: string; issueDate?: string; maturityDate?: string; beneficiaryName?: string; lienMarked?: boolean };
}

export interface BankCorrectionResult { before: BankRecordView; after: BankRecordView; instrumentId: string | null }
