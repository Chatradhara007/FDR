import { AlertOctagon, ArrowLeft } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS, formatINRCompact, type InstitutionSummary, type InstrumentListItem, type InstrumentStatus } from '@fdr/shared';
import { useMeta } from '@/api/instruments';
import { useInstitution, useInstitutions } from '@/api/reporting';
import { useAuth } from '@/auth/AuthContext';
import {
  AlertKindChip, AlertLevelChip, Card, DateText, EmptyState, KeyValue, Money, PageHeader, StatusChip, Table, VerificationChip, WorstAlertChip,
  type Column,
} from '@/components';
import { ReleaseTable } from '@/pages/releases/ReleaseList';

const selectCls = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm';
const SHOWN: InstrumentStatus[] = ['ACTIVE', 'EXPIRING', 'MATURED', 'LAPSED', 'RELEASE_REQUESTED', 'SUBMITTED', 'UNDER_SCRUTINY', 'RETURNED', 'RENEWED', 'RELEASED'];

function Problems({ s }: { s: InstitutionSummary }) {
  const p = s.openProblems;
  if (p.total === 0) return <span className="text-slate-500">None</span>;
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
    { key: 'name', header: 'Institution', sortValue: (r) => r.name, cell: (r) => <Link className="font-medium text-primary-700 hover:underline" to={`/institutions/${r.id}`}>{r.name}</Link> },
    { key: 'region', header: 'Region · state', sortValue: (r) => r.region, cell: (r) => `${r.region} · ${r.state}` },
    { key: 'live', header: 'Live', align: 'right', sortValue: (r) => Number(r.liveAmount), cell: (r) => <>{r.liveCount} · {formatINRCompact(r.liveAmount)}</> },
    { key: 'exp', header: 'Expiring', align: 'right', sortValue: (r) => count(r, 'EXPIRING'), cell: (r) => count(r, 'EXPIRING') },
    { key: 'pending', header: 'In scrutiny', align: 'right', cell: (r) => count(r, 'SUBMITTED') + count(r, 'UNDER_SCRUTINY') },
    { key: 'released', header: 'Released', align: 'right', cell: (r) => count(r, 'RELEASED') },
    { key: 'problems', header: 'Open problems', sortValue: (r) => r.openProblems.total, cell: (r) => <Problems s={r} /> },
  ];
  return (
    <>
      <PageHeader title="Institutions" subtitle="Institution-wise view of every instrument, renewal and release." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Region<br />
          <select className={selectCls} value={region} onChange={set('region')}>
            <option value="">All regions</option>
            {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="text-sm">Search<br /><input className={selectCls} placeholder="Name or AICTE id" defaultValue={search} onBlur={set('q')} /></label>
      </div>
      <Table columns={columns} rows={q.data?.items} rowKey={(r) => r.id} loading={q.isLoading} onRowClick={(r) => navigate(`/institutions/${r.id}`)}
        emptyTitle="No institution matches" caption="Institutions" />
    </>
  );
}

/** /institutions/:id: the centralised repository for one institution. */
export function InstitutionProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const q = useInstitution(id);
  if (q.isError) return <EmptyState title="Institution not found" description={q.error.message} />;
  if (!q.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { institution: s, instruments, alerts, releaseRequests } = q.data;
  const columns: Column<InstrumentListItem>[] = [
    { key: 'ref', header: 'Reference', sortValue: (r) => r.referenceNo, cell: (r) => <Link className="font-medium text-primary-700 hover:underline" to={`/instruments/${r.id}`}>{r.referenceNo ?? '(draft)'}</Link> },
    { key: 'type', header: 'Type', cell: (r) => INSTRUMENT_TYPE_LABELS[r.type] },
    { key: 'bank', header: 'Bank', cell: (r) => r.issuingBank ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => Number(r.amount ?? 0), cell: (r) => <Money amount={r.amount} /> },
    { key: 'maturity', header: 'Maturity', sortValue: (r) => r.maturityDate, cell: (r) => (r.maturityDate ? <DateText value={r.maturityDate} /> : '—') },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, cell: (r) => <StatusChip status={r.status} /> },
    { key: 'ver', header: 'Verification', cell: (r) => <VerificationChip state={r.verificationState} /> },
    { key: 'alerts', header: 'Alerts', cell: (r) => <WorstAlertChip level={r.worstOpenAlertLevel} count={r.openAlertCount} /> },
  ];
  return (
    <>
      {user?.role !== 'institution' && <Link to="/institutions" className="mb-2 inline-flex items-center gap-1 text-sm text-primary-700 hover:underline"><ArrowLeft className="size-4" aria-hidden />All institutions</Link>}
      <PageHeader title={s.name} subtitle={`${s.aicteId} · ${s.region} · ${s.state}`} />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <KeyValue items={[
            { label: 'AICTE id', value: s.aicteId }, { label: 'Region', value: s.region }, { label: 'State', value: s.state },
            { label: 'Contact', value: s.contactEmail ?? '—' },
          ]} />
        </Card>
        <Card title="Holdings">
          <p className="text-2xl font-semibold tabular-nums">{formatINRCompact(s.liveAmount)}</p>
          <p className="text-sm text-slate-600">{s.liveCount} live instrument(s)</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {SHOWN.filter((st) => count(s, st) > 0).map((st) => <li key={st} className="inline-flex items-center gap-1"><StatusChip status={st} /><span className="text-sm tabular-nums">{count(s, st)}</span></li>)}
          </ul>
        </Card>
        <Card title="Open problems"><Problems s={s} /></Card>
      </div>
      <div className="space-y-4">
        <Card title={`Instruments (${instruments.length})`}>
          <Table columns={columns} rows={instruments} rowKey={(r) => r.id} emptyTitle="No instruments yet" caption="Instruments of this institution" />
        </Card>
        <Card title={`Open alerts (${alerts.length})`}>
          {alerts.length === 0 ? <p className="text-sm text-slate-500">No open alerts.</p> : (
            <ul className="divide-y divide-slate-100">
              {alerts.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertKindChip kind={a.kind} />
                    <AlertLevelChip level={a.level} role={a.level > 1 ? a.recipientRole : undefined} />
                    <Link to={`/instruments/${a.instrumentId}`} className="font-medium text-primary-700 hover:underline">{a.referenceNo ?? 'Instrument'}</Link>
                    <span className="text-xs text-slate-500">Due <DateText value={a.dueDate} /></span>
                  </div>
                  <p className="mt-1 text-slate-700">{a.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Release requests (${releaseRequests.length})`}>
          <ReleaseTable rows={releaseRequests} loading={false} emptyTitle="No release requests" />
        </Card>
      </div>
    </>
  );
}
