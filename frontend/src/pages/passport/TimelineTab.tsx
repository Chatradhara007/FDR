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
  if (!keys.length) return <p className="text-xs text-muted">No details recorded.</p>;
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-left text-muted">
          <th scope="col" className="py-1 pr-3 font-semibold">Field</th>
          {before && <th scope="col" className="py-1 pr-3 font-semibold">Before</th>}
          <th scope="col" className="py-1 font-semibold">{before ? 'After' : 'Recorded'}</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const changed = before !== null && JSON.stringify(before[k]) !== JSON.stringify(after?.[k]);
          return (
            <tr key={k} className={cn(changed && 'bg-attn-tint')} data-changed={changed || undefined}>
              <td className="py-1 pr-3 font-medium text-ink-2">{k}{changed && <span className="sr-only"> (changed)</span>}</td>
              {before && <td className="py-1 pr-3 break-all text-muted">{show(before[k])}</td>}
              <td className={cn('py-1 break-all', changed ? 'font-semibold text-ink' : 'text-muted')}>{show(after?.[k])}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The lifeline: everything that happened to the instrument, newest first (app-clock times). Each event carries its
 *  audit-chain code (the audit event number), so it can be found in the audit log. */
export function TimelineTab({ events }: { events: TimelineEvent[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (!events.length) return <p className="text-sm text-muted">Nothing recorded yet.</p>;
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <ol className="relative" aria-label="Lifeline">
      {events.map((e, i) => {
        const Icon = ICONS[e.icon] ?? Activity;
        const expanded = open.has(e.id);
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="relative grid grid-cols-[34px_minmax(0,1fr)] gap-x-3">
            <div className="relative flex justify-center">
              {!last && <span aria-hidden className="absolute top-9 bottom-0 w-[2px] bg-border" />}
              <span className={cn('relative mt-1.5 flex size-[30px] items-center justify-center rounded-full border-2',
                i === 0 ? 'border-teal bg-teal text-white' : 'border-border bg-white text-muted')}>
                <Icon className="size-3.5" aria-hidden />
              </span>
            </div>
            <div className="min-w-0 pb-4">
              <button type="button" onClick={() => toggle(e.id)} aria-expanded={expanded}
                className="flex w-full items-start gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-subtle">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-semibold text-ink">{e.label}</span>
                  <span className="block text-[0.8125rem] text-muted">{e.actor} · {time(e.at)}</span>
                </span>
                <span className="mono shrink-0 rounded-[6px] bg-chip px-1.5 py-0.5 text-[0.75rem] text-ink-2" title="Audit-chain code: the audit event number">
                  <span className="sr-only">Audit event </span>#{e.id}
                </span>
                {expanded ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
              </button>
              {expanded && <div className="px-2 pb-1"><Diff before={e.before} after={e.after} /></div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
