import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationFailed, type FieldIssue } from '../domain/errors';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Validates and replaces req.body / req.query / req.params; lists every failing field. */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const issues: FieldIssue[] = [];
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) {
        // req.query is a getter in some Express setups; define it explicitly.
        Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true });
      } else {
        for (const issue of result.error.issues) {
          const field = issue.path.length ? issue.path.join('.') : part;
          issues.push({ field: part === 'body' ? field : `${part}.${field}`, message: issue.message });
        }
      }
    }
    if (issues.length) return next(new ValidationFailed(issues));
    next();
  };
}
