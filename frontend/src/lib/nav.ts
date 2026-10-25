import { Home, type LucideIcon } from 'lucide-react';

export type Role = 'institution' | 'officer' | 'approver' | 'admin' | 'auditor';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const common: NavItem[] = [{ to: '/', label: 'Home', icon: Home }];

/** Sidebar entries per role; later phases add their pages here. */
export const NAV: Record<Role | 'anonymous', NavItem[]> = {
  anonymous: common,
  institution: common,
  officer: common,
  approver: common,
  admin: common,
  auditor: common,
};
