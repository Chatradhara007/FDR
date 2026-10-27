import { AlertOctagon, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatINRCompact } from '@fdr/shared';
import { useAuditEvents, useIntegrity } from '@/api/admin';
import { useDashboard } from '@/api/reporting';
import { useAuth } from '@/auth/AuthContext';
import { DateText, EmptyState, StatChip } from '@/components';
import { useClock } from '@/hooks/useClock';
import { firstName, greeting } from '@/lib/greeting';

/** /auditor: the audit-integrity card first, three numbers, the latest audit events. Read-only. */
export function AuditorHome() {
  const { user } = useAuth();
  const clock = useClock();
  const integrity = useIntegrity();
  const dash = useDashboard({});
  const events = useAuditEvents({ page: 1, pageSize: 10 });
  const i = integrity.data;
  const d = dash.data;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="text-[1.875rem] leading-tight font-bold tracking-[-0.02em]">{greeting(clock.data?.now)}, {firstName(user?.name)}</h1>
          <p className="mt-1.5 text-base text-muted">You can look at everything and change nothing. Start with the audit log.</p>
        </div>
        {d && (
          <div className="flex flex-wrap gap-2.5">
            <StatChip value={formatINRCompact(d.kpis.live.amount)} label={`live in ${d.kpis.live.count} deposits`} />
            <StatChip value={d.kpis.openDiscrepancies} label="open discrepancies" tone={d.kpis.openDiscrepancies ? 'attention' : 'plain'} />
            <StatChip value={d.verification.acceptedWithOverride} label="accepted with override" />
          </div>
        )}
      </div>

      <section aria-label="Audit integrity" className={`mt-[22px] rounded-[14px] border bg-white p-6 sm:p-[26px] ${i && !i.ok ? 'border-danger border-l-[5px]' : 'border-border border-l-[5px] border-l-teal'}`}>
        {!i && <p className="text-muted">Checking the audit log…</p>}
        {i?.ok && (
          <div className="flex flex-wrap items-start gap-4">
            <ShieldCheck className="size-8 shrink-0 text-teal" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="kicker text-teal-hover">Audit log intact</div>
              <p className="mt-1 text-xl font-bold">All {i.checked.toLocaleString('en-IN')} events check out.</p>
              <p className="mt-1 text-[0.9375rem] text-muted">Each event is chained to the one before it, so an edited or deleted event would break the chain here. Checked <DateText value={i.verifiedAt} />.</p>
            </div>
            <Link to="/audit" className="rounded-[10px] bg-ink px-5 py-2.5 text-[0.9375rem] font-semibold text-white hover:bg-ink-2">Open the audit log</Link>
          </div>
        )}
        {i && !i.ok && (
          <div className="flex flex-wrap items-start gap-4">
            <AlertOctagon className="size-8 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="kicker text-danger">Audit log broken</div>
              <p className="mt-1 text-xl font-bold">The chain breaks at event #{i.firstBrokenId}.</p>
              <p className="mt-1 text-[0.9375rem] text-muted">That event, or one before it, was changed outside the portal. Report it before relying on later events.</p>
            </div>
            <Link to="/audit" className="rounded-[10px] bg-danger px-5 py-2.5 text-[0.9375rem] font-semibold text-white hover:bg-danger-700">See event #{i.firstBrokenId}</Link>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="mb-3.5 text-lg font-bold">Recent audit events</h2>
          <span className="flex gap-4 text-sm"><Link to="/audit" className="gov-link">Audit log</Link><Link to="/reports" className="gov-link">Reports</Link></span>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-border bg-white">
          {events.isLoading && <p className="p-6 text-sm text-muted">Loading…</p>}
          {events.data && events.data.items.length === 0 && <div className="p-6"><EmptyState title="No events yet" /></div>}
          <ul>
            {events.data?.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-6 py-3.5 last:border-b-0">
                <span className="mono w-14 shrink-0 text-[0.8125rem] text-muted">#{e.id}</span>
                <span className="min-w-0 flex-[1_1_240px] font-semibold">{e.label}</span>
                {e.referenceNo && e.instrumentId
                  ? <Link to={`/instruments/${e.instrumentId}`} className="mono text-[0.8125rem] break-all text-teal hover:underline">{e.referenceNo}</Link>
                  : <span className="text-[0.8125rem] text-muted">{e.entityType}</span>}
                <span className="text-sm text-muted">{e.actorLabel}</span>
                <span className="text-sm text-muted tabular-nums"><DateText value={e.createdAt} /></span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
