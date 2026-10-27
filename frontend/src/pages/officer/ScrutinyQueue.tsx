import { Clock, Hand, TimerOff } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { VERIFICATION_STATES, VERIFICATION_STATE_LABELS, type QueueItem } from '@fdr/shared';
import { useMeta } from '@/api/instruments';
import { useClaim, useQueue } from '@/api/scrutiny';
import { useAuth } from '@/auth/AuthContext';
import { Button, DateText, Money, PageHeader, Pager, ReasonChip, StatusChip, Table, VerificationChip, useToast, type Column, type Reason } from '@/components';

/** Days since submission: attention after 5, danger after 10 (icon + text, never colour alone). */
export function Ageing({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted">—</span>;
  const label = `${days} d`;
  if (days > 10) return <span className="inline-flex items-center gap-1 font-medium text-danger-700"><TimerOff className="size-3.5" aria-hidden />{label} · overdue</span>;
  if (days > 5) return <span className="inline-flex items-center gap-1 font-medium text-attn-text"><Clock className="size-3.5" aria-hidden />{label} · ageing</span>;
  return <span className="tabular-nums">{label}</span>;
}

/** Why a case needs attention, as the same reason chips the officer desk uses. */
function reasonsOf(r: QueueItem): Reason[] {
  const out: Reason[] = [];
  if (r.openDiscrepancies) out.push({ text: `${r.openDiscrepancies} open discrepanc${r.openDiscrepancies === 1 ? 'y' : 'ies'}`, urgent: true });
  if (r.ageingDays !== null && r.ageingDays > 10) out.push({ text: `Waiting ${r.ageingDays} days`, urgent: true });
  else if (r.ageingDays !== null && r.ageingDays > 5) out.push({ text: `Waiting ${r.ageingDays} days` });
  if (r.openAlertCount) out.push({ text: `${r.openAlertCount} open alert${r.openAlertCount === 1 ? '' : 's'}`, urgent: (r.worstOpenAlertLevel ?? 0) >= 2 });
  return out;
}

const selectCls = 'gov-input mt-1 block w-auto';
const labelCls = 'text-sm font-semibold text-ink';

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
    {
      key: 'deposit', header: 'Deposit', sortValue: (r) => r.institution,
      cell: (r) => (
        <div className="min-w-[14rem]">
          <p className="font-semibold">{r.institution}</p>
          <p className="text-[0.8125rem] text-muted">
            <Link to={`/instruments/${r.id}`} title="Open passport" onClick={(e) => e.stopPropagation()} className="mono text-teal hover:underline">{r.referenceNo}</Link>
            {' · '}{r.issuingBank} · {r.region}
          </p>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', className: 'whitespace-nowrap', sortValue: (r) => Number(r.amount ?? 0), cell: (r) => <Money amount={r.amount} /> },
    {
      key: 'submitted', header: 'Submitted', className: 'whitespace-nowrap', sortValue: (r) => r.ageingDays,
      cell: (r) => <div><DateText value={r.submittedAt} /><div className="text-[0.8125rem]"><Ageing days={r.ageingDays} /></div></div>,
    },
    {
      key: 'why', header: 'Needs attention', cell: (r) => {
        const reasons = reasonsOf(r);
        return reasons.length ? <div className="flex flex-wrap gap-1.5">{reasons.map((x) => <ReasonChip key={x.text} reason={x} />)}</div> : <span className="text-muted">Nothing flagged</span>;
      },
    },
    { key: 'state', header: 'Status', cell: (r) => <div className="flex flex-col items-start gap-1"><StatusChip status={r.status} /><VerificationChip state={r.verificationState} /></div> },
    {
      key: 'officer', header: 'Officer', className: 'whitespace-nowrap',
      cell: (r) => r.assignedOfficerId
        ? <span>{r.assignedOfficerId === user?.id ? 'You' : r.assignedOfficerName}</span>
        : isOfficer && r.status === 'SUBMITTED'
          ? <Button size="sm" variant="secondary" icon={<Hand className="size-4" aria-hidden />} loading={claim.isPending && claim.variables === r.id}
              onClick={(e) => { e.stopPropagation(); onClaim(r); }}>Claim</Button>
          : <span className="text-muted">Unassigned</span>,
    },
  ];

  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Scrutiny queue" subtitle="Submitted deposits waiting for scrutiny, oldest first. Claim a case to review it." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className={labelCls}>Region
          <select className={selectCls} value={filters.region} onChange={set('region')}>
            <option value="">All regions</option>
            {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className={labelCls}>Bank
          <select className={selectCls} value={filters.bank} onChange={set('bank')}>
            <option value="">All banks</option>
            {meta.data?.banks.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className={labelCls}>Verification
          <select className={selectCls} value={filters.verificationState} onChange={set('verificationState')}>
            <option value="">Any</option>
            {VERIFICATION_STATES.map((s) => <option key={s} value={s}>{VERIFICATION_STATE_LABELS[s]}</option>)}
          </select>
        </label>
        <label className={labelCls}>Assigned
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
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => navigate(`/officer/review/${r.id}`)}
        emptyTitle="The queue is empty"
        emptyDescription="No submitted instruments match these filters."
      />
      <Pager page={page} pages={pages} onPage={setPage} total={q.data?.total} noun="cases" />
    </div>
  );
}
