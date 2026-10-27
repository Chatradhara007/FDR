import { AlertOctagon, Banknote, CalendarClock, Download, FileWarning, Flag, Search, ShieldCheck, Siren } from 'lucide-react';
import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS, VERIFICATION_STATES, VERIFICATION_STATE_LABELS, formatINR, formatINRCompact,
  type Dashboard as DashboardData, type InstrumentStatus,
} from '@fdr/shared';
import { useMeta } from '@/api/instruments';
import { toQuery } from '@/api/reporting';
import { useDashboard } from '@/api/reporting';
import { useAuth } from '@/auth/AuthContext';
import { Badge, Button, ClockControls, EmptyState, ErrorState, LoadingState, PageHeader, Panel, StatusChip, Table, Tabs, VerificationChip, type Column } from '@/components';
import { useCountUp } from '@/hooks/useCountUp';
import { downloadCsv } from '@/lib/csv';
import { formatDateGov } from '@/lib/format';
import { cn } from '@/lib/cn';

const selectCls = 'gov-input min-w-48 w-auto';
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

export type Base = { region?: string; type?: string };
type Edge = 'navy' | 'green' | 'saffron' | 'red' | 'blue';
const EDGE: Record<Edge, string> = {
  navy: 'border-l-ink', green: 'border-l-teal', saffron: 'border-l-attn', red: 'border-l-danger', blue: 'border-l-tier-doc-border',
};

function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

/** Bordered KPI tile: thick coloured left edge, big number, clear label, "More details →". */
function Kpi({ icon, label, value, sub, to, edge }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; to: string; edge: Edge }) {
  return (
    <Link to={to} className={cn('group flex min-w-0 flex-col rounded-[14px] border border-border border-l-[5px] bg-surface p-5 hover:bg-subtle', EDGE[edge])}>
      <div className="text-3xl font-bold tabular-nums text-ink">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">{icon}{label}</div>
      {sub && <div className="text-sm text-muted tabular-nums">{sub}</div>}
      <div className="mt-auto pt-2 text-sm text-teal group-hover:underline">More details →</div>
    </Link>
  );
}

