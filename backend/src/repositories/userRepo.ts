import type { Role } from '@fdr/shared';
import { exec, many, maybeOne, type Db } from '../db/pool';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  institution_id: string | null;
  institution_name: string | null;
  designation: string | null;
  active: boolean;
}

const SELECT_USER = `
  SELECT u.id, u.name, u.email, u.password_hash, u.role, u.institution_id, i.name AS institution_name,
         u.designation, u.active
    FROM users u LEFT JOIN institutions i ON i.id = u.institution_id`;

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  return maybeOne<UserRow>(db, `${SELECT_USER} WHERE lower(u.email) = lower($1)`, [email]);
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  return maybeOne<UserRow>(db, `${SELECT_USER} WHERE u.id = $1`, [id]);
}

export async function listUsersByEmails(db: Db, emails: readonly string[]): Promise<UserRow[]> {
  return many<UserRow>(db, `${SELECT_USER} WHERE u.email = ANY($1::text[]) AND u.active`, [emails]);
}

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  institutionId: string | null;
  designation: string | null;
  createdAt: Date;
}

/** Inserts unless the email exists; returns whether a row was created. */
export async function insertUserIfMissing(db: Db, u: NewUser): Promise<boolean> {
  const n = await exec(
    db,
    `INSERT INTO users (name, email, password_hash, role, institution_id, designation, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email) DO NOTHING`,
    [u.name, u.email, u.passwordHash, u.role, u.institutionId, u.designation, u.createdAt],
  );
  return n > 0;
}
