import { CalendarClock, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDate } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useClock, useClockMutation, type ClockAction } from '@/hooks/useClock';
import { cn } from '@/lib/cn';
import { formatDateGov } from '@/lib/format';
import { summaryText } from '../ClockBadge';
import { useToast } from '../Toast';

/** Header app-clock chip: "27 Oct 2026 · simulated". For the admin it is a button with quick clock moves, usable from any page.
 *  `plain` (showcase mode): just the date for everyone; the admin moves the clock from Admin > App clock. */
export function ClockChip({ admin, plain = false }: { admin: boolean; plain?: boolean }) {
  const clock = useClock();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const mutation = useClockMutation();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!clock.data) return null;
  const simulated = clock.data.mode === 'SIMULATED' && !plain;
  const label = (
    <span data-testid="clock-badge" className="tabular-nums">
      {formatDateGov(clock.data.today)}{simulated && <span className="text-attn-text"> · simulated</span>}
    </span>
  );
  if (!admin) return <span className="hidden text-[0.8125rem] whitespace-nowrap text-muted sm:inline" title="App date">{label}</span>;

  const run = (action: ClockAction) =>
    mutation.mutate(action, {
      onSuccess: ({ clock: c, summary }) => {
        const when = c.mode === 'SIMULATED' ? `App date ${formatDate(c.today)} (simulated)` : `Clock reset to real time (${formatDate(c.today)})`;
        const msg = `${when}: ${summaryText(summary)}`;
        if (c.warning === 'CLOCK_MOVED_BACKWARDS') toast.warning(`${msg}. The clock moved backwards; existing alerts are kept.`);
        else toast.success(msg);
        setOpen(false);
      },
      onError: (err) => toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Clock change failed'),
    });

  return (
    <div ref={root} className="relative hidden sm:block">
      <button type="button" aria-expanded={open} aria-controls={id} aria-label={`App clock: ${formatDateGov(clock.data.today)}${simulated ? ', simulated' : ''}. Change the app date`}
        onClick={() => setOpen((o) => !o)}
        className={cn('inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-2.5 text-[0.8125rem] whitespace-nowrap text-muted hover:bg-subtle',
          simulated ? 'border-attn-border' : 'border-border')}>
        <CalendarClock className="size-4" aria-hidden />{label}
      </button>
      {open && (
        <div id={id} role="group" aria-label="Quick clock moves" className="absolute top-full right-0 z-40 mt-1.5 w-64 rounded-[12px] border border-border bg-white p-3 shadow-lg">
          <p className="text-[0.8125rem] text-muted">Every user sees this date. The daily evaluation runs at once.</p>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {[1, 7, 30].map((d) => (
              <button key={d} type="button" disabled={mutation.isPending} onClick={() => run({ kind: 'advance', days: d })}
                aria-label={`Move the app date forward ${d} day${d === 1 ? '' : 's'}`}
                className="h-9 rounded-[8px] border border-border text-sm font-semibold hover:bg-subtle disabled:opacity-50">+{d}d</button>
            ))}
          </div>
          <button type="button" disabled={mutation.isPending} onClick={() => run({ kind: 'reset' })}
            className="mt-1.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] text-sm font-semibold text-ink hover:bg-chip disabled:opacity-50">
            <RotateCcw className="size-3.5" aria-hidden /> Reset to today
          </button>
        </div>
      )}
    </div>
  );
}
