import { ArrowRight, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime, type Dashboard as DashboardData } from '@fdr/shared';
import { useAuditEvents, useIntegrity, useRecheckIntegrity } from '@/api/admin';
import { Button, CountUp, PageHeader, StatRow, StatTile } from '@/components';
import { formatDateGov } from '@/lib/format';

/** The audit-integrity status, large and plain: green shield when every hash recomputes, red otherwise. */
function IntegrityCard() {
  const integrity = useIntegrity();
  const recheck = useRecheckIntegrity();
  const r = integrity.data;
  if (!r) return <div className="h-32 animate-pulse rounded-xl bg-strip" aria-hidden />;
  const Icon = r.ok ? ShieldCheck : ShieldAlert;
  return (
    <section role={r.ok ? 'status' : 'alert'} className={`flex flex-wrap items-center gap-6 rounded-xl border px-6 py-6 ${r.ok ? 'border-success-600/25 bg-success-50' : 'border-danger-600/30 bg-danger-50'}`}>
      <span className={`inline-flex size-14 items-center justify-center rounded-full bg-white ${r.ok ? 'text-success-700' : 'text-danger-700'}`}>
        <Icon className="size-7" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-2xl font-semibold text-slate-900">{r.ok ? 'Audit log intact' : 'Audit log altered'}</h2>
        <p className="mt-1 text-slate-700">
          {r.ok
            ? `All ${r.checked.toLocaleString('en-IN')} events recompute to the same hash chain.`
            : `The hash chain breaks at event #${r.firstBrokenId}. Open the audit log to see it.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={recheck.isPending} onClick={() => recheck.mutate()}>Check again</Button>
        <Link to="/audit"><Button>Open audit log</Button></Link>
      </div>
    </section>
  );
}

/** Auditor landing: integrity first, three numbers, the latest audit events and a way to the reports. */
export function AuditorHome({ d }: { d: DashboardData | undefined }) {
  const events = useAuditEvents({ pageSize: 8 });
  const n = (v: number | undefined) => (v === undefined ? '—' : <CountUp value={v} />);
  return (
    <div className="space-y-10">
      <PageHeader title="Audit overview" subtitle="Read-only view. Every change is logged, and the log can be checked for tampering."
        actions={d && <span className="rounded-full bg-strip px-3 py-1.5 text-sm text-slate-700" data-testid="as-of">As of {formatDateGov(d.asOf)}</span>} />
      <IntegrityCard />
      <StatRow>
        <StatTile label="Audit events" value={n(events.data?.total)} to="/audit" />
        <StatTile label="Accepted without bank confirmation" value={n(d?.verification.acceptedWithOverride)} note="Officer overrides" to="/reports" />
        <StatTile label="Open discrepancies" value={n(d?.kpis.openDiscrepancies)} to="/reports?preset=discrepancies" />
      </StatRow>
      <section aria-labelledby="recent-events">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 id="recent-events" className="text-xl font-semibold text-slate-900">Recent audit events</h2>
          <Link to="/reports" className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline underline-offset-4">Reports <ArrowRight className="size-4" aria-hidden /></Link>
        </div>
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {events.isLoading && <li className="px-5 py-6 text-sm text-slate-600">Loading…</li>}
          {events.data?.items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5">
              <span className="w-14 text-sm text-slate-500 tabular-nums">#{e.id}</span>
              <span className="min-w-0 flex-1 basis-56 text-slate-800">
                {e.label}
                {e.referenceNo && e.instrumentId && <> · <Link to={`/instruments/${e.instrumentId}`} className="gov-link">{e.referenceNo}</Link></>}
              </span>
              <span className="text-sm text-slate-600">{e.actorLabel}</span>
              <span className="text-sm text-slate-600 tabular-nums">{formatDateTime(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
