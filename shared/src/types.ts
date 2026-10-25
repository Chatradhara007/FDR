import type { InstrumentStatus, InstrumentType, Role, VerificationState } from './enums';

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
