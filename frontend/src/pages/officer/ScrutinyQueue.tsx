import { AlertTriangle, Clock, Hand, TimerOff } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { VERIFICATION_STATES, VERIFICATION_STATE_LABELS, type QueueItem } from '@fdr/shared';
import { useMeta } from '@/api/instruments';
import { useClaim, useQueue } from '@/api/scrutiny';
import { useAuth } from '@/auth/AuthContext';
import { Button, DateText, Money, PageHeader, StatusChip, Table, VerificationChip, WorstAlertChip, useToast, type Column } from '@/components';

/** Days since submission: amber after 5, red after 10 (icon + text, never colour alone). */
export function Ageing({ days }: { days: number | null }) {
  if (days === null) return <span className="text-slate-400">—</span>;
  const label = `${days} d`;
  if (days > 10) return <span className="inline-flex items-center gap-1 font-medium text-danger-700"><TimerOff className="size-3.5" aria-hidden />{label} · overdue</span>;
  if (days > 5) return <span className="inline-flex items-center gap-1 font-medium text-warning-700"><Clock className="size-3.5" aria-hidden />{label} · ageing</span>;
  return <span className="tabular-nums">{label}</span>;
}

const selectCls = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm';

export function ScrutinyQueue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const meta = useMeta();
  const [filters, setFilters] = useState({ region: '', bank: '', verificationState: '', assigned: 'all' });
  const [page, setPage] = useState(1);
  const q = useQueue({ ...filters, page, pageSize: 25 });
  const claim = useClaim();
  const isOfficer = user?.role === 'officer';

  const set = (key: keyof typeof filters) => (e: ChangeEvent<HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const onClaim = (row: QueueItem) =>
    claim.mutate(row.id, {
      onSuccess: () => { toast.success(`You took up ${row.referenceNo}`); navigate(`/officer/review/${row.id}`); },
      onError: (err) => toast.error(err.message),
    });

  const columns: Column<QueueItem>[] = [
    { key: 'institution', header: 'Institution', sortValue: (r) => r.institution, cell: (r) => <div><p className="font-medium">{r.institution}</p><p className="text-xs text-slate-500">{r.region}</p></div> },
    {
      key: 'ref', header: 'Reference', sortValue: (r) => r.referenceNo,
      cell: (r) => (
        <div className="space-y-1">
          <Link to={`/officer/review/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium whitespace-nowrap text-primary-700 hover:underline">{r.referenceNo}</Link>
          <div><StatusChip status={r.status} /></div>
        </div>
      ),
    },
    { key: 'bank', header: 'Bank', sortValue: (r) => r.issuingBank, cell: (r) => r.issuingBank },
    { key: 'amount', header: 'Amount', align: 'right', className: 'whitespace-nowrap', sortValue: (r) => Number(r.amount ?? 0), cell: (r) => <Money amount={r.amount} /> },
    {
      key: 'submitted', header: 'Submitted · ageing', className: 'whitespace-nowrap', sortValue: (r) => r.ageingDays,
      cell: (r) => <div><DateText value={r.submittedAt} /><div className="text-xs"><Ageing days={r.ageingDays} /></div></div>,
    },
    { key: 'verification', header: 'Verification', cell: (r) => <VerificationChip state={r.verificationState} /> },
    { key: 'alerts', header: 'Alerts', sortValue: (r) => r.worstOpenAlertLevel, cell: (r) => <WorstAlertChip level={r.worstOpenAlertLevel} count={r.openAlertCount} /> },
    {
      key: 'disc', header: 'Discrepancies', align: 'right', className: 'whitespace-nowrap', sortValue: (r) => r.openDiscrepancies,
      cell: (r) => r.openDiscrepancies ? <span className="inline-flex items-center gap-1 font-medium text-danger-700"><AlertTriangle className="size-3.5" aria-hidden />{r.openDiscrepancies} open</span> : <span className="text-slate-400">None</span>,
    },
    {
      key: 'officer', header: 'Assigned officer', className: 'whitespace-nowrap',
      cell: (r) => r.assignedOfficerId
        ? <span>{r.assignedOfficerId === user?.id ? 'You' : r.assignedOfficerName}</span>
        : isOfficer && r.status === 'SUBMITTED'
          ? <Button size="sm" variant="secondary" icon={<Hand className="size-4" aria-hidden />} loading={claim.isPending && claim.variables === r.id}
              onClick={(e) => { e.stopPropagation(); onClaim(r); }}>Claim</Button>
          : <span className="text-slate-400">Unassigned</span>,
    },
  ];

  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <PageHeader title="Scrutiny queue" subtitle="Submitted instruments waiting for scrutiny, oldest first. Claim a case to review it." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">Region<br />
          <select className={selectCls} value={filters.region} onChange={set('region')}>
            <option value="">All regions</option>
            {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">Bank<br />
          <select className={selectCls} value={filters.bank} onChange={set('bank')}>
            <option value="">All banks</option>
            {meta.data?.banks.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">Verification<br />
          <select className={selectCls} value={filters.verificationState} onChange={set('verificationState')}>
            <option value="">Any</option>
            {VERIFICATION_STATES.map((s) => <option key={s} value={s}>{VERIFICATION_STATE_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">Assigned<br />
          <select className={selectCls} value={filters.assigned} onChange={set('assigned')}>
            <option value="all">Everyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
      </div>
      <Table
        caption="Scrutiny queue"
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        onRowClick={(r) => navigate(`/officer/review/${r.id}`)}
        emptyTitle="The queue is empty"
        emptyDescription="No submitted instruments match these filters."
      />
      {total > 25 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}
