import type { Role } from '@fdr/shared';

export const ROLE_HOME: Record<Role, string> = {
  institution: '/institution',
  officer: '/officer',
  approver: '/approver',
  admin: '/admin',
  auditor: '/auditor',
};
