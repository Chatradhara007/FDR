import { CalendarClock, CalendarDays, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { formatDate, type EvaluationSummary } from '@fdr/shared';
import { formatDateGov } from '@/lib/format';
import { ApiError } from '@/api/client';
import { useClock, useClockMutation, type ClockAction } from '@/hooks/useClock';
import { Badge } from './Badge';
import { Button } from './Button';
import { FieldError } from './FieldError';
import { Modal } from './Modal';
import { useToast } from './Toast';

/** Business date for everyone; amber "SIMULATED" when an admin has moved the app clock. */
export function ClockBadge() {
  const clock = useClock();
  if (!clock.data) return null;
  const date = formatDateGov(clock.data.today);
  return clock.data.mode === 'SIMULATED' ? (
    <Badge tone="warning" icon={<CalendarClock className="size-3.5" aria-hidden />} className="font-semibold" >
      <span data-testid="clock-badge">SIMULATED · {date}</span>
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<CalendarDays className="size-3.5" aria-hidden />}>
      <span data-testid="clock-badge">Today · {date}</span>
    </Badge>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** `3 status changes · 14 alerts · 2 escalations · 5 resolved` */
export function summaryText(s: EvaluationSummary): string {
  return [
    plural(s.statusChanges, 'status change', 'status changes'),
    plural(s.alertsCreated, 'alert', 'alerts'),
    plural(s.escalations, 'escalation', 'escalations'),
    `${s.resolved} resolved`,
  ].join(' · ');
}

/** The browser's calendar date, only to warn before "Reset" moves the app date backwards. */
function browserToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Admin-only: +1 / +7 / +30 / +90 days, set a date, reset to real time. Each change runs the daily job at once. */
export function ClockControls() {
  const toast = useToast();
  const clock = useClock();
  const mutation = useClockMutation();
  const [setOpen, setSetOpen] = useState(false);
  const [date, setDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ action: ClockAction; message: string; onDone?: () => void } | null>(null);
  const today = clock.data?.today;

  const run = (action: ClockAction, onDone?: () => void) =>
    mutation.mutate(action, {
      onSuccess: ({ clock: c, summary }) => {
        const when = c.mode === 'SIMULATED' ? `App date ${formatDate(c.today)} (simulated)` : `Clock reset to real time (${formatDate(c.today)})`;
        const msg = `${when}: ${summaryText(summary)}`;
        if (c.warning === 'CLOCK_MOVED_BACKWARDS') toast.warning(`${msg}. The clock moved backwards; existing alerts are kept.`);
        else toast.success(msg);
        onDone?.();
      },
      onError: (err) => {
        if (err instanceof ApiError && err.fieldErrors().date) setDateError(err.fieldErrors().date);
        else toast.error(err instanceof Error ? err.message : 'Clock change failed');
      },
    });

  /** Moving backwards asks first (alerts are never deleted, but statuses do not move back either). */
  const guarded = (action: ClockAction, target: string | null, onDone?: () => void) => {
    if (today && target && target < today) {
      setConfirm({ action, onDone, message: `This moves the app date back from ${formatDate(today)} to ${formatDate(target)}. Statuses and alerts already created stay as they are.` });
      return;
    }
    run(action, onDone);
  };

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="App clock controls">
      {[1, 7, 30, 90].map((days) => (
        <Button key={days} size="sm" variant="secondary" disabled={mutation.isPending} onClick={() => run({ kind: 'advance', days })}>
          +{days}d
        </Button>
      ))}
      <Button size="sm" variant="secondary" disabled={mutation.isPending} onClick={() => { setDateError(null); setDate(today ?? ''); setSetOpen(true); }}>
        Set date…
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={mutation.isPending}
        icon={<RotateCcw className="size-3.5" aria-hidden />}
        onClick={() => guarded({ kind: 'reset' }, clock.data?.mode === 'SIMULATED' ? browserToday() : null)}
      >
        Reset to today
      </Button>
      <Modal
        open={setOpen}
        title="Set the app date"
        onClose={() => setSetOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSetOpen(false)}>Cancel</Button>
            <Button loading={mutation.isPending} disabled={!date} onClick={() => guarded({ kind: 'set', date }, date, () => setSetOpen(false))}>
              Set date
            </Button>
          </>
        }
      >
        <label htmlFor="clock-date" className="mb-1 block font-medium text-slate-700">Simulated date</label>
        <input
          id="clock-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-invalid={!!dateError}
          aria-describedby="clock-date-error"
          className="h-9 w-full rounded-md border border-slate-300 px-3"
        />
        <FieldError id="clock-date-error" message={dateError} />
        <p className="mt-2 text-xs text-slate-500">Every user sees this date. The daily evaluation runs immediately: statuses, reminders and escalations follow it.</p>
      </Modal>
      <Modal
        open={!!confirm}
        title="Move the clock backwards?"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={mutation.isPending}
              onClick={() => {
                if (!confirm) return;
                const { action, onDone } = confirm;
                run(action, () => { setConfirm(null); onDone?.(); });
              }}
            >
              Move back
            </Button>
          </>
        }
      >
        <p className="text-slate-700">{confirm?.message}</p>
      </Modal>
    </div>
  );
}
