import {
  Bell, Building2, FileSpreadsheet, Gauge, Gavel, HandCoins, Landmark, LayoutDashboard, ListChecks, Mail, Settings, ShieldCheck,
  Table2, type LucideIcon,
} from 'lucide-react';
import type { Role } from '@fdr/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const ALERTS: NavItem = { to: '/alerts', label: 'Alerts', icon: Bell };
const RELEASES: NavItem = { to: '/officer/releases', label: 'Releases', icon: HandCoins };
const DASHBOARD: NavItem = { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard };
/** Registers and reports (Phase 7), for every internal role. */
const OVERSIGHT: NavItem[] = [
  { to: '/register', label: 'Register', icon: Table2 },
  { to: '/institutions', label: 'Institutions', icon: Landmark },
  { to: '/reports', label: 'Reports', icon: FileSpreadsheet },
];

/** Sidebar entries per role. Only pages that exist are listed; later phases add theirs here. */
export const NAV: Record<Role, NavItem[]> = {
  institution: [{ to: '/institution', label: 'My institution', icon: Building2 }, ALERTS],
  officer: [
    { to: '/officer', label: 'My day', icon: Gauge },
    { to: '/officer/queue', label: 'Scrutiny queue', icon: ListChecks },
    RELEASES,
    ALERTS,
    DASHBOARD,
    ...OVERSIGHT,
  ],
  approver: [DASHBOARD, { to: '/approver', label: 'Approvals', icon: Gavel }, { ...RELEASES, label: 'All releases' }, ALERTS, ...OVERSIGHT],
  admin: [
    DASHBOARD,
    { to: '/admin', label: 'Administration', icon: Settings },
    RELEASES,
    ALERTS,
    { to: '/admin/outbox', label: 'Outbox', icon: Mail },
    ...OVERSIGHT,
  ],
  auditor: [DASHBOARD, { to: '/auditor', label: 'Audit', icon: ShieldCheck }, RELEASES, ALERTS, ...OVERSIGHT],
};
