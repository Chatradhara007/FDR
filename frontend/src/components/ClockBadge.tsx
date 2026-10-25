import { CalendarClock, CalendarDays, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useClock, useClockMutation } from '@/hooks/useClock';
import { Badge } from './Badge';
import { Button } from './Button';
import { FieldError } from './FieldError';
import { Modal } from './Modal';
import { useToast } from './Toast';

/** Business date for everyone; amber "SIMULATED" when an admin has moved the app clock. */
export function ClockBadge() {
  const clock = useClock();
  if (!clock.data) return null;
  const date = formatDate(clock.data.today);
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

/** Admin-only: +1 / +7 / +30 days, set a date, reset to real time. */
export function ClockControls() {
  const toast = useToast();
  const mutation = useClockMutation();
  const [setOpen, setSetOpen] = useState(false);
  const [date, setDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);

  const run = (action: Parameters<typeof mutation.mutate>[0], onDone?: () => void) =>
    mutation.mutate(action, {
      onSuccess: (data) => {
        const msg = data.mode === 'SIMULATED' ? `App date is now ${formatDate(data.today)} (simulated)` : `Clock reset to real time (${formatDate(data.today)})`;
        if (data.warning === 'CLOCK_MOVED_BACKWARDS') toast.warning(`${msg}. The clock moved backwards.`);
        else toast.success(msg);
        onDone?.();
      },
      onError: (err) => {
        if (err instanceof ApiError && err.fieldErrors().date) setDateError(err.fieldErrors().date);
        else toast.error(err instanceof Error ? err.message : 'Clock change failed');
      },
    });

  return (
    <div className="flex items-center gap-1" role="group" aria-label="App clock controls">
      {[1, 7, 30].map((days) => (
        <Button key={days} size="sm" variant="secondary" disabled={mutation.isPending} onClick={() => run({ kind: 'advance', days })}>
          +{days}d
        </Button>
      ))}
      <Button size="sm" variant="secondary" disabled={mutation.isPending} onClick={() => { setDateError(null); setSetOpen(true); }}>
        Set date
      </Button>
      <Button size="sm" variant="ghost" disabled={mutation.isPending} icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => run({ kind: 'reset' })}>
        Reset
      </Button>
      <Modal
        open={setOpen}
        title="Set the app date"
        onClose={() => setSetOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSetOpen(false)}>Cancel</Button>
            <Button loading={mutation.isPending} disabled={!date} onClick={() => run({ kind: 'set', date }, () => setSetOpen(false))}>
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
        <p className="mt-2 text-xs text-slate-500">Every user sees this date. Reminders and statuses follow it from Phase 4 on.</p>
      </Modal>
    </div>
  );
}
