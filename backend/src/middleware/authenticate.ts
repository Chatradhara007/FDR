import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { Unauthorized } from '../domain/errors';

export type Role = 'institution' | 'officer' | 'approver' | 'admin' | 'auditor';
const ROLES: readonly string[] = ['institution', 'officer', 'approver', 'admin', 'auditor'];

export interface AuthUser {
  id: string;
  role: Role;
  institutionId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser, expiresIn: jwt.SignOptions['expiresIn'] = '8h'): string {
  return jwt.sign({ role: user.role, institutionId: user.institutionId }, config.jwtSecret, {
    subject: user.id,
    expiresIn,
  });
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return next(new Unauthorized());
  try {
    const payload = jwt.verify(match[1], config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || !ROLES.includes(payload.role)) throw new Error('bad claims');
    req.user = {
      id: payload.sub,
      role: payload.role as Role,
      institutionId: typeof payload.institutionId === 'string' ? payload.institutionId : null,
    };
    next();
  } catch {
    next(new Unauthorized('Invalid or expired session'));
  }
};
