import { Building2, ClipboardCheck, Gavel, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { Role } from '@fdr/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Sidebar entries per role. Only pages that exist are listed; later phases add theirs here. */
export const NAV: Record<Role, NavItem[]> = {
  institution: [{ to: '/institution', label: 'My institution', icon: Building2 }],
  officer: [{ to: '/officer', label: 'Scrutiny desk', icon: ClipboardCheck }],
  approver: [{ to: '/approver', label: 'Approvals', icon: Gavel }],
  admin: [{ to: '/admin', label: 'Administration', icon: Settings }],
  auditor: [{ to: '/auditor', label: 'Audit', icon: ShieldCheck }],
};
