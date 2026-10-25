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
  constructor(message = 'Authentication required', details: ErrorDetails = null) {
    super('UNAUTHORIZED', message, details, 401);
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

export interface FieldIssue {
  field: string;
  message: string;
}

export class ValidationFailed extends AppError {
  constructor(details: FieldIssue[], message = 'Validation failed') {
    super('VALIDATION_FAILED', message, details, 422);
  }
}

export class InvalidTransition extends AppError {
  constructor(from: string, to: string, message?: string) {
    super('INVALID_TRANSITION', message ?? `Cannot move from ${from} to ${to}`, { from, to }, 409);
  }
}
