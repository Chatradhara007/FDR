import { Bell, Building2, ClipboardCheck, Gavel, ListChecks, Mail, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { Role } from '@fdr/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const ALERTS: NavItem = { to: '/alerts', label: 'Alerts', icon: Bell };

/** Sidebar entries per role. Only pages that exist are listed; later phases add theirs here. */
export const NAV: Record<Role, NavItem[]> = {
  institution: [{ to: '/institution', label: 'My institution', icon: Building2 }, ALERTS],
  officer: [
    { to: '/officer', label: 'Scrutiny desk', icon: ClipboardCheck },
    { to: '/officer/queue', label: 'Scrutiny queue', icon: ListChecks },
    ALERTS,
  ],
  approver: [{ to: '/approver', label: 'Approvals', icon: Gavel }, ALERTS],
  admin: [
    { to: '/admin', label: 'Administration', icon: Settings },
    ALERTS,
    { to: '/admin/outbox', label: 'Outbox', icon: Mail },
  ],
  auditor: [{ to: '/auditor', label: 'Audit', icon: ShieldCheck }, ALERTS],
};
