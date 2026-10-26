import type { Role } from '@fdr/shared';

/** Where each role lands. The dashboard is home for the approver, admin and auditor (Phase 7). */
export const ROLE_HOME: Record<Role, string> = {
  institution: '/institution',
  officer: '/officer',
  approver: '/dashboard',
  admin: '/dashboard',
  auditor: '/dashboard',
};
