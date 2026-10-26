import { useState } from 'react';
import {
  Activity, BadgeCheck, Bell, ChevronDown, ChevronRight, Clock, Eye, FileText, FileWarning, HandCoins, Landmark, MessageSquareText, Pencil, RefreshCcw,
  Undo2, type LucideIcon,
} from 'lucide-react';
import type { TimelineEvent, TimelineIcon } from '@fdr/shared';
import { cn } from '@/lib/cn';

const ICONS: Record<TimelineIcon, LucideIcon> = {
  status: Activity, renewal: RefreshCcw, view: Eye, document: FileText, bank: Landmark, discrepancy: FileWarning,
  observation: MessageSquareText, alert: Bell, return: Undo2, accept: BadgeCheck, edit: Pencil, clock: Clock, release: HandCoins, event: Activity,
};

const time = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

/** Before/after of one event, changed keys highlighted. */
function Diff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (!keys.length) return <p className="text-xs text-slate-500">No details recorded.</p>;
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-left text-slate-500">
          <th scope="col" className="py-1 pr-3 font-semibold">Field</th>
          {before && <th scope="col" className="py-1 pr-3 font-semibold">Before</th>}
          <th scope="col" className="py-1 font-semibold">{before ? 'After' : 'Recorded'}</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const changed = before !== null && JSON.stringify(before[k]) !== JSON.stringify(after?.[k]);
          return (
            <tr key={k} className={cn(changed && 'bg-warning-50')} data-changed={changed || undefined}>
              <td className="py-1 pr-3 font-medium text-slate-700">{k}{changed && <span className="sr-only"> (changed)</span>}</td>
              {before && <td className="py-1 pr-3 break-all text-slate-600">{show(before[k])}</td>}
              <td className={cn('py-1 break-all', changed ? 'font-semibold text-slate-900' : 'text-slate-600')}>{show(after?.[k])}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Everything that happened to the instrument, newest first (app-clock times). */
export function TimelineTab({ events }: { events: TimelineEvent[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (!events.length) return <p className="text-sm text-slate-500">Nothing recorded yet.</p>;
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <ol className="relative space-y-1 border-l border-slate-200 pl-6">
      {events.map((e) => {
        const Icon = ICONS[e.icon] ?? Activity;
        const expanded = open.has(e.id);
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[2.05rem] top-2 flex size-6 items-center justify-center rounded-full bg-surface ring-1 ring-slate-200">
              <Icon className="size-3.5 text-slate-600" aria-hidden />
            </span>
            <button type="button" onClick={() => toggle(e.id)} aria-expanded={expanded}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50">
              {expanded ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />}
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{e.label}</span>
                <span className="block text-xs text-slate-500">{e.actor} · {time(e.at)}</span>
              </span>
            </button>
            {expanded && <div className="px-8 pb-2"><Diff before={e.before} after={e.after} /></div>}
          </li>
        );
      })}
    </ol>
  );
}
