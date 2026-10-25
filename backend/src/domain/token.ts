import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { AuthUser } from './access';

// JWT expiry uses wall time by design (CLAUDE.md rule 2 exception).
export function signToken(
  user: Pick<AuthUser, 'id' | 'role' | 'institutionId'>,
  expiresIn: jwt.SignOptions['expiresIn'] = '8h',
): string {
  return jwt.sign({ role: user.role, institutionId: user.institutionId }, config.jwtSecret, {
    subject: user.id,
    expiresIn,
  });
}
