import { AlertTriangle, CheckCircle2, FilePen, Hourglass, Plus, Undo2, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS, type InstrumentListItem } from '@fdr/shared';
import { useInstruments } from '@/api/instruments';
import { Button, DateText, Money, PageHeader, StatusChip, Table, VerificationChip, type Column } from '@/components';

function Tile({ label, value, icon: Icon, hint }: { label: string; value: number | undefined; icon: LucideIcon; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
        <Icon className="size-4" aria-hidden />
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{value ?? '—'}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function DaysLeft({ days }: { days: number | null }) {
  if (days === null) return <span className="text-slate-400">—</span>;
  if (days < 0) return <span className="font-medium text-danger-700">{Math.abs(days)} d overdue</span>;
  return <span className={days <= 90 ? 'font-medium text-warning-700' : undefined}>{days} d</span>;
}

const linkFor = (r: InstrumentListItem) =>
  r.status === 'DRAFT' || r.status === 'RETURNED' ? `/institution/instruments/${r.id}/edit` : `/institution/instruments/${r.id}`;

export function InstitutionHome() {
  const navigate = useNavigate();
  const all = useInstruments({ pageSize: 100 });
  const items = all.data?.items;
  const count = (pred: (i: InstrumentListItem) => boolean) => items?.filter(pred).length;

  const columns: Column<InstrumentListItem>[] = [
    {
      key: 'ref',
      header: 'Reference',
      sortValue: (r) => r.referenceNo,
      cell: (r) => (
        <div>
          <Link to={linkFor(r)} onClick={(e) => e.stopPropagation()} className="font-medium text-primary-700 hover:underline">
            {r.referenceNo ?? 'Draft — no reference yet'}
          </Link>
          {r.status === 'RETURNED' && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-warning-700">
              <AlertTriangle className="size-3.5" aria-hidden /> Action needed — returned by officer
            </p>
          )}
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (r) => INSTRUMENT_TYPE_LABELS[r.type] },
    { key: 'bank', header: 'Bank', sortValue: (r) => r.issuingBank, cell: (r) => r.issuingBank ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => (r.amount === null ? null : Number(r.amount)), cell: (r) => <Money amount={r.amount} /> },
    { key: 'maturity', header: 'Maturity', sortValue: (r) => r.maturityDate, cell: (r) => <DateText value={r.maturityDate} /> },
    { key: 'days', header: 'Days left', align: 'right', sortValue: (r) => r.daysToMaturity, cell: (r) => <DaysLeft days={r.daysToMaturity} /> },
    { key: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} /> },
    { key: 'verification', header: 'Verification', cell: (r) => (r.status === 'DRAFT' ? <span className="text-slate-400">—</span> : <VerificationChip state={r.verificationState} />) },
  ];

  const open = (r: InstrumentListItem) => navigate(linkFor(r));

  return (
    <>
      <PageHeader
        title="My institution"
        subtitle="Your fixed deposit receipts and security deposits lodged with AICTE."
        actions={
          <Link to="/institution/instruments/new">
            <Button icon={<Plus className="size-4" aria-hidden />}>New instrument</Button>
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Active" icon={CheckCircle2} value={count((i) => i.status === 'ACTIVE')} />
        <Tile label="Expiring ≤ 90 days" icon={Hourglass} value={count((i) => ['ACTIVE', 'EXPIRING'].includes(i.status) && i.daysToMaturity !== null && i.daysToMaturity <= 90)} />
        <Tile label="Returned — needs action" icon={Undo2} value={count((i) => i.status === 'RETURNED')} />
        <Tile label="Drafts" icon={FilePen} value={count((i) => i.status === 'DRAFT')} />
      </div>
      <Table
        caption="Your instruments"
        columns={columns}
        rows={items}
        rowKey={(r) => r.id}
        loading={all.isLoading}
        onRowClick={open}
        emptyTitle="No instruments yet"
        emptyDescription="Use “New instrument” to lodge an FDR or security deposit."
      />
      {all.data && all.data.total > all.data.items.length && (
        <p className="mt-2 text-xs text-slate-500">Showing {all.data.items.length} of {all.data.total}.</p>
      )}
    </>
  );
}
