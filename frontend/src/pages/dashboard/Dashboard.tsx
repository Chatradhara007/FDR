import { AlertOctagon, Banknote, CalendarClock, FileWarning, Flag, Search, ShieldCheck, Siren } from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS, VERIFICATION_STATES, VERIFICATION_STATE_LABELS, formatDate, formatINR, formatINRCompact,
  type Dashboard as DashboardData, type InstrumentStatus,
} from '@fdr/shared';
import { useMeta } from '@/api/instruments';
import { toQuery } from '@/api/reporting';
import { useDashboard } from '@/api/reporting';
import { Card, EmptyState, PageHeader, StatusChip, VerificationChip } from '@/components';
import { cn } from '@/lib/cn';

const selectCls = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Register link with the dashboard's own filters carried over. */
function registerLink(base: { region?: string; type?: string }, extra: Record<string, string | undefined>) {
  return `/register${toQuery({ ...base, ...extra })}`;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Kpi({ icon, label, value, sub, to }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; to: string }) {
  return (
    <Link to={to} className="group rounded-lg border border-slate-200 bg-surface p-4 shadow-sm hover:border-primary-300 hover:shadow">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">{icon}{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-sm text-slate-600 tabular-nums">{sub}</div>}
      <div className="mt-2 text-xs text-primary-700 group-hover:underline">Open the list →</div>
    </Link>
  );
}

/** Horizontal bar: label with icon, bar length by amount, count and amount as text (never colour alone). */
function BarRow({ label, count, amount, max, to }: { label: ReactNode; count: number; amount: string; max: number; to: string }) {
  const pct = max > 0 ? Math.max(count > 0 ? 2 : 0, (Number(amount) / max) * 100) : 0;
  return (
    <Link to={to} className="grid grid-cols-[11rem_1fr_8rem] items-center gap-3 rounded px-1 py-1.5 hover:bg-slate-50">
      <span>{label}</span>
      <span className="h-3 rounded bg-slate-100" aria-hidden>
        <span className="block h-3 rounded bg-primary-600" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right text-sm tabular-nums text-slate-800">
        <strong>{count}</strong> · {formatINRCompact(amount)}
      </span>
    </Link>
  );
}

function StatusBreakdown({ d, base }: { d: DashboardData; base: { region?: string; type?: string } }) {
  const max = Math.max(...d.byStatus.map((g) => Number(g.amount)), 0);
  return (
    <Card title="Instruments by status (count · amount)">
      <div className="space-y-0.5">
        {d.byStatus.map((g) => (
          <BarRow key={g.key} count={g.count} amount={g.amount} max={max}
            label={g.key === 'PENDING'
              ? <span className="inline-flex items-center gap-1 text-sm font-medium text-info-700"><Search className="size-3.5" aria-hidden />{g.label}</span>
              : <StatusChip status={g.statuses[0] as InstrumentStatus} />}
            to={registerLink(base, { status: g.statuses.join(',') })} />
        ))}
      </div>
    </Card>
  );
}

