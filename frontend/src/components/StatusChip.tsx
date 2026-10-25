import {
  Archive, CheckCircle2, CircleDashed, Clock, FileClock, Hourglass, PackageCheck, RefreshCw, Search, Send, Undo2, XCircle,
  type LucideIcon,
} from 'lucide-react';
import { STATUS_LABELS, type InstrumentStatus } from '@fdr/shared';
import { Badge, type Tone } from './Badge';

export type { InstrumentStatus } from '@fdr/shared';

const STATUS: Record<InstrumentStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  DRAFT: { label: STATUS_LABELS.DRAFT, tone: 'neutral', icon: CircleDashed },
  SUBMITTED: { label: STATUS_LABELS.SUBMITTED, tone: 'info', icon: Send },
  UNDER_SCRUTINY: { label: STATUS_LABELS.UNDER_SCRUTINY, tone: 'info', icon: Search },
  RETURNED: { label: STATUS_LABELS.RETURNED, tone: 'warning', icon: Undo2 },
  ACTIVE: { label: STATUS_LABELS.ACTIVE, tone: 'success', icon: CheckCircle2 },
  EXPIRING: { label: STATUS_LABELS.EXPIRING, tone: 'warning', icon: Hourglass },
  MATURED: { label: STATUS_LABELS.MATURED, tone: 'warning', icon: Clock },
  RENEWED: { label: STATUS_LABELS.RENEWED, tone: 'neutral', icon: RefreshCw },
  LAPSED: { label: STATUS_LABELS.LAPSED, tone: 'danger', icon: XCircle },
  RELEASE_REQUESTED: { label: STATUS_LABELS.RELEASE_REQUESTED, tone: 'info', icon: FileClock },
  RELEASED: { label: STATUS_LABELS.RELEASED, tone: 'neutral', icon: PackageCheck },
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
