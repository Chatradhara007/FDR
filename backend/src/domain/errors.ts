import type { FieldIssue, SubmitErrorDetails } from '@fdr/shared';

export type ErrorDetails = unknown;

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: ErrorDetails = null,
    public readonly httpStatus = 500,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFound extends AppError {
  constructor(message = 'Not found', details: ErrorDetails = null) {
    super('NOT_FOUND', message, details, 404);
  }
}

export class Unauthorized extends AppError {
  constructor(message = 'Authentication required', details: ErrorDetails = null, code = 'UNAUTHORIZED') {
    super(code, message, details, 401);
  }
}

export class Forbidden extends AppError {
  constructor(message = 'Not allowed', details: ErrorDetails = null) {
    super('FORBIDDEN', message, details, 403);
  }
}

export class Conflict extends AppError {
  constructor(message: string, details: ErrorDetails = null, code = 'CONFLICT') {
    super(code, message, details, 409);
  }
}

export type { FieldIssue } from '@fdr/shared';

/** 422. Details are the failing fields, or (submit) `{ fields, missingDocuments }`. */
export class ValidationFailed extends AppError {
  constructor(details: FieldIssue[] | SubmitErrorDetails, message = 'Validation failed') {
    super('VALIDATION_FAILED', message, details, 422);
  }
}

export class InvalidTransition extends AppError {
  constructor(from: string, to: string, message?: string) {
    super('INVALID_TRANSITION', message ?? `Cannot move from ${from} to ${to}`, { from, to }, 409);
  }
}

export class TooManyRequests extends AppError {
  constructor(message: string) {
    super('RATE_LIMITED', message, null, 429);
  }
}

/** 409 for an action the record's current state does not allow (other than a status transition). */
export class InvalidState extends Conflict {
  constructor(message: string, details: ErrorDetails = null) {
    super(message, details, 'INVALID_STATE');
  }
}