/** Thin flat bar inside a table cell; the number next to it carries the value (never the bar alone). */
function Bar({ pct }: { pct: number }) {
  return (
    <span className="block h-2 w-full min-w-16 rounded bg-track" aria-hidden>
      <span className="block h-2 rounded bg-teal" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

function CsvLink({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-teal hover:underline"><Download className="size-3.5" aria-hidden />Download CSV</button>;
}

export function StatusBreakdown({ d, base }: { d: DashboardData; base: Base }) {
  const max = Math.max(...d.byStatus.map((g) => Number(g.amount)), 0);
  return (
    <Panel title="Instruments by status" flush
      actions={<>
        <CsvLink onClick={() => downloadCsv(`dashboard-status-${d.asOf}.csv`, ['Sl. No.', 'Status', 'No. of instruments', 'Amount (Rs.)'],
          d.byStatus.map((g, i) => [i + 1, g.label, g.count, g.amount]))} />
        <Link to={registerLink(base, {})} className="text-teal hover:underline">View all</Link>
      </>}>
      <table className="gov-table border-0">
        <caption className="sr-only">Instruments by status, with count and amount</caption>
        <thead><tr><th scope="col" className="w-16 text-right!">Sl. No.</th><th scope="col">Status</th><th scope="col" className="text-right!">No. of instruments</th><th scope="col" className="text-right!">Amount</th><th scope="col" className="hidden w-1/4 sm:table-cell">Share of amount</th></tr></thead>
        <tbody>
          {d.byStatus.map((g, i) => (
            <tr key={g.key}>
              <td className="num">{i + 1}</td>
              <td>
                <Link to={registerLink(base, { status: g.statuses.join(',') })} className="inline-flex hover:underline">
                  {g.key === 'PENDING'
                    ? <Badge tone="info" icon={<Search className="size-3.5" aria-hidden />}>{g.label}</Badge>
                    : <StatusChip status={g.statuses[0] as InstrumentStatus} />}
                </Link>
              </td>
              <td className="num font-semibold">{g.count}</td>
              <td className="num">{formatINRCompact(g.amount)}</td>
              <td className="hidden align-middle! sm:table-cell"><Bar pct={max > 0 ? (Number(g.amount) / max) * 100 : 0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function MaturityChart({ d }: { d: DashboardData }) {
  const data = d.maturityByMonth.map((m) => ({
    month: `${MONTHS[Number(m.month.slice(5)) - 1]}-${m.month.slice(2, 4)}`,
    crore: Number(m.amount) / 1e7,
    amount: m.amount,
    count: m.count,
  }));
  return (
    <Panel title="Amount maturing per month (next 12 months)"
      actions={<CsvLink onClick={() => downloadCsv(`dashboard-maturity-${d.asOf}.csv`, ['Month', 'No. of instruments', 'Amount (Rs.)'], data.map((r) => [r.month, r.count, r.amount]))} />}>
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="h-72 min-w-0" role="img" aria-label="Bar chart of the amount maturing in each of the next 12 months, in crore rupees; the same values are in the table">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#c5cfdd" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 13, fill: '#2d3748' }} />
              <YAxis tick={{ fontSize: 13, fill: '#2d3748' }} width={44} label={{ value: '₹ Cr', angle: -90, position: 'insideLeft', fontSize: 13 }} />
              <Tooltip formatter={(_v, _n, p) => [`${formatINR(p.payload.amount as string)} · ${p.payload.count as number} instrument(s)`, 'Maturing']} />
              <RBar dataKey="crore" fill="#1a4b9b" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="max-h-72 overflow-y-auto border border-border">
          <table className="gov-table border-0">
            <caption className="sr-only">Amount maturing per month</caption>
            <thead className="sticky top-0"><tr><th scope="col">Month</th><th scope="col" className="text-right!">No.</th><th scope="col" className="text-right!">Amount</th></tr></thead>
            <tbody>{data.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num">{r.count}</td><td className="num">{formatINRCompact(r.amount)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

export function Buckets({ d, base }: { d: DashboardData; base: Base }) {
  const range: Record<string, Record<string, string | undefined>> = {
    overdue: { status: 'MATURED,LAPSED' },
    d0_30: { status: 'ACTIVE,EXPIRING,RELEASE_REQUESTED', maturityFrom: d.asOf, maturityTo: addDays(d.asOf, 30) },
    d31_60: { status: 'ACTIVE,EXPIRING,RELEASE_REQUESTED', maturityFrom: addDays(d.asOf, 31), maturityTo: addDays(d.asOf, 60) },
    d61_90: { status: 'ACTIVE,EXPIRING,RELEASE_REQUESTED', maturityFrom: addDays(d.asOf, 61), maturityTo: addDays(d.asOf, 90) },
  };
  return (
    <Panel title="Maturity buckets (live instruments)" flush>
      <table className="gov-table border-0">
        <thead><tr><th scope="col">Period</th><th scope="col" className="text-right!">No.</th><th scope="col" className="text-right!">Amount</th></tr></thead>
        <tbody>
          {d.maturityBuckets.map((b) => (
            <tr key={b.key}>
              <td>
                <Link to={registerLink(base, range[b.key])} className={cn('inline-flex items-center gap-1 hover:underline', b.key === 'overdue' && b.count > 0 ? 'font-semibold text-danger-700' : 'text-teal')}>
                  {b.key === 'overdue' ? <AlertOctagon className="size-4" aria-hidden /> : <CalendarClock className="size-4" aria-hidden />}
                  {b.label}
                </Link>
              </td>
              <td className="num font-semibold">{b.count}</td>
              <td className="num">{formatINRCompact(b.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function Verification({ d }: { d: DashboardData }) {
  const total = VERIFICATION_STATES.reduce((s, v) => s + d.verification.byState[v], 0);
  return (
    <Panel title="Verification (submitted instruments)" flush actions={<Link to="/reports?preset=pending-verification" className="text-teal hover:underline">View all</Link>}>
      <table className="gov-table border-0">
        <thead><tr><th scope="col">Verification state</th><th scope="col" className="text-right!">No.</th><th scope="col" className="hidden w-1/3 sm:table-cell">Share</th></tr></thead>
        <tbody>
          {VERIFICATION_STATES.map((v) => {
            const n = d.verification.byState[v];
            return (
              <tr key={v}>
                <td><VerificationChip state={v} /></td>
                <td className="num font-semibold" aria-label={`${VERIFICATION_STATE_LABELS[v]}: ${n}`}>{n}</td>
                <td className="hidden align-middle! sm:table-cell"><Bar pct={total ? (n / total) * 100 : 0} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-sm text-ink">Accepted without bank confirmation (override): <strong className="tabular-nums">{d.verification.acceptedWithOverride}</strong></p>
    </Panel>
  );
}

type RegionRow = DashboardData['byRegion'][number];
type BankRow = DashboardData['byBank'][number];

export function Regions({ d, base }: { d: DashboardData; base: Base }) {
  const columns: Column<RegionRow>[] = [
    { key: 'region', header: 'Region', sortValue: (r) => r.region, cell: (r) => <Link className="gov-link" to={`/institutions?region=${encodeURIComponent(r.region)}`}>{r.region}</Link> },
    { key: 'count', header: 'No. of instruments', align: 'right', sortValue: (r) => r.count, cell: (r) => r.count },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => Number(r.amount), cell: (r) => formatINRCompact(r.amount) },
    {
      key: 'risk', header: 'At risk', align: 'right', sortValue: (r) => r.atRisk,
      cell: (r) => r.atRisk > 0
        ? <Link to={registerLink({ ...base, region: r.region }, { status: 'EXPIRING,MATURED,LAPSED' })} className="inline-flex items-center gap-1 font-semibold text-danger-700 hover:underline"><AlertOctagon className="size-3.5" aria-hidden />{r.atRisk} at risk</Link>
        : <span className="text-ink">0</span>,
    },
  ];
  return (
    <Panel title="Region-wise position (current instruments)"
      actions={<CsvLink onClick={() => downloadCsv(`dashboard-regions-${d.asOf}.csv`, ['Sl. No.', 'Region', 'No. of instruments', 'Amount (Rs.)', 'At risk'], d.byRegion.map((r, i) => [i + 1, r.region, r.count, r.amount, r.atRisk]))} />}>
      <Table columns={columns} rows={d.byRegion} rowKey={(r) => r.region} serial pageSize={10} caption="Region-wise position" emptyTitle="No instruments yet" />
    </Panel>
  );
}

export function Banks({ d, base }: { d: DashboardData; base: Base }) {
  const columns: Column<BankRow>[] = [
    { key: 'bank', header: 'Bank', className: 'whitespace-nowrap', sortValue: (b) => b.bank, cell: (b) => <Link className="gov-link" to={registerLink(base, { bank: b.bank })}>{b.bank}</Link> },
    { key: 'count', header: 'No.', align: 'right', sortValue: (b) => b.count, cell: (b) => b.count },
    { key: 'verified', header: 'Verified', align: 'right', sortValue: (b) => b.verified, cell: (b) => b.verified },
    {
      key: 'rate', header: 'Mismatch rate', align: 'right', sortValue: (b) => b.mismatchRate,
      cell: (b) => <span title={`${b.mismatches} of ${b.verifications} conclusive bank responses; ${b.discrepancies} discrepancies`}>{b.mismatchRate === null ? '—' : `${b.mismatchRate}%`}</span>,
    },
    { key: 'unavailable', header: 'Unavailable', align: 'right', sortValue: (b) => b.unavailable, cell: (b) => b.unavailable },
  ];
  return (
    <Panel title="Bank-wise verification"
      actions={<CsvLink onClick={() => downloadCsv(`dashboard-banks-${d.asOf}.csv`, ['Sl. No.', 'Bank', 'No. of instruments', 'Verified', 'Mismatch rate (%)', 'Unavailable'],
        d.byBank.map((b, i) => [i + 1, b.bank, b.count, b.verified, b.mismatchRate ?? '', b.unavailable]))} />}>
      <Table columns={columns} rows={d.byBank} rowKey={(b) => b.bank} serial pageSize={10} search={(b) => b.bank} caption="Bank-wise verification" emptyTitle="No instruments yet" />
    </Panel>
  );
}

export function Alerts({ d }: { d: DashboardData }) {
  const levels = [1, 2, 3];
  return (
    <Panel title={`Open alerts (${d.alerts.total})`} flush actions={<Link to="/alerts" className="text-teal hover:underline">View all</Link>}>
      <table className="gov-table border-0">
        <thead><tr><th scope="col">Escalation level</th><th scope="col" className="text-right!">Open</th></tr></thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l}>
              <td>
                <Link to="/alerts" className="inline-flex items-center gap-1 text-teal hover:underline">
                  {l === 1 ? <Siren className="size-4" aria-hidden /> : <AlertOctagon className={cn('size-4', l === 3 ? 'text-danger-700' : 'text-attn-text')} aria-hidden />}
                  {l === 1 ? 'L1 · Original recipient' : l === 2 ? 'L2 · Approver' : 'L3 · Administrator'}
                </Link>
              </td>
              <td className="num font-semibold">{d.alerts.byLevel[String(l)] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** The three work figures that are not headline numbers: each a link to the list behind it. */
function WorkInProgress({ d, base }: { d: DashboardData; base: Base }) {
  const rows: Array<{ icon: ReactNode; label: string; value: number; note: string; to: string }> = [
    { icon: <Search className="size-4" aria-hidden />, label: 'Pending scrutiny', value: d.kpis.pendingScrutiny, note: 'Submitted or under scrutiny', to: registerLink(base, { status: 'SUBMITTED,UNDER_SCRUTINY' }) },
    { icon: <FileWarning className="size-4" aria-hidden />, label: 'Open discrepancies', value: d.kpis.openDiscrepancies, note: 'The bank and the institution disagree', to: '/reports?preset=discrepancies' },
    { icon: <Flag className="size-4" aria-hidden />, label: 'Advisory flags', value: d.kpis.advisoryFlags, note: 'For closer examination; nothing is blocked', to: '/officer/queue' },
  ];
  return (
    <Panel title="Work in progress" flush>
      <table className="gov-table border-0">
        <caption className="sr-only">Work in progress</caption>
        <thead><tr><th scope="col">Measure</th><th scope="col" className="text-right!">Count</th><th scope="col" className="hidden sm:table-cell">What it means</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td><Link to={r.to} className="inline-flex items-center gap-1.5 font-medium text-teal hover:underline">{r.icon}{r.label}</Link></td>
              <td className="num text-lg font-bold"><CountUp value={r.value} /></td>
              <td className="hidden text-muted sm:table-cell">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** /dashboard: management overview; every figure from the app clock's date (asOf). */
export function Dashboard() {
  const [params, setParams] = useSearchParams();
  const region = params.get('region') ?? '';
  const type = params.get('type') ?? '';
  const meta = useMeta();
  const { user } = useAuth();
  const q = useDashboard({ region, type });
  const d = q.data;
  const base = { region: region || undefined, type: type || undefined };
  const [tab, setTab] = useState('status');

  const set = (key: 'region' | 'type') => (e: ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(params);
    if (e.target.value) next.set(key, e.target.value); else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Dashboard" subtitle="Position of security deposits and FDRs held by AICTE, their verification and maturity."
        actions={d && <span className="rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm font-semibold" data-testid="as-of">As of {formatDateGov(d.asOf)}</span>} />
      <form className="mb-5 flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-surface px-5 py-4" onSubmit={(e) => e.preventDefault()} aria-label="Dashboard filters">
        <div>
          <label htmlFor="dash-region" className="mb-1 block text-sm font-semibold text-ink">Region</label>
          <select id="dash-region" className={selectCls} value={region} onChange={set('region')}>
            <option value="">All regions</option>
            {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dash-type" className="mb-1 block text-sm font-semibold text-ink">Type of instrument</label>
          <select id="dash-type" className={selectCls} value={type} onChange={set('type')}>
            <option value="">All types</option>
            {INSTRUMENT_TYPES.map((t) => <option key={t} value={t}>{INSTRUMENT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        {(region || type) && <Button variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Reset</Button>}
      </form>
      {user?.role === 'admin' && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-surface px-5 py-3">
          <span className="kicker text-muted">App clock</span>
          <ClockControls />
        </div>
      )}
      {q.isError && <Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} title="The dashboard could not be loaded" /></Panel>}
      {q.isLoading && <Panel><LoadingState rows={4} label="Loading the dashboard…" /></Panel>}
      {d && (
        <div className="fade-in space-y-6">
          <div className="grid gap-3 md:grid-cols-3">
            <Kpi edge="navy" icon={<Banknote className="size-4" aria-hidden />} label="Live instruments" value={formatINRCompact(d.kpis.live.amount)}
              sub={`${d.kpis.live.count} instruments`} to={registerLink(base, { status: 'ACTIVE,EXPIRING,MATURED,LAPSED,RELEASE_REQUESTED' })} />
            <Kpi edge="green" icon={<ShieldCheck className="size-4" aria-hidden />} label="Bank-confirmed"
              value={d.kpis.confirmedPct === null ? '—' : <><CountUp value={d.kpis.confirmedPct} />%</>}
              sub={`${formatINRCompact(d.kpis.confirmedAmount)} of the live amount`} to="/reports?preset=pending-verification" />
            <Kpi edge="red" icon={<AlertOctagon className="size-4" aria-hidden />} label="Open escalations (L2+)" value={<CountUp value={d.kpis.openEscalations} />}
              to="/alerts" />
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[
            {
              id: 'status', label: 'Status', content: (
                <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <StatusBreakdown d={d} base={base} />
                  <div className="space-y-6">
                    <Buckets d={d} base={base} />
                    <Alerts d={d} />
                  </div>
                </div>
              ),
            },
            { id: 'work', label: 'Work in progress', content: <WorkInProgress d={d} base={base} /> },
            { id: 'maturity', label: 'Maturity', content: <MaturityChart d={d} /> },
            { id: 'verification', label: 'Verification', content: <Verification d={d} /> },
            { id: 'regions', label: 'Regions', content: <Regions d={d} base={base} /> },
            { id: 'banks', label: 'Banks', content: <Banks d={d} base={base} /> },
          ]} />
        </div>
      )}
    </div>
  );
}
