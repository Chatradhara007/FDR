import type { Role } from '@fdr/shared';

/** Where each role lands: a work queue, not a dashboard (UI direction v4). */
export const ROLE_HOME: Record<Role, string> = {
  institution: '/institution',
  officer: '/officer',
  approver: '/approver',
  admin: '/admin',
  auditor: '/auditor',
};

/** Name of each role's home, for "← Back to …" links. */
export const ROLE_HOME_LABEL: Record<Role, string> = {
  institution: 'Home',
  officer: 'My day',
  approver: 'Awaiting decision',
  admin: 'Home',
  auditor: 'Home',
};
