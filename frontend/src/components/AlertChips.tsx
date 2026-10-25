import { AlertOctagon, CalendarClock, FileClock, FileWarning, RefreshCcw, ShieldAlert, Siren, type LucideIcon } from 'lucide-react';
import { ALERT_KIND_LABELS, ROLE_LABELS, type AlertKind, type Role } from '@fdr/shared';
import { Badge, type Tone } from './Badge';

const KIND: Record<AlertKind, { icon: LucideIcon; tone: Tone }> = {
  MATURITY_REMINDER: { icon: CalendarClock, tone: 'warning' },
  PENDING_VERIFICATION: { icon: FileClock, tone: 'info' },
  DISCREPANCY_OPEN: { icon: FileWarning, tone: 'danger' },
  OVERDUE_RENEWAL: { icon: RefreshCcw, tone: 'danger' },
  RELEASE_PENDING: { icon: ShieldAlert, tone: 'info' },
};

export function AlertKindChip({ kind }: { kind: AlertKind }) {
  const k = KIND[kind];
  const Icon = k.icon;
  return <Badge tone={k.tone} icon={<Icon className="size-3.5" aria-hidden />}>{ALERT_KIND_LABELS[kind]}</Badge>;
}

/** Escalation level: L1 is the original recipient; higher levels say who it was escalated to. */
export function AlertLevelChip({ level, role }: { level: number; role?: Role }) {
  if (level <= 1) {
    return <Badge tone="neutral" icon={<Siren className="size-3.5" aria-hidden />}>L1</Badge>;
  }
  const to = role ? ROLE_LABELS[role].toLowerCase() : level === 2 ? 'approver' : 'administrator';
  return (
    <Badge tone={level >= 3 ? 'danger' : 'warning'} icon={<AlertOctagon className="size-3.5" aria-hidden />}>
      L{level} · Escalated to {to}
    </Badge>
  );
}

/** Table cell: worst open alert level on an instrument, with the count. */
export function WorstAlertChip({ level, count }: { level: number | null; count: number }) {
  if (!level || !count) return <span className="text-slate-400">—</span>;
  const tone: Tone = level >= 3 ? 'danger' : level === 2 ? 'warning' : 'neutral';
  const Icon = level >= 2 ? AlertOctagon : Siren;
  return (
    <Badge tone={tone} icon={<Icon className="size-3.5" aria-hidden />}>
      <span data-testid="worst-alert">L{level}</span>
      <span className="font-normal">· {count} open</span>
    </Badge>
  );
}
