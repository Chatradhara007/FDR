import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ROLES } from '@fdr/shared';
import { config } from '../config';
import type { AuthUser } from '../domain/access';
import { Unauthorized } from '../domain/errors';
import { loadSessionUser } from '../services/authService';

export type { AuthUser } from '../domain/access';
export type { Role } from '@fdr/shared';
export { signToken } from '../domain/token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Verifies the bearer token, then loads the user: deactivated or deleted users are rejected immediately. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return next(new Unauthorized());
  let sub: string;
  try {
    const payload = jwt.verify(match[1], config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || !UUID.test(payload.sub) || !(ROLES as readonly string[]).includes(payload.role)) {
      throw new Error('bad claims');
    }
    sub = payload.sub;
  } catch {
    return next(new Unauthorized('Invalid or expired session'));
  }
  loadSessionUser(sub)
    .then((user) => {
      if (!user) return next(new Unauthorized('Invalid or expired session'));
      req.user = user;
      next();
    })
    .catch(next);
};