function MaturityChart({ d }: { d: DashboardData }) {
  const data = d.maturityByMonth.map((m) => ({
    month: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}`,
    crore: Number(m.amount) / 1e7,
    amount: m.amount,
    count: m.count,
  }));
  return (
    <Card title="Amount maturing per month (next 12 months, ₹ Cr)">
      <div className="h-64" role="img" aria-label="Bar chart of the amount maturing in each of the next 12 months">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={40} />
            <Tooltip formatter={(_v, _n, p) => [`${formatINR(p.payload.amount as string)} · ${p.payload.count as number} instrument(s)`, 'Maturing']} />
            <Bar dataKey="crore" fill="var(--color-primary-600)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Amount maturing per month</caption>
        <tbody>{data.map((r) => <tr key={r.month}><td>{r.month}</td><td>{formatINR(r.amount)}</td><td>{r.count}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}

function Buckets({ d, base }: { d: DashboardData; base: { region?: string; type?: string } }) {
  const range: Record<string, Record<string, string | undefined>> = {
    overdue: { status: 'MATURED,LAPSED' },
    d0_30: { status: 'ACTIVE,EXPIRING,RELEASE_REQUESTED', maturityFrom: d.asOf, maturityTo: addDays(d.asOf, 30) },
    d31_60: { status: 'ACTIVE,EXPIRING,RELEASE_REQUESTED', maturityFrom: addDays(d.asOf, 31), maturityTo: addDays(d.asOf, 60) },
    d61_90: { status: 'ACTIVE,EXPIRING,RELEASE_REQUESTED', maturityFrom: addDays(d.asOf, 61), maturityTo: addDays(d.asOf, 90) },
  };
  return (
    <Card title="Maturity buckets (live instruments)">
      <div className="grid grid-cols-2 gap-3">
        {d.maturityBuckets.map((b) => (
          <Link key={b.key} to={registerLink(base, range[b.key])}
            className={cn('rounded-md border p-3 hover:shadow', b.key === 'overdue' && b.count > 0 ? 'border-danger-300 bg-danger-50' : 'border-slate-200')}>
            <div className="flex items-center gap-1 text-sm font-medium text-slate-700">
              {b.key === 'overdue' ? <AlertOctagon className="size-4 text-danger-700" aria-hidden /> : <CalendarClock className="size-4" aria-hidden />}
              {b.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{b.count}</div>
            <div className="text-sm tabular-nums text-slate-600">{formatINRCompact(b.amount)}</div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Verification({ d }: { d: DashboardData }) {
  const total = VERIFICATION_STATES.reduce((s, v) => s + d.verification.byState[v], 0);
  return (
    <Card title="Verification (submitted instruments)">
      <ul className="space-y-2">
        {VERIFICATION_STATES.map((v) => {
          const n = d.verification.byState[v];
          return (
            <li key={v}>
              <Link to={`/reports?preset=pending-verification`} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 hover:bg-slate-50">
                <VerificationChip state={v} />
                <span className="h-3 rounded bg-slate-100" aria-hidden>
                  <span className="block h-3 rounded bg-primary-600" style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
                </span>
                <span className="text-right text-sm font-semibold tabular-nums" aria-label={`${VERIFICATION_STATE_LABELS[v]}: ${n}`}>{n}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-slate-600">Accepted without bank confirmation (override): <strong className="tabular-nums">{d.verification.acceptedWithOverride}</strong></p>
    </Card>
  );
}

function Regions({ d, base }: { d: DashboardData; base: { region?: string; type?: string } }) {
  return (
    <Card title="Regions (current instruments)">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-600"><th className="py-1">Region</th><th className="text-right">Count</th><th className="text-right">Amount</th><th className="text-right">At risk</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {d.byRegion.map((r) => (
            <tr key={r.region}>
              <td className="py-1.5"><Link className="text-primary-700 hover:underline" to={`/institutions?region=${encodeURIComponent(r.region)}`}>{r.region}</Link></td>
              <td className="text-right tabular-nums">{r.count}</td>
              <td className="text-right tabular-nums">{formatINRCompact(r.amount)}</td>
              <td className="text-right tabular-nums">
                {r.atRisk > 0
                  ? <Link to={registerLink({ ...base, region: r.region }, { status: 'EXPIRING,MATURED,LAPSED' })} className="inline-flex items-center gap-1 font-semibold text-danger-700 hover:underline"><AlertOctagon className="size-3.5" aria-hidden />{r.atRisk} at risk</Link>
                  : <span className="text-slate-500">0</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.byRegion.length === 0 && <p className="text-sm text-slate-500">No instruments yet.</p>}
    </Card>
  );
}

function Banks({ d, base }: { d: DashboardData; base: { region?: string; type?: string } }) {
  return (
    <Card title="Banks">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-600"><th className="py-1">Bank</th><th className="text-right">Count</th><th className="text-right">Verified</th><th className="text-right">Mismatch rate</th><th className="text-right">Unavailable</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {d.byBank.map((b) => (
            <tr key={b.bank}>
              <td className="py-1.5"><Link className="text-primary-700 hover:underline" to={registerLink(base, { bank: b.bank })}>{b.bank}</Link></td>
              <td className="text-right tabular-nums">{b.count}</td>
              <td className="text-right tabular-nums">{b.verified}</td>
              <td className="text-right tabular-nums" title={`${b.mismatches} of ${b.verifications} conclusive bank responses; ${b.discrepancies} discrepancies`}>
                {b.mismatchRate === null ? '—' : `${b.mismatchRate}%`}
              </td>
              <td className="text-right tabular-nums">{b.unavailable}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.byBank.length === 0 && <p className="text-sm text-slate-500">No instruments yet.</p>}
    </Card>
  );
}

function Alerts({ d }: { d: DashboardData }) {
  const levels = [1, 2, 3];
  return (
    <Card title={`Open alerts (${d.alerts.total})`} actions={<Link to="/alerts" className="text-sm text-primary-700 hover:underline">Alerts inbox →</Link>}>
      <div className="grid grid-cols-3 gap-3">
        {levels.map((l) => (
          <Link key={l} to="/alerts" className="rounded-md border border-slate-200 p-3 hover:shadow">
            <div className="flex items-center gap-1 text-sm font-medium text-slate-700">
              {l === 1 ? <Siren className="size-4" aria-hidden /> : <AlertOctagon className={cn('size-4', l === 3 ? 'text-danger-700' : 'text-warning-700')} aria-hidden />}
              {l === 1 ? 'L1 · Original' : l === 2 ? 'L2 · Approver' : 'L3 · Administrator'}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{d.alerts.byLevel[String(l)] ?? 0}</div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** /dashboard: management overview; every figure from the app clock's date (asOf). */
export function Dashboard() {
  const [params, setParams] = useSearchParams();
  const region = params.get('region') ?? '';
  const type = params.get('type') ?? '';
  const meta = useMeta();
  const q = useDashboard({ region, type });
  const d = q.data;
  const base = { region: region || undefined, type: type || undefined };

  const set = (key: 'region' | 'type') => (e: ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(params);
    if (e.target.value) next.set(key, e.target.value); else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="What AICTE holds, how much of it is proven, and what is about to go wrong."
        actions={d && <span className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white" data-testid="as-of">As of {formatDate(d.asOf)}</span>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Region<br />
          <select className={selectCls} value={region} onChange={set('region')}>
            <option value="">All regions</option>
            {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="text-sm">Type<br />
          <select className={selectCls} value={type} onChange={set('type')}>
            <option value="">All types</option>
            {INSTRUMENT_TYPES.map((t) => <option key={t} value={t}>{INSTRUMENT_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
      </div>
      {q.isError && <EmptyState title="Could not load the dashboard" description={q.error.message} />}
      {d && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi icon={<Banknote className="size-4" aria-hidden />} label="Live instruments" value={formatINRCompact(d.kpis.live.amount)}
              sub={`${d.kpis.live.count} instruments`} to={registerLink(base, { status: 'ACTIVE,EXPIRING,MATURED,LAPSED,RELEASE_REQUESTED' })} />
            <Kpi icon={<ShieldCheck className="size-4" aria-hidden />} label="Bank-confirmed"
              value={d.kpis.confirmedPct === null ? '—' : `${d.kpis.confirmedPct}%`}
              sub={`${formatINRCompact(d.kpis.confirmedAmount)} of the live amount`} to="/reports?preset=pending-verification" />
            <Kpi icon={<Search className="size-4" aria-hidden />} label="Pending scrutiny" value={d.kpis.pendingScrutiny}
              to={registerLink(base, { status: 'SUBMITTED,UNDER_SCRUTINY' })} />
            <Kpi icon={<FileWarning className="size-4" aria-hidden />} label="Open discrepancies" value={d.kpis.openDiscrepancies}
              to="/reports?preset=discrepancies" />
            <Kpi icon={<AlertOctagon className="size-4" aria-hidden />} label="Open escalations (L2+)" value={d.kpis.openEscalations}
              to="/alerts" />
            <Kpi icon={<Flag className="size-4" aria-hidden />} label="Advisory flags" value={d.kpis.advisoryFlags}
              sub="Worth a closer look; nothing blocked" to="/officer/queue" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <StatusBreakdown d={d} base={base} />
            <div className="space-y-4">
              <Buckets d={d} base={base} />
              <Alerts d={d} />
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <MaturityChart d={d} />
            <Verification d={d} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Regions d={d} base={base} />
            <Banks d={d} base={base} />
          </div>
        </div>
      )}
    </>
  );
}
