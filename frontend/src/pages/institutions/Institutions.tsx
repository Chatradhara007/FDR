import { AlertOctagon, Search } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { BackLink } from '@/components/PageHeader';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS, formatINRCompact, type InstitutionSummary, type InstrumentListItem, type InstrumentStatus } from '@fdr/shared';
import { useMeta } from '@/api/instruments';
import { useInstitution, useInstitutions } from '@/api/reporting';
import { useAuth } from '@/auth/AuthContext';
import {
  AlertKindChip, AlertLevelChip, DateText, EmptyState, ErrorState, KeyValue, LoadingState, Money, PageHeader, Panel, StatChip, StatusChip, Table, Tabs,
  TrustBadge, WorstAlertChip, type Column,
} from '@/components';
import { ReleaseTable } from '@/pages/releases/ReleaseList';

const SHOWN: InstrumentStatus[] = ['ACTIVE', 'EXPIRING', 'MATURED', 'LAPSED', 'RELEASE_REQUESTED', 'SUBMITTED', 'UNDER_SCRUTINY', 'RETURNED', 'RENEWED', 'RELEASED'];

function Problems({ s }: { s: InstitutionSummary }) {
  const p = s.openProblems;
  if (p.total === 0) return <span className="text-muted">None</span>;
  const parts = [
    p.openDiscrepancies && `${p.openDiscrepancies} discrepancy`, p.overdue && `${p.overdue} overdue`,
    p.returned && `${p.returned} returned`, p.openAlerts && `${p.openAlerts} alerts`,
  ].filter(Boolean);
  return <span className="inline-flex items-center gap-1 font-medium text-danger-700"><AlertOctagon className="size-3.5" aria-hidden />{parts.join(' · ')}</span>;
}

function count(s: InstitutionSummary, st: InstrumentStatus) {
  return s.byStatus[st]?.count ?? 0;
}

