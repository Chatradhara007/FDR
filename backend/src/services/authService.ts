import bcrypt from 'bcryptjs';
import type { DemoUser, LoginResponse, SessionUser } from '@fdr/shared';
import { getPool } from '../db/pool';
import type { AuthUser } from '../domain/access';
import { Unauthorized } from '../domain/errors';
import { signToken } from '../domain/token';
import { findUserByEmail, findUserById, listUsersByEmails, type UserRow } from '../repositories/userRepo';
import { DEMO_USER_EMAILS } from '../seed/base';

const INVALID = 'Email or password is incorrect';
// Compared against when the email is unknown, so both failures take the same time.
let dummyHash: string | null = null;

function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    institutionId: u.institution_id,
    institutionName: u.institution_name,
    designation: u.designation,
  };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const user = await findUserByEmail(getPool(), email);
  dummyHash ??= await bcrypt.hash('not-a-real-password', 10);
  const ok = await bcrypt.compare(password, user?.password_hash ?? dummyHash);
  if (!user || !ok || !user.active) throw new Unauthorized(INVALID, null, 'INVALID_CREDENTIALS');
  const token = signToken({ id: user.id, role: user.role, institutionId: user.institution_id });
  return { token, user: toSessionUser(user) };
}

/** Loads the session user for authenticate(); null when missing or deactivated. */
export async function loadSessionUser(id: string): Promise<AuthUser | null> {
  const u = await findUserById(getPool(), id);
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, role: u.role, institutionId: u.institution_id };
}

export async function me(id: string): Promise<SessionUser> {
  const u = await findUserById(getPool(), id);
  if (!u || !u.active) throw new Unauthorized();
  return toSessionUser(u);
}

export async function listDemoUsers(): Promise<DemoUser[]> {
  const rows = await listUsersByEmails(getPool(), DEMO_USER_EMAILS);
  const order = new Map(DEMO_USER_EMAILS.map((e, i) => [e, i]));
  return rows
    .sort((a, b) => (order.get(a.email) ?? 0) - (order.get(b.email) ?? 0))
    .map((u) => ({ email: u.email, name: u.name, role: u.role, institutionName: u.institution_name }));
}
