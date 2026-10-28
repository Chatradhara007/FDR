import { ClockControls, KeyValue, LoadingState, PageHeader, Panel } from '@/components';
import { useClock } from '@/hooks/useClock';
import { formatDateGov } from '@/lib/format';

/** /admin/clock (admin): the app date every user sees, and the controls to move it. In showcase mode this is the
 *  only place the clock can be changed. */
export function AppClockPage() {
  const clock = useClock();
  const c = clock.data;
  return (
    <div className="mx-auto max-w-[860px]">
      <PageHeader back={{ to: '/admin', label: 'Home' }} title="App clock" subtitle="Every user sees this date. Moving it runs the daily evaluation at once." />
      <Panel title="Current app date">
        {!c ? <LoadingState rows={2} label="Loading the app clock…" /> : (
          <>
            <p className="text-[1.75rem] leading-tight font-bold tabular-nums text-ink" data-testid="app-clock-date">{formatDateGov(c.today)}</p>
            <div className="mt-4">
              <KeyValue items={[{ label: 'Source', value: c.mode === 'SIMULATED' ? 'Set by an administrator' : 'Real calendar date (India Standard Time)' }]} />
            </div>
            <div className="mt-5 border-t border-hairline pt-5"><ClockControls /></div>
            <p className="mt-4 text-sm text-muted">
              Statuses, maturity reminders and escalations follow the app date. Moving it backwards keeps the alerts already
              created. Reset returns to the real date.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
