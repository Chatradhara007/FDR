import {
  Bell, Building2, FlaskConical, FileSpreadsheet, Gauge, Gavel, HandCoins, Landmark, LayoutDashboard, ListChecks, Mail, ScrollText, Settings, ShieldCheck,
  Table2, Users, type LucideIcon,
} from 'lucide-react';
import type { Role } from '@fdr/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Listed only while the server runs in DEMO_MODE (D17). */
  demoOnly?: boolean;
}

const ALERTS: NavItem = { to: '/alerts', label: 'Alerts', icon: Bell };
const RELEASES: NavItem = { to: '/officer/releases', label: 'Releases', icon: HandCoins };
const DASHBOARD: NavItem = { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard };
const AUDIT: NavItem = { to: '/audit', label: 'Audit log', icon: ShieldCheck };
const RULES: NavItem = { to: '/admin/rules', label: 'Rules', icon: Settings };
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
    RULES,
    { to: '/admin/users', label: 'Users', icon: Users },
    RELEASES,
    ALERTS,
    { to: '/admin/outbox', label: 'Outbox', icon: Mail },
    AUDIT,
    ...OVERSIGHT,
    { to: '/admin/demo', label: 'Demo tools', icon: FlaskConical, demoOnly: true },
  ],
  /** Read-only: dashboard, audit log and reports first (§8.6); rules and releases to look at, never to change. */
  auditor: [DASHBOARD, AUDIT, ...OVERSIGHT, { ...RULES, icon: ScrollText }, RELEASES, ALERTS],
};
