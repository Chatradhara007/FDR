import type { Role } from '@fdr/shared';
import type { Actor } from './audit';
import { NotFound } from './errors';

/** The signed-in user, loaded from the DB by authenticate() on every request. */
export interface AuthUser {
  id: string;
  name: string;
  role: Role;
  institutionId: string | null;
}

export function actorOf(user: AuthUser): Actor {
  return { id: user.id, label: user.name };
}

/** Institution users may only see their own institution's records; others get 404, not 403 (rule 8). */
export function assertCanSee(user: AuthUser, record: { institutionId: string }, what = 'Instrument'): void {
  if (user.role === 'institution' && record.institutionId !== user.institutionId) {
    throw new NotFound(`${what} not found`);
  }
}

/**
 * SQL fragment restricting an instruments query to the user's institution (empty for AICTE roles).
 * Pushes the parameter onto `params`; use as `WHERE true${scopeInstrumentsQuery(user, params)}`.
 */
export function scopeInstrumentsQuery(user: AuthUser, params: unknown[], alias = 'i'): string {
  if (user.role !== 'institution') return '';
  params.push(user.institutionId);
  return ` AND ${alias}.institution_id = $${params.length}`;
}
