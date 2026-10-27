import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAlertSummary } from '@/api/alerts';

/** Header bell with the open alert count for the signed-in user. */
export function AlertBell() {
  const summary = useAlertSummary();
  const total = summary.data?.total ?? 0;
  return (
    <Link
      to="/alerts"
      className="relative inline-flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-strip hover:text-slate-900"
      aria-label={`Alerts: ${total} open`}
      title={`${total} open alert${total === 1 ? '' : 's'}`}
    >
      <Bell className="size-[18px]" aria-hidden />
      {total > 0 && (
        <span
          data-testid="alert-bell-count"
          className="absolute right-0.5 top-0.5 min-w-5 rounded-full bg-danger-600 px-1 text-center text-xs font-semibold leading-5 text-white"
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
    </Link>
  );
}
