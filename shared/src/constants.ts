// Domain constants for the UI. Values come from shared/constants.json (the single source the Python
// backend also reads); literal types come from the generated constants.gen.ts.
import c from '../constants.json';
import type {
  AlertKind, AlertResolution, AlertStatus, Bank, DocType, InstrumentStatus, InstrumentType, ObservationSeverity, ReleaseDecision, ReleaseLevelAction,
  ReleaseRequestStatus, Role, TrackedField, TrustTier, VerificationResult, VerificationState,
} from './constants.gen';

export type {
  AlertKind, AlertResolution, AlertStatus, Bank, DocType, InstrumentStatus, InstrumentType, ObservationSeverity, ReleaseDecision, ReleaseLevelAction,
  ReleaseRequestStatus, Role, TrackedField, TrustTier, VerificationResult, VerificationState,
} from './constants.gen';

export const ROLES = c.roles as readonly Role[];
export const ROLE_LABELS = c.roleLabels as Record<Role, string>;

export const INSTRUMENT_TYPES = c.instrumentTypes as readonly InstrumentType[];
export const INSTRUMENT_TYPE_LABELS = c.instrumentTypeLabels as Record<InstrumentType, string>;

export const INSTRUMENT_STATUSES = c.instrumentStatuses as readonly InstrumentStatus[];
export const STATUS_LABELS = c.statusLabels as Record<InstrumentStatus, string>;
export const ALLOWED = c.allowedTransitions as Record<InstrumentStatus, readonly InstrumentStatus[]>;
export const LIVE_STATUSES = c.liveStatuses as readonly InstrumentStatus[];
export const TERMINAL_STATUSES = c.terminalStatuses as readonly InstrumentStatus[];
export const RENEWABLE_STATUSES = c.renewableStatuses as readonly InstrumentStatus[];
export const RELEASABLE_STATUSES = c.releasableStatuses as readonly InstrumentStatus[];
export const VERIFIABLE_STATUSES = c.verifiableStatuses as readonly InstrumentStatus[];

export const TRUST_TIERS = c.trustTiers as readonly TrustTier[];
export const TRUST_TIER_LABELS = c.trustTierLabels as Record<TrustTier, string>;

export const VERIFICATION_STATES = c.verificationStates as readonly VerificationState[];
export const VERIFICATION_STATE_LABELS = c.verificationStateLabels as Record<VerificationState, string>;
export const VERIFICATION_RESULT_LABELS = c.verificationResultLabels as Record<VerificationResult, string>;

export const OBSERVATION_SEVERITIES = c.observationSeverities as readonly ObservationSeverity[];
export const OBSERVATION_SEVERITY_LABELS = c.observationSeverityLabels as Record<ObservationSeverity, string>;

export const DOC_TYPES = c.docTypes as readonly DocType[];
export const DOC_TYPE_LABELS = c.docTypeLabels as Record<DocType, string>;
export const RELEASE_DOC_TYPES = c.releaseDocTypes as readonly DocType[];

export const TRACKED_FIELDS = c.trackedFields as readonly TrackedField[];
export const FIELD_LABELS = c.fieldLabels as Record<TrackedField, string>;
export const TRACKED_FIELD_KEYS = c.trackedFieldKeys as Record<TrackedField, string>;
export const DISCREPANCY_REASONS = c.discrepancyReasons as Record<TrackedField, string>;

export const BANKS = c.banks as readonly Bank[];

export const ALERT_KINDS = c.alertKinds as readonly AlertKind[];
export const ALERT_KIND_LABELS = c.alertKindLabels as Record<AlertKind, string>;
export const ALERT_STATUSES = c.alertStatuses as readonly AlertStatus[];
export const ALERT_STATUS_LABELS = c.alertStatusLabels as Record<AlertStatus, string>;
export const ALERT_RESOLUTION_LABELS = c.alertResolutionLabels as Record<AlertResolution, string>;

export const RELEASE_REQUEST_STATUSES = c.releaseRequestStatuses as readonly ReleaseRequestStatus[];
export const RELEASE_REQUEST_STATUS_LABELS = c.releaseRequestStatusLabels as Record<ReleaseRequestStatus, string>;
export const OPEN_RELEASE_REQUEST_STATUSES = c.openReleaseRequestStatuses as readonly ReleaseRequestStatus[];
export const RELEASE_DECISION_LABELS = c.releaseDecisionLabels as Record<ReleaseDecision, string>;

export const EVENT_LABELS = c.eventLabels as Record<string, string>;
export const INSTITUTION_VISIBLE_ACTIONS = c.institutionVisibleActions as readonly string[];

export function eventLabel(action: string): string {
  return EVENT_LABELS[action] ?? action;
}

export interface DashboardStatusGroup { key: string; label: string; statuses: readonly InstrumentStatus[] }
export const DASHBOARD_STATUS_GROUPS = c.dashboardStatusGroups as readonly DashboardStatusGroup[];
export const REPORT_PRESETS = c.reportPresets as Record<string, string>;
/** D26: every improvement figure carries this label. */
export const SIMULATED_LABEL: string = c.simulatedLabel;
