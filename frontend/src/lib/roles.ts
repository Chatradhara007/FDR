import type { Role } from '@fdr/shared';

/** Where each role lands (UI v3: the approver lands on "Awaiting your decision"; admin and auditor on the dashboard). */
export const ROLE_HOME: Record<Role, string> = {
  institution: '/institution',
  officer: '/officer',
  approver: '/approver',
  admin: '/dashboard',
  auditor: '/dashboard',
};
