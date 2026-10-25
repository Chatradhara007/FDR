import bcrypt from 'bcryptjs';
import { RULE_DEFAULTS, type Role } from '@fdr/shared';
import type { Db } from '../db/pool';
import * as clock from '../domain/clock';
import { upsertInstitution } from '../repositories/institutionRepo';
import { insertRuleIfMissing } from '../repositories/ruleRepo';
import { insertUserIfMissing } from '../repositories/userRepo';

// Base dataset: institutions, demo users and default rules. Idempotent. Phase 9 layers the demo
// instruments on top (docs/seed-spec.md).

export const DEMO_PASSWORD = 'Demo@123';

const INSTITUTIONS = [
  {
    key: 'inst1',
    aicte_id: '1-1234567890',
    name: 'Vasavi College of Engineering, Hyderabad',
    region: 'South-Central',
    state: 'Telangana',
    contact_email: 'principal@vasavi.demo.in',
  },
  {
    key: 'inst2',
    aicte_id: '1-2345678901',
    name: 'Sri Venkateswara Institute of Technology, Tirupati',
    region: 'Southern',
    state: 'Andhra Pradesh',
    contact_email: 'principal@svit.demo.in',
  },
] as const;

const USERS: { email: string; name: string; role: Role; institution?: 'inst1' | 'inst2'; designation: string }[] = [
  { email: 'inst1@demo.in', name: 'Dr. K. Ramakrishna Rao', role: 'institution', institution: 'inst1', designation: 'Principal, Vasavi College of Engineering' },
  { email: 'inst2@demo.in', name: 'Dr. P. Lakshmi Narayana', role: 'institution', institution: 'inst2', designation: 'Director, Sri Venkateswara Institute of Technology' },
  { email: 'officer@demo.in', name: 'Anjali Deshmukh', role: 'officer', designation: 'Scrutiny Officer, South-Central Region' },
  { email: 'officer2@demo.in', name: 'Rahul Menon', role: 'officer', designation: 'Scrutiny Officer, Southern Region' },
  { email: 'approver@demo.in', name: 'Dr. S. Venkatesh', role: 'approver', designation: 'Deputy Director (Finance), AICTE' },
  { email: 'admin@demo.in', name: 'Meera Iyer', role: 'admin', designation: 'System Administrator, AICTE' },
  { email: 'auditor@demo.in', name: 'Arvind Kulkarni', role: 'auditor', designation: 'Internal Auditor, AICTE' },
];

export const DEMO_USER_EMAILS: readonly string[] = USERS.map((u) => u.email);

let hashPromise: Promise<string> | null = null;

export async function seedBase(db: Db): Promise<void> {
  hashPromise ??= bcrypt.hash(DEMO_PASSWORD, 10);
  const passwordHash = await hashPromise;
  const createdAt = await clock.now(db);

  const institutionIds: Record<string, string> = {};
  for (const { key, ...inst } of INSTITUTIONS) {
    institutionIds[key] = (await upsertInstitution(db, inst)).id;
  }
  for (const u of USERS) {
    await insertUserIfMissing(db, {
      name: u.name,
      email: u.email,
      passwordHash,
      role: u.role,
      institutionId: u.institution ? institutionIds[u.institution] : null,
      designation: u.designation,
      createdAt,
    });
  }
  for (const rule of RULE_DEFAULTS) await insertRuleIfMissing(db, rule);
}