/** /institutions: the institution register with counts per status and open problems. */
export function Institutions() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const meta = useMeta();
  const region = params.get('region') ?? '';
  const search = params.get('q') ?? '';
  const q = useInstitutions({ region, q: search, pageSize: 100 });
  const set = (key: string) => (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const next = new URLSearchParams(params);
    if (e.target.value) next.set(key, e.target.value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const columns: Column<InstitutionSummary>[] = [
    { key: 'name', header: 'Institution', sortValue: (r) => r.name, cell: (r) => <Link className="font-semibold text-teal hover:underline" onClick={(e) => e.stopPropagation()} to={`/institutions/${r.id}`}>{r.name}</Link> },
    { key: 'region', header: 'Region · state', sortValue: (r) => r.region, cell: (r) => `${r.region} · ${r.state}` },
    { key: 'live', header: 'Live', align: 'right', sortValue: (r) => Number(r.liveAmount), cell: (r) => <>{r.liveCount} · {formatINRCompact(r.liveAmount)}</> },
    { key: 'exp', header: 'Expiring', align: 'right', sortValue: (r) => count(r, 'EXPIRING'), cell: (r) => count(r, 'EXPIRING') },
    { key: 'pending', header: 'In scrutiny', align: 'right', cell: (r) => count(r, 'SUBMITTED') + count(r, 'UNDER_SCRUTINY') },
    { key: 'released', header: 'Released', align: 'right', cell: (r) => count(r, 'RELEASED') },
    { key: 'problems', header: 'Open problems', sortValue: (r) => r.openProblems.total, cell: (r) => <Problems s={r} /> },
  ];
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Institutions" subtitle="Every institution with its deposits, renewals, releases and open problems." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search institutions</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input key={search} className="gov-input pl-10" placeholder="Search name or AICTE id" defaultValue={search} onBlur={set('q')}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">Region
          <select className="gov-input w-auto" value={region} onChange={set('region')}>
            <option value="">All regions</option>
            {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      </div>
      <Table columns={columns} rows={q.data?.items} rowKey={(r) => r.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
        onRowClick={(r) => navigate(`/institutions/${r.id}`)} emptyTitle="No institution matches" emptyDescription="Try another name or region." caption="Institutions" />
    </div>
  );
}

/** /institutions/:id: the centralised repository for one institution. */
export function InstitutionProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const q = useInstitution(id);
  const [tab, setTab] = useState('deposits');
  const back = user?.role !== 'institution' ? { to: '/institutions', label: 'Institutions' } : undefined;
  if (q.isError) return <div className="mx-auto max-w-[1240px]">{back && <BackLink {...back} />}<Panel><ErrorState error={q.error} title="Institution not found" /></Panel></div>;
  if (!q.data) return <div className="mx-auto max-w-[1240px]"><Panel><LoadingState rows={4} label="Loading the institution…" /></Panel></div>;
  const { institution: s, instruments, alerts, releaseRequests } = q.data;
  const columns: Column<InstrumentListItem>[] = [
    {
      key: 'ref', header: 'Reference', sortValue: (r) => r.referenceNo, cell: (r) => (
        <>
          <Link className="mono font-medium text-teal hover:underline" to={`/instruments/${r.id}`}>{r.referenceNo ?? '(draft)'}</Link>
          <span className="block text-[0.8125rem] text-muted">{INSTRUMENT_TYPE_LABELS[r.type]} · {r.issuingBank ?? '—'}</span>
        </>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => Number(r.amount ?? 0), cell: (r) => <Money amount={r.amount} /> },
    { key: 'maturity', header: 'Maturity', className: 'whitespace-nowrap', sortValue: (r) => r.maturityDate, cell: (r) => (r.maturityDate ? <DateText value={r.maturityDate} /> : '—') },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusChip status={r.status} /> },
    { key: 'proof', header: 'Weakest proof', cell: (r) => (r.weakestTier ? <TrustBadge tier={r.weakestTier} short /> : '—') },
    { key: 'alerts', header: 'Alerts', cell: (r) => <WorstAlertChip level={r.worstOpenAlertLevel} count={r.openAlertCount} /> },
  ];
  const expiring = count(s, 'EXPIRING');
  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader back={back} title={s.name} subtitle={<><span className="mono">{s.aicteId}</span> · {s.region} · {s.state}</>} />
      <div className="mb-6 flex flex-wrap gap-2">
        <StatChip value={formatINRCompact(s.liveAmount)} label={`held in ${s.liveCount} live deposit${s.liveCount === 1 ? '' : 's'}`} />
        <StatChip value={expiring} label="expiring" tone={expiring ? 'attention' : 'plain'} />
        <StatChip value={s.openProblems.total} label={s.openProblems.total === 1 ? 'open problem' : 'open problems'} tone={s.openProblems.total ? 'attention' : 'plain'} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        {
          id: 'deposits', label: `Deposits (${instruments.length})`,
          content: <Table columns={columns} rows={instruments} rowKey={(r) => r.id} emptyTitle="No deposits yet" emptyDescription="Deposits appear here once the institution lodges one." caption="Deposits of this institution" />,
        },
        {
          id: 'alerts', label: `Open alerts (${alerts.length})`,
          content: (
            <Panel flush>
              {alerts.length === 0 ? <EmptyState title="No open alerts" description="Nothing about this institution needs attention right now." /> : (
                <ul>
                  {alerts.map((a) => (
                    <li key={a.id} className="border-b border-hairline px-6 py-4 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertKindChip kind={a.kind} />
                        <AlertLevelChip level={a.level} role={a.level > 1 ? a.recipientRole : undefined} />
                        <Link to={`/instruments/${a.instrumentId}`} className="mono font-medium text-teal hover:underline">{a.referenceNo ?? 'Instrument'}</Link>
                        <span className="text-[0.8125rem] text-muted">Due <DateText value={a.dueDate} /></span>
                      </div>
                      <p className="mt-1 text-[0.9375rem] text-ink">{a.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ),
        },
        { id: 'releases', label: `Release requests (${releaseRequests.length})`, content: <ReleaseTable rows={releaseRequests} loading={false} emptyTitle="No release requests" /> },
        {
          id: 'profile', label: 'Profile',
          content: (
            <Panel>
              <KeyValue items={[
                { label: 'AICTE id', value: <span className="mono">{s.aicteId}</span> }, { label: 'Region', value: s.region }, { label: 'State', value: s.state },
                { label: 'Contact', value: s.contactEmail ?? '—' }, { label: 'Open problems', value: <Problems s={s} /> },
              ]} />
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Deposits by status">
                {SHOWN.filter((st) => count(s, st) > 0).map((st) => <li key={st} className="inline-flex items-center gap-1"><StatusChip status={st} /><span className="text-sm tabular-nums">{count(s, st)}</span></li>)}
              </ul>
            </Panel>
          ),
        },
      ]} />
    </div>
  );
}
