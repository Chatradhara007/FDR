import type { RequestHandler } from 'express';
import { Forbidden, Unauthorized } from '../domain/errors';
import type { Role } from './authenticate';

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new Unauthorized());
    if (!roles.includes(req.user.role)) return next(new Forbidden());
    next();
  };
}
