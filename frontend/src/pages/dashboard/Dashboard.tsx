import { AlertOctagon, BarChart3, CalendarClock, Download, FileWarning, Flag, Search, Siren, Table as TableIcon } from 'lucide-react';
import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar as RBar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import {
  INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS, VERIFICATION_STATES, VERIFICATION_STATE_LABELS, formatINR, formatINRCompact,
  type Dashboard as DashboardData, type InstrumentStatus,
} from '@fdr/shared';
import { useMeta } from '@/api/instruments';
import { toQuery } from '@/api/reporting';
import { useDashboard } from '@/api/reporting';
import { useAuth } from '@/auth/AuthContext';
import { Badge, Button, CountUp, EmptyState, PageHeader, Panel, StatRow, StatTile, StatusChip, Table, Tabs, VerificationChip, type Column } from '@/components';
import { AuditorHome } from './AuditorHome';
import { downloadCsv } from '@/lib/csv';
import { formatDateGov } from '@/lib/format';
import { cn } from '@/lib/cn';

const selectCls = 'h-10 min-w-48 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm';
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

type Base = { region?: string; type?: string };

/** Thin flat bar inside a table cell; the number next to it carries the value (never the bar alone). */
function Bar({ pct }: { pct: number }) {
  return (
    <span className="block h-2 w-full min-w-16 rounded-full bg-strip" aria-hidden>
      <span className="block h-2 rounded-full bg-ink/70" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

function CsvLink({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-ink hover:underline underline-offset-4"><Download className="size-3.5" aria-hidden />Download CSV</button>;
}

function StatusBreakdown({ d, base }: { d: DashboardData; base: Base }) {
  const max = Math.max(...d.byStatus.map((g) => Number(g.amount)), 0);
  return (
    <Panel title="Instruments by status" flush
      actions={<>
        <CsvLink onClick={() => downloadCsv(`dashboard-status-${d.asOf}.csv`, ['Sl. No.', 'Status', 'No. of instruments', 'Amount (Rs.)'],
          d.byStatus.map((g, i) => [i + 1, g.label, g.count, g.amount]))} />
        <Link to={registerLink(base, {})} className="text-ink hover:underline underline-offset-4">View all</Link>
      </>}>
      <table className="gov-table border-0">
        <caption className="sr-only">Instruments by status, with count and amount</caption>
        <thead><tr><th scope="col">Status</th><th scope="col" className="text-right!">No. of instruments</th><th scope="col" className="text-right!">Amount</th><th scope="col" className="hidden w-1/4 sm:table-cell">Share of amount</th></tr></thead>
        <tbody>
          {d.byStatus.map((g) => (
            <tr key={g.key}>
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

function MaturityChart({ d }: { d: DashboardData }) {
  const [asTable, setAsTable] = useState(false);
  const data = d.maturityByMonth.map((m) => ({
    month: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}`,
    crore: Number(m.amount) / 1e7,
    amount: m.amount,
    count: m.count,
  }));
  return (
    <Panel title="Maturing in the next 12 months"
      actions={<>
        <button type="button" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)} className="inline-flex items-center gap-1.5 text-ink hover:underline underline-offset-4">
          {asTable ? <BarChart3 className="size-4" aria-hidden /> : <TableIcon className="size-4" aria-hidden />}{asTable ? 'Show as chart' : 'Show as table'}
        </button>
        <CsvLink onClick={() => downloadCsv(`dashboard-maturity-${d.asOf}.csv`, ['Month', 'No. of instruments', 'Amount (Rs.)'], data.map((r) => [r.month, r.count, r.amount]))} />
      </>}>
      {asTable ? (
        <table className="gov-table">
          <caption className="sr-only">Amount maturing per month</caption>
          <thead><tr><th scope="col">Month</th><th scope="col" className="text-right!">No.</th><th scope="col" className="text-right!">Amount</th></tr></thead>
          <tbody>{data.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num">{r.count}</td><td className="num">{formatINRCompact(r.amount)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="h-64 min-w-0" role="img" aria-label="Bar chart of the amount maturing in each of the next 12 months, in crore rupees; use Show as table for the values">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 24, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#dde3ea' }} tick={{ fontSize: 14, fill: '#475569' }} interval={0} minTickGap={0} />
              <Tooltip cursor={{ fill: '#f1f4f8' }} formatter={(_v, _n, p) => [`${formatINR(p.payload.amount as string)} · ${p.payload.count as number} instrument(s)`, 'Maturing']} />
              <RBar dataKey="crore" fill="#1d4ed8" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                <LabelList dataKey="crore" position="top" formatter={(v: unknown) => (Number(v) > 0 ? `${Number(v) < 10 ? Number(v).toFixed(1) : Math.round(Number(v))}` : '')} style={{ fontSize: 14, fill: '#1f2937' }} />
              </RBar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {!asTable && <p className="mt-2 text-sm text-slate-600">Values in ₹ crore.</p>}
    </Panel>
  );
}

/** The few things that need someone to act, each with its count and a link. */
function NeedsAttention({ d, base }: { d: DashboardData; base: Base }) {
  const overdue = d.maturityBuckets.find((b) => b.key === 'overdue');
  const soon = d.maturityBuckets.find((b) => b.key === 'd0_30');
  const rows: { icon: ReactNode; label: string; count: number; to: string; tone?: string }[] = [
    { icon: <AlertOctagon className="size-4" aria-hidden />, label: 'Matured or lapsed, not yet renewed or released', count: overdue?.count ?? 0, to: registerLink(base, { status: 'MATURED,LAPSED' }), tone: 'text-danger-700' },
    { icon: <FileWarning className="size-4" aria-hidden />, label: 'Open discrepancies', count: d.kpis.openDiscrepancies, to: '/reports?preset=discrepancies', tone: 'text-danger-700' },
    { icon: <Siren className="size-4" aria-hidden />, label: 'Escalations at approver or admin level', count: d.kpis.openEscalations, to: '/alerts', tone: 'text-warning-700' },
    { icon: <CalendarClock className="size-4" aria-hidden />, label: 'Maturing within 30 days', count: soon?.count ?? 0, to: registerLink(base, { status: 'ACTIVE,EXPIRING,RELEASE_REQUESTED', maturityFrom: d.asOf, maturityTo: addDays(d.asOf, 30) }), tone: 'text-warning-700' },
    { icon: <Flag className="size-4" aria-hidden />, label: 'Advisory flags for closer examination', count: d.kpis.advisoryFlags, to: '/officer/queue' },
  ];
  return (
    <Panel title="Needs attention" flush>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.label}>
            <Link to={r.to} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#f8fafc]">
              <span className={r.count > 0 ? (r.tone ?? 'text-ink') : 'text-slate-400'}>{r.icon}</span>
              <span className="min-w-0 flex-1 text-slate-800">{r.label}</span>
              <span className={cn('text-xl font-semibold tabular-nums', r.count > 0 ? 'text-slate-900' : 'text-slate-400')}>{r.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Buckets({ d, base }: { d: DashboardData; base: Base }) {
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
                <Link to={registerLink(base, range[b.key])} className={cn('inline-flex items-center gap-1 hover:underline', b.key === 'overdue' && b.count > 0 ? 'font-semibold text-danger-700' : 'text-link')}>
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

function Verification({ d }: { d: DashboardData }) {
  const total = VERIFICATION_STATES.reduce((s, v) => s + d.verification.byState[v], 0);
  return (
    <Panel title="Verification (submitted instruments)" flush actions={<Link to="/reports?preset=pending-verification" className="text-ink hover:underline underline-offset-4">View all</Link>}>
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
      <p className="border-t border-line px-5 py-3 text-sm text-slate-700">Accepted without bank confirmation (override): <strong className="tabular-nums">{d.verification.acceptedWithOverride}</strong></p>
    </Panel>
  );
}

type RegionRow = DashboardData['byRegion'][number];
type BankRow = DashboardData['byBank'][number];

function Regions({ d, base }: { d: DashboardData; base: Base }) {
  const columns: Column<RegionRow>[] = [
    { key: 'region', header: 'Region', sortValue: (r) => r.region, cell: (r) => <Link className="gov-link" to={`/institutions?region=${encodeURIComponent(r.region)}`}>{r.region}</Link> },
    { key: 'count', header: 'No. of instruments', align: 'right', sortValue: (r) => r.count, cell: (r) => r.count },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => Number(r.amount), cell: (r) => formatINRCompact(r.amount) },
    {
      key: 'risk', header: 'At risk', align: 'right', sortValue: (r) => r.atRisk,
      cell: (r) => r.atRisk > 0
        ? <Link to={registerLink({ ...base, region: r.region }, { status: 'EXPIRING,MATURED,LAPSED' })} className="inline-flex items-center gap-1 font-semibold text-danger-700 hover:underline"><AlertOctagon className="size-3.5" aria-hidden />{r.atRisk} at risk</Link>
        : <span className="text-slate-700">0</span>,
    },
  ];
  return (
    <Panel title="Region-wise position (current instruments)"
      actions={<CsvLink onClick={() => downloadCsv(`dashboard-regions-${d.asOf}.csv`, ['Sl. No.', 'Region', 'No. of instruments', 'Amount (Rs.)', 'At risk'], d.byRegion.map((r, i) => [i + 1, r.region, r.count, r.amount, r.atRisk]))} />}>
      <Table columns={columns} rows={d.byRegion} rowKey={(r) => r.region} pageSize={10} caption="Region-wise position" emptyTitle="No instruments yet" />
    </Panel>
  );
}

function Banks({ d, base }: { d: DashboardData; base: Base }) {
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
      <Table columns={columns} rows={d.byBank} rowKey={(b) => b.bank} pageSize={10} search={(b) => b.bank} caption="Bank-wise verification" emptyTitle="No instruments yet" />
    </Panel>
  );
}

function Alerts({ d }: { d: DashboardData }) {
  const levels = [1, 2, 3];
  return (
    <Panel title={`Open alerts (${d.alerts.total})`} flush actions={<Link to="/alerts" className="text-ink hover:underline underline-offset-4">View all</Link>}>
      <table className="gov-table border-0">
        <thead><tr><th scope="col">Escalation level</th><th scope="col" className="text-right!">Open</th></tr></thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l}>
              <td>
                <Link to="/alerts" className="inline-flex items-center gap-1 text-link hover:underline">
                  {l === 1 ? <Siren className="size-4" aria-hidden /> : <AlertOctagon className={cn('size-4', l === 3 ? 'text-danger-700' : 'text-warning-700')} aria-hidden />}
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

const TABS = ['Status', 'Maturity', 'Verification', 'Regions', 'Banks', 'Alerts'] as const;

/** /dashboard: four numbers, the maturity chart, what needs attention, then the detail panels in tabs. */
export function Dashboard() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const region = params.get('region') ?? '';
  const type = params.get('type') ?? '';
  const tab = params.get('tab') ?? 'status';
  const meta = useMeta();
  const q = useDashboard({ region, type });
  const d = q.data;
  const base = { region: region || undefined, type: type || undefined };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const set = (key: 'region' | 'type') => (e: ChangeEvent<HTMLSelectElement>) => setParam(key, e.target.value);

  if (user?.role === 'auditor') return <AuditorHome d={d} />;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Deposits held by AICTE across all regions, as of the app date."
        actions={d && <span className="rounded-full bg-strip px-3 py-1.5 text-sm text-slate-700" data-testid="as-of">As of {formatDateGov(d.asOf)}</span>} />
      <form className="mb-8 flex flex-wrap items-end gap-4" onSubmit={(e) => e.preventDefault()} aria-label="Dashboard filters">
        <div>
          <label htmlFor="dash-region" className="mb-1.5 block text-sm font-medium text-slate-700">Region</label>
          <select id="dash-region" className={selectCls} value={region} onChange={set('region')}>
            <option value="">All regions</option>
            {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dash-type" className="mb-1.5 block text-sm font-medium text-slate-700">Type of instrument</label>
          <select id="dash-type" className={selectCls} value={type} onChange={set('type')}>
            <option value="">All types</option>
            {INSTRUMENT_TYPES.map((t) => <option key={t} value={t}>{INSTRUMENT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        {(region || type) && <Button variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>}
      </form>
      {q.isError && <EmptyState title="Could not load the dashboard" description={q.error.message} />}
      {d && (
        <div className="fade-in space-y-10">
          <StatRow cols={4}>
            <StatTile label="Live instruments" value={formatINRCompact(d.kpis.live.amount)} note={`${d.kpis.live.count} instruments`}
              to={registerLink(base, { status: 'ACTIVE,EXPIRING,MATURED,LAPSED,RELEASE_REQUESTED' })} />
            <StatTile label="Bank-confirmed" value={d.kpis.confirmedPct === null ? '—' : <><CountUp value={d.kpis.confirmedPct} />%</>}
              note={`${formatINRCompact(d.kpis.confirmedAmount)} of the live amount`} to="/reports?preset=pending-verification" />
            <StatTile label="Pending scrutiny" value={<CountUp value={d.kpis.pendingScrutiny} />} to={registerLink(base, { status: 'SUBMITTED,UNDER_SCRUTINY' })} />
            <StatTile label="Open escalations" value={<CountUp value={d.kpis.openEscalations} />} tone={d.kpis.openEscalations ? 'warning' : undefined} note="Approver or admin level" to="/alerts" />
          </StatRow>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <MaturityChart d={d} />
            <NeedsAttention d={d} base={base} />
          </div>
          <section aria-label="Details">
            <Tabs value={tab} onChange={(id) => setParam('tab', id === 'status' ? '' : id)}
              tabs={TABS.map((t) => ({
                id: t.toLowerCase(),
                label: t,
                content: t === 'Status' ? <StatusBreakdown d={d} base={base} />
                  : t === 'Maturity' ? <Buckets d={d} base={base} />
                  : t === 'Verification' ? <Verification d={d} />
                  : t === 'Regions' ? <Regions d={d} base={base} />
                  : t === 'Banks' ? <Banks d={d} base={base} />
                  : <Alerts d={d} />,
              }))} />
          </section>
        </div>
      )}
    </>
  );
}
