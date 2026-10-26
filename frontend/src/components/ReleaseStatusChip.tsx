import { Ban, CheckCircle2, Hourglass, ListChecks, PackageCheck, Undo2, XCircle, type LucideIcon } from 'lucide-react';
import { RELEASE_REQUEST_STATUS_LABELS, type ReleaseRequestStatus } from '@fdr/shared';
import { Badge, type Tone } from './Badge';

const STATUS: Record<ReleaseRequestStatus, { tone: Tone; icon: LucideIcon }> = {
  PENDING_CONDITIONS: { tone: 'info', icon: ListChecks },
  PENDING_APPROVAL: { tone: 'info', icon: Hourglass },
  APPROVED: { tone: 'success', icon: PackageCheck },
  REJECTED: { tone: 'danger', icon: XCircle },
  RETURNED: { tone: 'warning', icon: Undo2 },
  CANCELLED: { tone: 'neutral', icon: Ban },
};

export function ReleaseStatusChip({ status }: { status: ReleaseRequestStatus }) {
  const s = STATUS[status] ?? { tone: 'neutral' as Tone, icon: CheckCircle2 };
  const Icon = s.icon;
  return <Badge tone={s.tone} icon={<Icon className="size-3.5" aria-hidden />}>{RELEASE_REQUEST_STATUS_LABELS[status] ?? status}</Badge>;
}
