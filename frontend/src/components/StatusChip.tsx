import {
  Archive, CheckCircle2, CircleDashed, Clock, FileClock, Hourglass, PackageCheck, RefreshCw, Search, Send, Undo2, XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type Tone } from './Badge';

// Moves to the shared InstrumentStatus enum in Phase 1.
export type InstrumentStatus =
  | 'DRAFT' | 'SUBMITTED' | 'UNDER_SCRUTINY' | 'RETURNED' | 'ACTIVE' | 'EXPIRING'
  | 'MATURED' | 'RENEWED' | 'LAPSED' | 'RELEASE_REQUESTED' | 'RELEASED';

const STATUS: Record<InstrumentStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  SUBMITTED: { label: 'Submitted', tone: 'info', icon: Send },
  UNDER_SCRUTINY: { label: 'Under scrutiny', tone: 'info', icon: Search },
  RETURNED: { label: 'Returned', tone: 'warning', icon: Undo2 },
  ACTIVE: { label: 'Active', tone: 'success', icon: CheckCircle2 },
  EXPIRING: { label: 'Expiring', tone: 'warning', icon: Hourglass },
  MATURED: { label: 'Matured', tone: 'warning', icon: Clock },
  RENEWED: { label: 'Renewed', tone: 'neutral', icon: RefreshCw },
  LAPSED: { label: 'Lapsed', tone: 'danger', icon: XCircle },
  RELEASE_REQUESTED: { label: 'Release requested', tone: 'info', icon: FileClock },
  RELEASED: { label: 'Released', tone: 'neutral', icon: PackageCheck },
};

export function StatusChip({ status }: { status: InstrumentStatus }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as Tone, icon: Archive };
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} icon={<Icon className="size-3.5" aria-hidden />}>
      {s.label}
    </Badge>
  );
}
