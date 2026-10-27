import type { Role } from '@fdr/shared';

export interface NavItem {
  to: string;
  label: string;
  /** Listed only while the server runs in DEMO_MODE (D17). */
  demoOnly?: boolean;
}

/** A top-level menu entry: a single link, or a dropdown group of links. */
export type MenuEntry = { kind: 'link'; item: NavItem } | { kind: 'group'; label: string; items: NavItem[] };

const ALERTS: NavItem = { to: '/alerts', label: 'Alerts' };
const RELEASES: NavItem = { to: '/officer/releases', label: 'Releases' };
const DASHBOARD: NavItem = { to: '/dashboard', label: 'Dashboard' };
const AUDIT: NavItem = { to: '/audit', label: 'Audit log' };
const RULES: NavItem = { to: '/admin/rules', label: 'Rules' };
const OUTBOX: NavItem = { to: '/admin/outbox', label: 'Outbox' };
const USERS: NavItem = { to: '/admin/users', label: 'Users' };
const DEMO: NavItem = { to: '/admin/demo', label: 'Demo tools', demoOnly: true };
/** Registers and reports (Phase 7), for every internal role. */
const RECORDS: NavItem[] = [
  { to: '/register', label: 'Register' },
  { to: '/institutions', label: 'Institutions' },
  { to: '/reports', label: 'Reports' },
];

const link = (item: NavItem): MenuEntry => ({ kind: 'link', item });
const group = (label: string, items: NavItem[]): MenuEntry => ({ kind: 'group', label, items });

const HOME = (to: string, label = 'Home'): MenuEntry => link({ to, label });

/** Header nav pills per role (Mission Desk: a few pills, the rest in small dropdowns). Only pages that exist are listed. */
export const MENU: Record<Role, MenuEntry[]> = {
  institution: [HOME('/institution'), link(ALERTS), link({ to: '/help/faq', label: 'Help' })],
  officer: [
    HOME('/officer', 'My day'),
    link({ to: '/officer/queue', label: 'Scrutiny queue' }),
    link(RELEASES),
    group('Records', RECORDS),
    group('Monitoring', [ALERTS, DASHBOARD]),
  ],
  approver: [
    HOME('/approver', 'Awaiting decision'),
    link(DASHBOARD),
    link({ ...RELEASES, label: 'All releases' }),
    group('Records', RECORDS),
    group('Monitoring', [ALERTS]),
  ],
  admin: [
    HOME('/admin'),
    link(DASHBOARD),
    link(RELEASES),
    group('Records', RECORDS),
    group('Monitoring', [ALERTS, OUTBOX, AUDIT]),
    group('Administration', [RULES, USERS, DEMO]),
  ],
  /** Read-only: audit log and reports first (§8.6); rules and releases to look at, never to change. */
  auditor: [
    HOME('/auditor'),
    link(DASHBOARD),
    link(AUDIT),
    group('Records', RECORDS),
    group('Monitoring', [RELEASES, ALERTS]),
    group('Administration', [{ ...RULES, label: 'Rules (read-only)' }]),
  ],
};

/** The menu for a role with demo-only items dropped outside demo mode and empty groups removed. */
export function menuFor(role: Role, demoMode: boolean): MenuEntry[] {
  const keep = (i: NavItem) => !i.demoOnly || demoMode;
  return MENU[role].flatMap((e): MenuEntry[] => {
    if (e.kind === 'link') return keep(e.item) ? [e] : [];
    const items = e.items.filter(keep);
    return items.length ? [{ ...e, items }] : [];
  });
}

/** Every link of a menu, flat (command palette). */
export function menuLinks(entries: MenuEntry[]): (NavItem & { group?: string })[] {
  return entries.flatMap((e) => (e.kind === 'link' ? [e.item] : e.items.map((i) => ({ ...i, group: e.label }))));
}
