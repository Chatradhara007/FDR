import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS, type ReleaseListItem } from '@fdr/shared';
import { useReleaseRequests } from '@/api/releases';
import { useAuth } from '@/auth/AuthContext';
import { Money, PageHeader, ReleaseStatusChip, Table, Tabs, type Column } from '@/components';

const FILTERS = {
  mine: { label: 'Waiting for me', params: { awaitingMe: true } },
  open: { label: 'Open', params: { status: 'PENDING_CONDITIONS,PENDING_APPROVAL,RETURNED' } },
  closed: { label: 'Closed', params: { status: 'APPROVED,REJECTED,CANCELLED' } },
  all: { label: 'All', params: {} },
} as const;

type Filter = keyof typeof FILTERS;

export function releasePath(role: string | undefined, id: string) {
  return role === 'approver' ? `/approver/releases/${id}` : `/officer/releases/${id}`;
}

/** Days at the current level (amber after 5 — the RELEASE_PENDING threshold; icon + text). */
function Waiting({ r }: { r: ReleaseListItem }) {
  if (r.status !== 'PENDING_CONDITIONS' && r.status !== 'PENDING_APPROVAL') return <span className="text-muted">—</span>;
  const label = `${r.ageDays} d at L${r.currentLevel}`;
  return r.ageDays >= 5
    ? <span className="inline-flex items-center gap-1 font-medium text-attn-text"><Clock className="size-3.5" aria-hidden />{label}</span>
    : <span className="tabular-nums">{label}</span>;
}

export function ReleaseTable({ rows, loading, error, onRetry, emptyTitle }: { rows: ReleaseListItem[] | undefined; loading?: boolean; error?: unknown; onRetry?: () => void; emptyTitle?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const columns: Column<ReleaseListItem>[] = [
    { key: 'institution', header: 'Institution', sortValue: (r) => r.institutionName, cell: (r) => r.institutionName },
    {
      key: 'ref', header: 'Instrument', sortValue: (r) => r.referenceNo,
      cell: (r) => (
        <div>
          <Link to={releasePath(user?.role, r.id)} onClick={(e) => e.stopPropagation()} className="mono font-medium whitespace-nowrap text-teal hover:underline">{r.referenceNo}</Link>
          <p className="text-[0.8125rem] text-muted">{INSTRUMENT_TYPE_LABELS[r.instrumentType]} · {r.issuingBank}</p>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', className: 'whitespace-nowrap', sortValue: (r) => Number(r.amount ?? 0), cell: (r) => <Money amount={r.amount} /> },
    { key: 'status', header: 'Request', cell: (r) => <ReleaseStatusChip status={r.status} /> },
    {
      key: 'level', header: 'Level',
      cell: (r) => {
        const lv = r.requiredLevels[r.currentLevel - 1];
        return lv ? <span className="text-xs">L{lv.level} of {r.requiredLevels.length} · {lv.label}</span> : null;
      },
    },
    { key: 'age', header: 'Waiting', sortValue: (r) => r.ageDays, cell: (r) => <Waiting r={r} /> },
  ];
  return <Table columns={columns} rows={rows} loading={loading} error={error} onRetry={onRetry} rowKey={(r) => r.id} onRowClick={(r) => navigate(releasePath(user?.role, r.id))}
    caption="Release requests" emptyTitle={emptyTitle ?? 'No release requests here'}
    emptyDescription="Requests appear here when an institution asks for a deposit to be released." />;
}

/** /officer/releases (and read-only for the other AICTE roles). */
export function ReleaseList() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>(user?.role === 'officer' || user?.role === 'approver' ? 'mine' : 'open');
  const q = useReleaseRequests({ ...FILTERS[filter].params, pageSize: 100 });
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Release requests" subtitle="Requests to release, discharge or refund a deposit. Every condition must be met, and a different person decides each level." />
      <Tabs value={filter} onChange={(v) => setFilter(v as Filter)}
        tabs={(Object.keys(FILTERS) as Filter[]).map((k) => ({
          id: k, label: FILTERS[k].label,
          content: <ReleaseTable rows={q.data?.items} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} />,
        }))} />
    </div>
  );
}
