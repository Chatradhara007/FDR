import { Download, X } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { INSTRUMENT_STATUSES, INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS, STATUS_LABELS, type InstrumentListItem } from '@fdr/shared';
import { useInstruments, useMeta } from '@/api/instruments';
import { downloadReport } from '@/api/reporting';
import { Button, DateText, Money, PageHeader, StatusChip, Table, VerificationChip, WorstAlertChip, useToast, type Column } from '@/components';

const selectCls = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm';
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

  const columns: Column<InstrumentListItem>[] = [
    { key: 'ref', header: 'Reference', cell: (r) => <Link className="font-medium text-primary-700 hover:underline" to={`/instruments/${r.id}`}>{r.referenceNo ?? '(draft)'}</Link> },
    { key: 'inst', header: 'Institution', cell: (r) => <Link className="hover:underline" to={`/institutions/${r.institutionId}`}>{r.institutionName}</Link> },
    { key: 'type', header: 'Type', cell: (r) => INSTRUMENT_TYPE_LABELS[r.type] },
    { key: 'bank', header: 'Bank', cell: (r) => r.issuingBank ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <Money amount={r.amount} /> },
    { key: 'maturity', header: 'Maturity', cell: (r) => (r.maturityDate ? <DateText value={r.maturityDate} /> : '—') },
    { key: 'days', header: 'Days left', align: 'right', cell: (r) => (r.daysToMaturity === null ? '—' : r.daysToMaturity < 0 ? <span className="font-medium text-danger-700">{-r.daysToMaturity} d overdue</span> : `${r.daysToMaturity} d`) },
    { key: 'status', header: 'Status', cell: (r) => <StatusChip status={r.status} /> },
    { key: 'ver', header: 'Verification', cell: (r) => <VerificationChip state={r.verificationState} /> },
    { key: 'alerts', header: 'Alerts', cell: (r) => <WorstAlertChip level={r.worstOpenAlertLevel} count={r.openAlertCount} /> },
  ];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));
  const statusLabel = filters.status ? filters.status.split(',').map((s) => STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s).join(', ') : '';

  return (
    <>
      <PageHeader title="Instrument register" subtitle="Every instrument lodged with AICTE, filtered and exported."
        actions={<Button variant="secondary" icon={<Download className="size-4" aria-hidden />} loading={downloading} onClick={() => void exportCsv()}>Download CSV</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Status<br />
          <select className={selectCls} value={filters.status.includes(',') ? '' : filters.status} onChange={on('status')}>
            <option value="">{filters.status.includes(',') ? statusLabel : 'All statuses'}</option>
            {INSTRUMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="text-sm">Type<br />
          <select className={selectCls} value={filters.type} onChange={on('type')}>
            <option value="">All types</option>
            {INSTRUMENT_TYPES.map((t) => <option key={t} value={t}>{INSTRUMENT_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="text-sm">Region<br />
          <select className={selectCls} value={filters.region} onChange={on('region')}>
            <option value="">All regions</option>
            {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="text-sm">Bank<br />
          <select className={selectCls} value={filters.bank} onChange={on('bank')}>
            <option value="">All banks</option>
            {meta.data?.banks.map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="text-sm">Matures from<br /><input type="date" className={selectCls} value={filters.maturityFrom} onChange={on('maturityFrom')} /></label>
        <label className="text-sm">to<br /><input type="date" className={selectCls} value={filters.maturityTo} onChange={on('maturityTo')} /></label>
        <label className="text-sm">Search<br /><input className={selectCls} placeholder="Reference, beneficiary, institution" defaultValue={filters.q} onBlur={on('q')} /></label>
        <label className="text-sm">Sort<br />
          <select className={selectCls} value={filters.sort || 'maturityDate'} onChange={on('sort')}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {[...params.keys()].length > 0 && <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={() => setParams({}, { replace: true })}>Clear filters</Button>}
      </div>
      <p className="mb-2 text-sm text-slate-600 tabular-nums">{total} instrument(s){statusLabel && ` · ${statusLabel}`}</p>
      <Table columns={columns} rows={q.data?.items} rowKey={(r) => r.id} loading={q.isLoading} emptyTitle="No instrument matches these filters" caption="Instrument register" />
      {pages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>Previous</Button>
          <span className="tabular-nums">Page {page} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => update('page', String(page + 1))}>Next</Button>
        </div>
      )}
    </>
  );
}
