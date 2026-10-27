import { ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useClock } from '@/hooks/useClock';
import { formatDateGov } from '@/lib/format';
import { crumbsFor } from '@/lib/nav';

/** Breadcrumb row on a light band, with the app clock's date as "Last updated" on the right. */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const clock = useClock(!!user);
  const trail = crumbsFor(pathname);
  return (
    <div className="border-b border-line bg-strip print:hidden">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-sm sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-slate-800">
            <li><Link to="/" className="gov-link">Home</Link></li>
            {trail.map((c, i) => (
              <li key={`${c}-${i}`} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-slate-600" aria-hidden />
                <span aria-current={i === trail.length - 1 ? 'page' : undefined} className={i === trail.length - 1 ? 'font-semibold' : undefined}>{c}</span>
              </li>
            ))}
          </ol>
        </nav>
        {clock.data && <p className="text-slate-800">Last updated: <span className="font-semibold tabular-nums">{formatDateGov(clock.data.today)}</span></p>}
      </div>
    </div>
  );
}
