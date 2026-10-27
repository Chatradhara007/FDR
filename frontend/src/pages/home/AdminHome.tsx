import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatINRCompact } from '@fdr/shared';
import { useAlerts } from '@/api/alerts';
import { useDashboard } from '@/api/reporting';
import { useAuth } from '@/auth/AuthContext';
import { AlertKindChip, AlertLevelChip, ClockControls, EmptyState, Kicker, StatChip, Tabs } from '@/components';
import { useClock } from '@/hooks/useClock';
import { firstName, greeting } from '@/lib/greeting';
import { Alerts, Banks, Buckets, MaturityChart, Regions, StatusBreakdown, Verification } from '@/pages/dashboard/Dashboard';

/** /admin: greeting, three numbers, what needs attention, the app clock, then the dashboard panels as tabs. */
export function AdminHome() {
  const { user } = useAuth();
  const clock = useClock();
  const dash = useDashboard({});
  const escalations = useAlerts({ status: 'open', pageSize: 100 });
  const [tab, setTab] = useState('status');
  const d = dash.data;
  const attention = (escalations.data?.items ?? []).filter((a) => a.level >= 2).slice(0, 8);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="text-[1.875rem] leading-tight font-bold tracking-[-0.02em]">{greeting(clock.data?.now)}, {firstName(user?.name)}</h1>
          <p className="mt-1.5 text-base text-muted">
            {d && (d.kpis.openEscalations || d.kpis.openDiscrepancies
              ? 'Escalations and discrepancies are open. Officers and approvers act on them; you keep the rules and the clock right.'
              : 'Nothing is escalated. The rules, users and app clock are yours to keep right.')}
          </p>
        </div>
        {d && (
          <div className="flex flex-wrap gap-2.5">
            <StatChip value={formatINRCompact(d.kpis.live.amount)} label={`live in ${d.kpis.live.count} deposits`} />
            <StatChip value={d.kpis.openEscalations} label="escalated" tone="attention" />
            <StatChip value={d.kpis.openDiscrepancies} label="open discrepancies" />
          </div>
        )}
      </div>

      <div className="mt-[22px] flex flex-wrap items-start gap-[22px]">
        <section className="min-w-0 flex-[2_1_520px] overflow-hidden rounded-[14px] border border-border bg-white">
          <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-6 py-4">
            <h2 className="text-lg font-bold">Needs attention</h2>
            <Link to="/alerts" className="text-sm font-medium text-teal hover:underline">All alerts</Link>
          </div>
          {escalations.isLoading && <p className="p-6 text-sm text-muted">Loading…</p>}
          {escalations.data && attention.length === 0 && <div className="p-6"><EmptyState title="Nothing is escalated" description="Escalations appear here when a deadline passes without action." /></div>}
          <ul>
            {attention.map((a) => (
              <li key={a.id} className="border-b border-hairline px-6 py-4 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertLevelChip level={a.level} role={a.recipientRole} />
                  <AlertKindChip kind={a.kind} />
                  <Link to={`/instruments/${a.instrumentId}`} className="mono text-sm font-medium break-all text-teal hover:underline">{a.instrumentReferenceNo ?? 'Instrument'}</Link>
                  <span className="text-sm text-muted">{a.institutionName}</span>
                </div>
                <p className="mt-1.5 text-[0.9375rem] text-ink-2">{a.message}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-w-0 flex-[1_1_300px] rounded-[14px] border border-border bg-white p-6">
          <Kicker>App clock</Kicker>
          <p className="mt-1.5 text-[0.9375rem] text-ink-2">Every user sees this date. Moving it runs the daily evaluation at once. The clock chip in the header does the same from any page.</p>
          <div className="mt-4"><ClockControls /></div>
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-4 text-sm">
            <Link to="/admin/rules" className="gov-link">Rules</Link>
            <Link to="/admin/users" className="gov-link">Users</Link>
            <Link to="/admin/outbox" className="gov-link">Outbox</Link>
            <Link to="/audit" className="gov-link">Audit log</Link>
          </div>
        </section>
      </div>

      <section className="mt-8" aria-label="Portfolio detail">
        <h2 className="mb-3.5 text-lg font-bold">Portfolio</h2>
        {dash.isError && <EmptyState title="Could not load the figures" description={dash.error.message} />}
        {d && (
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'status', label: 'Status', content: <StatusBreakdown d={d} base={{}} /> },
            { id: 'maturity', label: 'Maturity', content: <div className="space-y-5"><Buckets d={d} base={{}} /><MaturityChart d={d} /></div> },
            { id: 'verification', label: 'Verification', content: <Verification d={d} /> },
            { id: 'regions', label: 'Regions', content: <Regions d={d} base={{}} /> },
            { id: 'banks', label: 'Banks', content: <Banks d={d} base={{}} /> },
            { id: 'alerts', label: 'Alerts', content: <Alerts d={d} /> },
          ]} />
        )}
      </section>
    </>
  );
}
