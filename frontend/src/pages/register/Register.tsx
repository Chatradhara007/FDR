import { Columns3, Download, Search, SlidersHorizontal, X } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { INSTRUMENT_STATUSES, INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS, STATUS_LABELS, formatDate, type InstrumentListItem } from '@fdr/shared';
import { useInstruments, useMeta } from '@/api/instruments';
import { downloadReport } from '@/api/reporting';
import {
  Button, DateText, Drawer, FormField, Money, PageHeader, StatusChip, Table, TrustBadge, VerificationChip, WorstAlertChip, useToast, type Column,
} from '@/components';

const KEYS = ['status', 'type', 'region', 'bank', 'institutionId', 'maturityFrom', 'maturityTo', 'q', 'sort'] as const;
const SORTS: Array<[string, string]> = [
  ['maturityDate', 'Maturity (soonest)'], ['-maturityDate', 'Maturity (latest)'], ['-amount', 'Amount (largest)'],
  ['amount', 'Amount (smallest)'], ['referenceNo', 'Reference'], ['-updatedAt', 'Recently updated'],
];

/** /register: every instrument with filters from the URL (dashboard tiles link here), sort, paging and CSV export. */
export function Register() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const meta = useMeta();
  const [downloading, setDownloading] = useState(false);
  const filters = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof KEYS)[number], string>;
  const page = Number(params.get('page') ?? '1') || 1;
  const q = useInstruments({ ...filters, page, pageSize: 50 });

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const on = (key: string) => (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => update(key, e.target.value);

  const exportCsv = async () => {
    setDownloading(true);
    try {
      const { sort: _s, q: _q, ...rest } = filters;
      await downloadReport('register', rest);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const [drawer, setDrawer] = useState(false);
  const [moreCols, setMoreCols] = useState(false);
  const columns: Column<InstrumentListItem>[] = [
    {
      key: 'ref', header: 'Reference', cell: (r) => (
        <>
          <Link className="mono font-medium text-teal hover:underline" to={`/instruments/${r.id}`}>{r.referenceNo ?? '(draft)'}</Link>
          <span className="block text-[0.8125rem] text-muted">{INSTRUMENT_TYPE_LABELS[r.type]}</span>
        </>
      ),
    },
    { key: 'inst', header: 'Institution', cell: (r) => <Link className="hover:underline" to={`/institutions/${r.institutionId}`}>{r.institutionName}</Link> },
    ...(moreCols ? [
      { key: 'bank', header: 'Bank', cell: (r: InstrumentListItem) => r.issuingBank ?? '—' },
      { key: 'ver', header: 'Verification', cell: (r: InstrumentListItem) => <VerificationChip state={r.verificationState} /> },
    ] : []),
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <Money amount={r.amount} /> },
    {
      key: 'maturity', header: 'Maturity', cell: (r) => (r.maturityDate ? (
        <>
          <DateText value={r.maturityDate} />
          <span className="block text-[0.8125rem] text-muted">
            {r.daysToMaturity === null ? '' : r.daysToMaturity < 0 ? <span className="font-medium text-danger-700">{-r.daysToMaturity} d overdue</span> : `${r.daysToMaturity} d left`}
          </span>
        </>
      ) : '—'),
    },
    { key: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} /> },
    { key: 'proof', header: 'Weakest proof', cell: (r) => (r.weakestTier ? <TrustBadge tier={r.weakestTier} short /> : '—') },
    { key: 'alerts', header: 'Alerts', cell: (r) => <WorstAlertChip level={r.worstOpenAlertLevel} count={r.openAlertCount} /> },
  ];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));
  const statusLabel = filters.status ? filters.status.split(',').map((s) => STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s).join(', ') : '';
  const chips: Array<[(typeof KEYS)[number], string]> = [
    ...(filters.status ? [['status', statusLabel] as [(typeof KEYS)[number], string]] : []),
    ...(filters.type ? [['type', INSTRUMENT_TYPE_LABELS[filters.type as keyof typeof INSTRUMENT_TYPE_LABELS] ?? filters.type] as [(typeof KEYS)[number], string]] : []),
    ...(['region', 'bank'] as const).filter((k) => filters[k]).map((k) => [k, filters[k]] as [(typeof KEYS)[number], string]),
    ...(filters.institutionId ? [['institutionId', 'One institution'] as [(typeof KEYS)[number], string]] : []),
    ...(filters.maturityFrom ? [['maturityFrom', `Matures from ${formatDate(filters.maturityFrom)}`] as [(typeof KEYS)[number], string]] : []),
    ...(filters.maturityTo ? [['maturityTo', `Matures by ${formatDate(filters.maturityTo)}`] as [(typeof KEYS)[number], string]] : []),
    ...(filters.q ? [['q', `“${filters.q}”`] as [(typeof KEYS)[number], string]] : []),
  ];
  const filterCount = chips.filter(([k]) => k !== 'q').length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Instrument register" subtitle="Every instrument lodged with AICTE, filtered and exported."
        actions={<Button variant="secondary" icon={<Download className="size-4" aria-hidden />} loading={downloading} onClick={() => void exportCsv()}>Download CSV</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input key={filters.q} className="gov-input pl-10" placeholder="Search reference, beneficiary, institution" defaultValue={filters.q}
            onBlur={on('q')} onKeyDown={(e) => { if (e.key === 'Enter') update('q', e.currentTarget.value); }} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">Sort
          <select className="gov-input w-auto" value={filters.sort || 'maturityDate'} onChange={on('sort')}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Button variant="secondary" icon={<SlidersHorizontal className="size-4" aria-hidden />} onClick={() => setDrawer(true)} aria-haspopup="dialog">
          Filters{filterCount > 0 && <span className="rounded-[6px] bg-ink px-1.5 text-xs text-white tabular-nums">{filterCount}</span>}
        </Button>
        <Button variant="ghost" icon={<Columns3 className="size-4" aria-hidden />} aria-pressed={moreCols} onClick={() => setMoreCols((v) => !v)}>
          {moreCols ? 'Fewer columns' : 'More columns'}
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted tabular-nums">{total} instrument(s){statusLabel && ` · ${statusLabel}`}</span>
        {chips.map(([k, label]) => (
          <button key={k} type="button" onClick={() => update(k, '')} className="inline-flex items-center gap-1 rounded-[8px] bg-chip px-2 py-0.5 font-medium text-ink-2 hover:bg-border">
            {label}<X className="size-3.5" aria-hidden /><span className="sr-only"> (remove filter)</span>
          </button>
        ))}
        {[...params.keys()].length > 0 && <Button variant="link" size="sm" onClick={() => setParams({}, { replace: true })}>Clear filters</Button>}
      </div>
      <Table columns={columns} rows={q.data?.items} rowKey={(r) => r.id} loading={q.isLoading} emptyTitle="No instrument matches these filters" caption="Instrument register" />
      {pages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>Previous</Button>
          <span className="tabular-nums">Page {page} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => update('page', String(page + 1))}>Next</Button>
        </div>
      )}

      <Drawer open={drawer} title="Filter the register" onClose={() => setDrawer(false)}>
        <div className="space-y-4">
          <FormField id="f-status" label="Status">
            <select id="f-status" className="gov-input" value={filters.status.includes(',') ? '' : filters.status} onChange={on('status')}>
              <option value="">{filters.status.includes(',') ? statusLabel : 'All statuses'}</option>
              {INSTRUMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </FormField>
          <FormField id="f-type" label="Type">
            <select id="f-type" className="gov-input" value={filters.type} onChange={on('type')}>
              <option value="">All types</option>
              {INSTRUMENT_TYPES.map((t) => <option key={t} value={t}>{INSTRUMENT_TYPE_LABELS[t]}</option>)}
            </select>
          </FormField>
          <FormField id="f-region" label="Region">
            <select id="f-region" className="gov-input" value={filters.region} onChange={on('region')}>
              <option value="">All regions</option>
              {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
            </select>
          </FormField>
          <FormField id="f-bank" label="Bank">
            <select id="f-bank" className="gov-input" value={filters.bank} onChange={on('bank')}>
              <option value="">All banks</option>
              {meta.data?.banks.map((b) => <option key={b}>{b}</option>)}
            </select>
          </FormField>
          <FormField id="f-from" label="Matures from"><input id="f-from" type="date" className="gov-input" value={filters.maturityFrom} onChange={on('maturityFrom')} /></FormField>
          <FormField id="f-to" label="Matures by"><input id="f-to" type="date" className="gov-input" value={filters.maturityTo} onChange={on('maturityTo')} /></FormField>
          <p className="text-[0.8125rem] text-muted">Filters apply as you choose them.</p>
          <div className="flex gap-2 pt-2">
            <Button className="flex-1" onClick={() => setDrawer(false)}>Show {total} instrument(s)</Button>
            <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>Clear</Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
