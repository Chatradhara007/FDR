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

/** Menu bar per role. Only pages that exist are listed. */
export const MENU: Record<Role, MenuEntry[]> = {
  institution: [link({ to: '/institution', label: 'My institution' }), link(ALERTS)],
  officer: [
    link({ to: '/officer', label: 'My day' }),
    link({ to: '/officer/queue', label: 'Scrutiny queue' }),
    link(RELEASES),
    link(DASHBOARD),
    group('Records', RECORDS),
    group('Monitoring', [ALERTS]),
  ],
  approver: [
    link(DASHBOARD),
    link({ to: '/approver', label: 'Approvals' }),
    link({ ...RELEASES, label: 'All releases' }),
    group('Records', RECORDS),
    group('Monitoring', [ALERTS]),
  ],
  admin: [
    link(DASHBOARD),
    link(RELEASES),
    group('Records', RECORDS),
    group('Monitoring', [ALERTS, OUTBOX, AUDIT]),
    group('Administration', [RULES, USERS, DEMO]),
  ],
  /** Read-only: dashboard, audit log and reports first (§8.6); rules and releases to look at, never to change. */
  auditor: [
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

/** Breadcrumb labels for known paths; detail pages fall back to their section label. */
export const CRUMBS: { match: RegExp; trail: string[] }[] = [
  { match: /^\/dashboard$/, trail: ['Dashboard'] },
  { match: /^\/officer$/, trail: ['My day'] },
  { match: /^\/officer\/queue$/, trail: ['Scrutiny', 'Scrutiny queue'] },
  { match: /^\/officer\/review\//, trail: ['Scrutiny', 'Scrutiny queue', 'Review'] },
  { match: /^\/officer\/releases$/, trail: ['Releases'] },
  { match: /^\/(officer|approver)\/releases\//, trail: ['Releases', 'Release request'] },
  { match: /^\/releases\/.+\/order$/, trail: ['Releases', 'Release order'] },
  { match: /^\/approver$/, trail: ['Approvals'] },
  { match: /^\/register$/, trail: ['Records', 'Register'] },
  { match: /^\/institutions$/, trail: ['Records', 'Institutions'] },
  { match: /^\/institutions\//, trail: ['Records', 'Institutions', 'Profile'] },
  { match: /^\/reports$/, trail: ['Records', 'Reports'] },
  { match: /^\/reports\/improvement$/, trail: ['Records', 'Reports', 'Improvement'] },
  { match: /^\/alerts$/, trail: ['Monitoring', 'Alerts'] },
  { match: /^\/admin\/outbox$/, trail: ['Monitoring', 'Outbox'] },
  { match: /^\/audit$/, trail: ['Monitoring', 'Audit log'] },
  { match: /^\/admin\/rules$/, trail: ['Administration', 'Rules'] },
  { match: /^\/admin\/users$/, trail: ['Administration', 'Users'] },
  { match: /^\/admin\/demo$/, trail: ['Administration', 'Demo tools'] },
  { match: /^\/institution$/, trail: ['My institution'] },
  { match: /^\/institution\/instruments\/new$/, trail: ['My institution', 'New instrument'] },
  { match: /^\/institution\/instruments\/.+\/edit$/, trail: ['My institution', 'Edit instrument'] },
  { match: /^\/instruments\//, trail: ['Instrument', 'Passport'] },
  { match: /^\/verify\//, trail: ['Release order check'] },
  { match: /^\/login$/, trail: ['Sign in'] },
  { match: /^\/help\/faq$/, trail: ['Help', 'FAQ'] },
  { match: /^\/help\/contact$/, trail: ['Help', 'Contact helpdesk'] },
  { match: /^\/policies\/terms$/, trail: ['Policies', 'Terms of use'] },
  { match: /^\/policies\/privacy$/, trail: ['Policies', 'Privacy policy'] },
  { match: /^\/policies\/accessibility$/, trail: ['Policies', 'Accessibility statement'] },
  { match: /^\/policies\/disclaimer$/, trail: ['Policies', 'Disclaimer'] },
];

export function crumbsFor(path: string): string[] {
  return CRUMBS.find((c) => c.match.test(path))?.trail ?? [];
}
