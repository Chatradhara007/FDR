import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFound, ValidationFailed } from '../domain/errors';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFound(`No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Malformed JSON from express.json() is a client input error.
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    err = new ValidationFailed([{ field: 'body', message: 'Malformed JSON' }]);
  }
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ code: err.code, message: err.message, details: err.details ?? null });
    return;
  }
  console.error(`[${req.requestId}] unhandled error on ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ code: 'INTERNAL', message: 'Unexpected error', details: { requestId: req.requestId } });
};
