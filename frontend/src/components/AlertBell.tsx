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
      className="relative inline-flex size-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      aria-label={`Alerts: ${total} open`}
      title={`${total} open alert${total === 1 ? '' : 's'}`}
    >
      <Bell className="size-5" aria-hidden />
      {total > 0 && (
        <span
          data-testid="alert-bell-count"
          className="absolute -right-1 -top-1 min-w-5 rounded-full bg-danger-600 px-1 text-center text-[11px] font-semibold leading-5 text-white"
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
    </Link>
  );
}
