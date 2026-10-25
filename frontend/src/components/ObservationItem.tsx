import { CheckCircle2, Eye, EyeOff, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { OBSERVATION_SEVERITY_LABELS, type Observation, type ObservationSeverity } from '@fdr/shared';
import { Badge, type Tone } from './Badge';
import { Button } from './Button';
import { DateText } from './DateText';

const SEVERITY: Record<ObservationSeverity, { tone: Tone; icon: LucideIcon }> = {
  INFO: { tone: 'info', icon: Info },
  CONCERN: { tone: 'warning', icon: TriangleAlert },
  BLOCKING: { tone: 'danger', icon: OctagonAlert },
};

export function SeverityChip({ severity }: { severity: ObservationSeverity }) {
  const s = SEVERITY[severity];
  const Icon = s.icon;
  return <Badge tone={s.tone} icon={<Icon className="size-3.5" aria-hidden />}>{OBSERVATION_SEVERITY_LABELS[severity]}</Badge>;
}

export function ObservationItem({ o, onResolve }: { o: Observation; onResolve?: () => void }) {
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip severity={o.severity} />
        {o.status === 'RESOLVED' && <Badge tone="neutral" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>Resolved</Badge>}
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {o.visibleToInstitution ? <><Eye className="size-3.5" aria-hidden /> Visible to institution</> : <><EyeOff className="size-3.5" aria-hidden /> Internal</>}
        </span>
        <span className="ml-auto text-xs text-slate-500">{o.authorName ?? 'System'} · <DateText value={o.createdAt} /></span>
      </div>
      <p className="mt-2 text-slate-800">{o.text}</p>
      {o.resolutionNote && <p className="mt-1 text-xs text-slate-600">Resolution: {o.resolutionNote}</p>}
      {onResolve && o.status === 'OPEN' && <Button className="mt-2" size="sm" variant="secondary" onClick={onResolve}>Resolve</Button>}
    </li>
  );
}

