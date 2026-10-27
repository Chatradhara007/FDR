import { AlertTriangle, ArrowRight, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS, type InstrumentListItem } from '@fdr/shared';
import { useInstruments } from '@/api/instruments';
import { useAuth } from '@/auth/AuthContext';
import { Button, CountUp, DateText, EmptyState, Money, StatRow, StatTile, StatusChip, StepIndicator, Table, VerificationChip, WorstAlertChip, type Column } from '@/components';

export function DaysLeft({ days }: { days: number | null }) {
  if (days === null) return <span className="text-slate-400">—</span>;
  if (days < 0) return <span className="font-medium text-danger-700">{Math.abs(days)} d overdue</span>;
  return <span className={days <= 90 ? 'font-medium text-warning-700' : undefined}>{days} d</span>;
}

const TRACK = ['Lodged', 'Scrutiny', 'Active', 'Renew or release'];

/** What the institution should do next, or null when nothing is waiting on it. */
function nextStep(r: InstrumentListItem): { text: string; step: number } | null {
  switch (r.status) {
    case 'DRAFT': return { text: 'Finish the details and submit for scrutiny.', step: 0 };
    case 'RETURNED': return { text: 'Returned by the officer. Correct it and submit again.', step: 1 };
    case 'EXPIRING': return { text: 'Matures soon. Renew it, or request release if the obligation has ended.', step: 3 };
    case 'MATURED': return { text: 'Matured. Lodge the renewal or request release.', step: 3 };
    case 'LAPSED': return { text: 'Lapsed without renewal. Lodge a renewal now.', step: 3 };
    default: return r.openAlertCount > 0 ? { text: 'Has an open alert. Open it to see what is needed.', step: r.status === 'ACTIVE' ? 2 : 1 } : null;
  }
}

const linkFor = (r: InstrumentListItem) =>
  r.status === 'DRAFT' || r.status === 'RETURNED' ? `/institution/instruments/${r.id}/edit` : `/instruments/${r.id}`;

export function InstitutionHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
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
          <Link to={linkFor(r)} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:underline underline-offset-4">
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
    { key: 'type', header: 'Type', optional: true, cell: (r) => INSTRUMENT_TYPE_LABELS[r.type] },
    { key: 'bank', header: 'Bank', sortValue: (r) => r.issuingBank, cell: (r) => r.issuingBank ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (r) => (r.amount === null ? null : Number(r.amount)), cell: (r) => <Money amount={r.amount} /> },
    { key: 'maturity', header: 'Maturity', sortValue: (r) => r.maturityDate, cell: (r) => <DateText value={r.maturityDate} /> },
    { key: 'days', header: 'Days left', align: 'right', sortValue: (r) => r.daysToMaturity, cell: (r) => <DaysLeft days={r.daysToMaturity} /> },
    { key: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} /> },
    { key: 'alerts', header: 'Alerts', optional: true, sortValue: (r) => r.worstOpenAlertLevel, cell: (r) => <WorstAlertChip level={r.worstOpenAlertLevel} count={r.openAlertCount} /> },
    { key: 'verification', header: 'Verification', optional: true, cell: (r) => (r.status === 'DRAFT' ? <span className="text-slate-400">—</span> : <VerificationChip state={r.verificationState} />) },
  ];

  const open = (r: InstrumentListItem) => navigate(linkFor(r));

  const action = (items ?? []).map((r) => ({ r, next: nextStep(r) })).filter((x): x is { r: InstrumentListItem; next: { text: string; step: number } } => x.next !== null);

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-slate-900">Welcome{user ? `, ${user.name}` : ''}</h1>
          <p className="mt-1.5 text-slate-600">{user?.institutionName ?? 'Your institution'} · deposits lodged with AICTE</p>
        </div>
        <Link to="/institution/instruments/new">
          <Button icon={<Plus className="size-4" aria-hidden />}>Submit a new deposit</Button>
        </Link>
      </div>

      <StatRow>
        <StatTile label="Active" value={items ? <CountUp value={count((i) => i.status === 'ACTIVE') ?? 0} /> : '—'} />
        <StatTile label="Needs your action" value={items ? <CountUp value={action.length} /> : '—'} tone={action.length ? 'warning' : undefined} />
        <StatTile label="Maturing within 90 days" value={items ? <CountUp value={count((i) => ['ACTIVE', 'EXPIRING'].includes(i.status) && i.daysToMaturity !== null && i.daysToMaturity <= 90) ?? 0} /> : '—'} />
      </StatRow>

      <section aria-labelledby="needs-action">
        <h2 id="needs-action" className="mb-4 text-xl font-semibold text-slate-900">Needs your action</h2>
        {items && action.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface"><EmptyState title="Nothing needs your action" description="Deposits that need a correction, renewal or release request will be listed here." /></div>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {action.map(({ r, next }) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-slate-900">{r.referenceNo ?? 'Draft, no reference yet'}</span>
                    <StatusChip status={r.status} />
                    {r.amount && <span className="text-sm text-slate-600"><Money amount={r.amount} /></span>}
                  </div>
                  <p className="text-slate-700">{next.text}</p>
                  <StepIndicator steps={TRACK} current={next.step} compact />
                </div>
                <Link to={linkFor(r)} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline underline-offset-4">
                  Open <ArrowRight className="size-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="all-deposits">
        <h2 id="all-deposits" className="mb-4 text-xl font-semibold text-slate-900">All my deposits</h2>
        <Table
          caption="Your instruments"
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          loading={all.isLoading}
          onRowClick={open}
          emptyTitle="No deposits yet"
          emptyDescription="Use “Submit a new deposit” to lodge an FDR or security deposit."
        />
        {all.data && all.data.total > all.data.items.length && (
          <p className="mt-2 text-sm text-slate-600">Showing {all.data.items.length} of {all.data.total}.</p>
        )}
      </section>
    </div>
  );
}
