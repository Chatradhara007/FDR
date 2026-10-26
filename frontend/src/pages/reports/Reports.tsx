import { Download, TrendingUp } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FIELD_LABELS, INSTRUMENT_STATUSES, INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS, RELEASE_REQUEST_STATUS_LABELS, REPORT_PRESETS, STATUS_LABELS,
  VERIFICATION_RESULT_LABELS, VERIFICATION_STATE_LABELS, formatDate, formatINR, type Report, type ReportColumnKind,
} from '@fdr/shared';
import { useMeta } from '@/api/instruments';
import { downloadReport, useReport, type Params } from '@/api/reporting';
import { Button, EmptyState, PageHeader, useToast } from '@/components';

const selectCls = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm';
const PRESET_KEYS = Object.keys(REPORT_PRESETS);
const PREVIEW_ROWS = 200;

/** Which filters each preset reads (the server ignores the rest). */
const FILTERS: Record<string, string[]> = {
  register: ['status', 'type', 'region', 'bank', 'maturityFrom', 'maturityTo'],
  expiring: ['days', 'type', 'region', 'bank'],
  'pending-verification': ['type', 'region', 'bank'],
  discrepancies: ['all', 'type', 'region', 'bank'],
  lapsed: ['type', 'region', 'bank'],
  releases: ['from', 'to', 'type', 'region', 'bank'],
  'institution-summary': ['region'],
};

function show(value: unknown, kind: ReportColumnKind): string {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value);
  switch (kind) {
    case 'amount': return formatINR(s);
    case 'date': return formatDate(s);
    case 'status': return STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s;
    case 'verification': return VERIFICATION_STATE_LABELS[s as keyof typeof VERIFICATION_STATE_LABELS] ?? s;
    case 'result': return VERIFICATION_RESULT_LABELS[s as keyof typeof VERIFICATION_RESULT_LABELS] ?? s;
    case 'releaseStatus': return RELEASE_REQUEST_STATUS_LABELS[s as keyof typeof RELEASE_REQUEST_STATUS_LABELS] ?? s;
    case 'field': return FIELD_LABELS[s as keyof typeof FIELD_LABELS] ?? s;
    default: return s;
  }
}

function Preview({ report }: { report: Report }) {
  const rows = report.rows.slice(0, PREVIEW_ROWS);
  const link = (row: Record<string, unknown>) =>
    report.preset === 'institution-summary' ? `/institutions/${String(row.id)}` : `/instruments/${String(row.instrumentId ?? row.id)}`;
  return (
    <div className="max-h-[calc(100vh-10rem)] overflow-auto rounded-lg border border-slate-200 bg-surface">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <caption className="sr-only">{report.title}</caption>
        <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
          <tr>{report.columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2 text-xs font-semibold text-slate-600 ${['amount', 'int'].includes(c.kind) ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {report.columns.map((c, j) => (
                <td key={c.key} className={`px-3 py-2 ${['amount', 'int'].includes(c.kind) ? 'text-right tabular-nums' : ''}`}>
                  {j === 0 ? <Link className="font-medium text-primary-700 hover:underline" to={link(row)}>{show(row[c.key], c.kind)}</Link> : show(row[c.key], c.kind)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {report.total === 0 && <EmptyState title="No rows for these filters" />}
      {report.total > PREVIEW_ROWS && <p className="px-3 py-2 text-xs text-slate-500">Showing the first {PREVIEW_ROWS} of {report.total} rows; the CSV has all of them.</p>}
    </div>
  );
}

/** /reports: preset picker, filters, preview, CSV download (each download is recorded as REPORT_EXPORTED). */
export function Reports() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const meta = useMeta();
  const [downloading, setDownloading] = useState(false);
  const preset = PRESET_KEYS.includes(params.get('preset') ?? '') ? (params.get('preset') as string) : 'register';
  const wanted = FILTERS[preset];
  const filters: Params = Object.fromEntries(wanted.map((k) => [k, params.get(k) ?? '']));
  const q = useReport(preset, filters);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(key === 'preset' ? {} : params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'preset') next.set('preset', preset);
    setParams(next, { replace: true });
  };
  const on = (key: string) => (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    set(key, e.target.type === 'checkbox' ? ((e.target as HTMLInputElement).checked ? 'true' : '') : e.target.value);

  const download = async () => {
    setDownloading(true);
    try { await downloadReport(preset, filters); } catch (err) { toast.error((err as Error).message); } finally { setDownloading(false); }
  };

  const has = (k: string) => wanted.includes(k);
  return (
    <>
      <PageHeader title="Reports" subtitle="Management reports from live data. Downloads are UTF-8 CSV (opens in Excel) and are recorded in the audit log."
        actions={<>
          <Link to="/reports/improvement" className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline"><TrendingUp className="size-4" aria-hidden />Improvement metrics</Link>
          <Button icon={<Download className="size-4" aria-hidden />} loading={downloading} onClick={() => void download()}>Download CSV</Button>
        </>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Report<br />
          <select className={selectCls} value={preset} onChange={on('preset')}>
            {PRESET_KEYS.map((k) => <option key={k} value={k}>{REPORT_PRESETS[k]}</option>)}
          </select>
        </label>
        {has('status') && (
          <label className="text-sm">Status<br />
            <select className={selectCls} value={String(filters.status)} onChange={on('status')}>
              <option value="">All statuses</option>
              {INSTRUMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
        )}
        {has('days') && <label className="text-sm">Within (days)<br /><input type="number" min={1} className={`${selectCls} w-24`} value={String(filters.days) || '90'} onChange={on('days')} /></label>}
        {has('type') && (
          <label className="text-sm">Type<br />
            <select className={selectCls} value={String(filters.type)} onChange={on('type')}>
              <option value="">All types</option>
              {INSTRUMENT_TYPES.map((t) => <option key={t} value={t}>{INSTRUMENT_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
        )}
        {has('region') && (
          <label className="text-sm">Region<br />
            <select className={selectCls} value={String(filters.region)} onChange={on('region')}>
              <option value="">All regions</option>
              {meta.data?.regions.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        )}
        {has('bank') && (
          <label className="text-sm">Bank<br />
            <select className={selectCls} value={String(filters.bank)} onChange={on('bank')}>
              <option value="">All banks</option>
              {meta.data?.banks.map((b) => <option key={b}>{b}</option>)}
            </select>
          </label>
        )}
        {has('maturityFrom') && <label className="text-sm">Matures from<br /><input type="date" className={selectCls} value={String(filters.maturityFrom)} onChange={on('maturityFrom')} /></label>}
        {has('maturityTo') && <label className="text-sm">to<br /><input type="date" className={selectCls} value={String(filters.maturityTo)} onChange={on('maturityTo')} /></label>}
        {has('from') && <label className="text-sm">Requested from<br /><input type="date" className={selectCls} value={String(filters.from)} onChange={on('from')} /></label>}
        {has('to') && <label className="text-sm">to<br /><input type="date" className={selectCls} value={String(filters.to)} onChange={on('to')} /></label>}
        {has('all') && <label className="inline-flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={filters.all === 'true'} onChange={on('all')} />Include resolved</label>}
      </div>
      {q.isError && <EmptyState title="Could not load the report" description={q.error.message} />}
      {q.data && (
        <>
          <p className="mb-2 text-sm text-slate-600 tabular-nums">{q.data.title} · {q.data.total} row(s) · as of {formatDate(q.data.asOf)}</p>
          <Preview report={q.data} />
        </>
      )}
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
    </>
  );
}
