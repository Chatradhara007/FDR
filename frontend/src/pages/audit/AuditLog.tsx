import { ChevronDown, ChevronRight, Download, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DOC_TYPE_LABELS, EVENT_LABELS, ROLE_LABELS, formatDateTime, type AuditEvent, type DocumentAccessRow,
} from '@fdr/shared';
import { downloadAuditEvents, useAuditEvents, useDocumentAccess, useIntegrity, useRecheckIntegrity } from '@/api/admin';
import type { Params } from '@/api/reporting';
import { Button, PageHeader, Table, Tabs, useToast, type Column } from '@/components';

const selectCls = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm';
const ENTITY_TYPES = [
  'instrument', 'document', 'verification', 'discrepancy', 'observation', 'alert', 'release_request', 'release_condition',
  'rule', 'user', 'clock', 'job', 'report',
];
const ACTIONS = Object.keys(EVENT_LABELS).sort();
const PAGE_SIZE = 50;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** Green shield when every hash recomputes; red with a link to the first broken event otherwise. */
function IntegrityBanner({ onShowEvent }: { onShowEvent: (id: number) => void }) {
  const integrity = useIntegrity();
  const recheck = useRecheckIntegrity();
  const r = integrity.data;
  if (!r) return <div className="mb-4 h-14 animate-pulse rounded-lg bg-slate-100" aria-hidden />;
  const again = (
    <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={recheck.isPending} onClick={() => recheck.mutate()}>
      Check again
    </Button>
  );
  return r.ok ? (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success-600/30 bg-success-50 px-4 py-3 text-success-700" role="status" data-testid="integrity-ok">
      <p className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="size-5" aria-hidden />
        Log integrity verified · {r.checked.toLocaleString('en-IN')} events · checked {timeOf(r.verifiedAt)}
      </p>
      {again}
    </div>
  ) : (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-600/30 bg-danger-50 px-4 py-3 text-danger-700" role="alert" data-testid="integrity-failed">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <ShieldAlert className="size-5" aria-hidden />
        Integrity check failed at event #{r.firstBrokenId} — the log has been altered.
        {r.firstBrokenId !== null && (
          <button type="button" className="underline" onClick={() => onShowEvent(r.firstBrokenId as number)}>Show event #{r.firstBrokenId}</button>
        )}
      </p>
      {again}
    </div>
  );
}

function show(v: unknown): string {
  if (v === undefined) return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Before/after side by side; changed keys are marked with text, not colour alone. */
function Diff({ before, after }: { before: unknown; after: unknown }) {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(before) && !isObj(after)) {
    return <pre className="whitespace-pre-wrap text-xs">{JSON.stringify({ before, after }, null, 2)}</pre>;
  }
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-left text-slate-500"><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Before</th><th className="py-1">After</th></tr></thead>
      <tbody>
        {keys.map((k) => {
          const changed = before !== null && JSON.stringify(b[k]) !== JSON.stringify(a[k]);
          return (
            <tr key={k} className={changed ? 'bg-warning-50' : undefined}>
              <td className="py-1 pr-3 align-top font-medium">{k}{changed && <span className="ml-1 text-warning-700">(changed)</span>}</td>
              <td className="max-w-md break-all py-1 pr-3 align-top font-mono">{show(b[k])}</td>
              <td className="max-w-md break-all py-1 align-top font-mono">{show(a[k])}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EventsTab({ eventId, clearEventId }: { eventId: number | null; clearEventId: () => void }) {
  const toast = useToast();
  const [filters, setFilters] = useState({ action: '', entityType: '', from: '', to: '', q: '', actorId: '', actorLabel: '' });
  const [signIns, setSignIns] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const params: Params = {
    action: filters.action, entityType: filters.entityType, from: filters.from, to: filters.to, q: filters.q,
    actorId: filters.actorId, eventId: eventId ?? undefined, includeSignIns: signIns ? 'true' : 'false', page, pageSize: PAGE_SIZE,
  };
  const events = useAuditEvents(params);
  const pages = events.data ? Math.max(1, Math.ceil(events.data.total / PAGE_SIZE)) : 1;
  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const download = async () => {
    setDownloading(true);
    try { await downloadAuditEvents(params); } catch (e) { toast.error(e instanceof Error ? e.message : 'Download failed'); } finally { setDownloading(false); }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Action<br />
          <select className={selectCls} value={filters.action} onChange={set('action')}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{EVENT_LABELS[a]}</option>)}
          </select>
        </label>
        <label className="text-sm">Record type<br />
          <select className={selectCls} value={filters.entityType} onChange={set('entityType')}>
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label className="text-sm">From<br /><input type="date" className={selectCls} value={filters.from} onChange={set('from')} /></label>
        <label className="text-sm">to<br /><input type="date" className={selectCls} value={filters.to} onChange={set('to')} /></label>
        <label className="text-sm">Search<br /><input type="search" className={selectCls} placeholder="Actor, reference, value…" value={filters.q} onChange={set('q')} /></label>
        <label className="inline-flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={signIns} onChange={(e) => { setSignIns(e.target.checked); setPage(1); }} />
          Show sign-ins
        </label>
        <Button variant="secondary" icon={<Download className="size-4" aria-hidden />} loading={downloading} onClick={() => void download()}>Export CSV</Button>
      </div>
      {(filters.actorId || eventId !== null) && (
        <p className="mb-3 flex flex-wrap gap-3 text-sm">
          {filters.actorId && <span>Actor: <strong>{filters.actorLabel}</strong> <button type="button" className="text-primary-700 underline" onClick={() => setFilters({ ...filters, actorId: '', actorLabel: '' })}>clear</button></span>}
          {eventId !== null && <span>Event #{eventId} only <button type="button" className="text-primary-700 underline" onClick={clearEventId}>show all</button></span>}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Audit events, newest first</caption>
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            <tr><th className="px-3 py-2"><span className="sr-only">Details</span></th><th className="px-3 py-2">#</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">What happened</th><th className="px-3 py-2">Record</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {events.data?.items.map((e: AuditEvent) => (
              <Fragment key={e.id}>
                <tr data-testid="audit-row">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => toggle(e.id)} aria-expanded={open.has(e.id)} aria-label={`${open.has(e.id) ? 'Hide' : 'Show'} details of event ${e.id}`} className="rounded p-1 hover:bg-slate-100">
                      {open.has(e.id) ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                    </button>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{e.id}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.createdAt)}</td>
                  <td className="px-3 py-2">
                    {e.actorId ? (
                      <button type="button" className="text-left hover:underline" title="Show only this actor" onClick={() => { setFilters({ ...filters, actorId: e.actorId as string, actorLabel: e.actorLabel }); setPage(1); }}>{e.actorLabel}</button>
                    ) : e.actorLabel}
                  </td>
                  <td className="px-3 py-2"><span className="text-slate-800">{e.label}</span><br /><span className="font-mono text-xs text-slate-500">{e.action}</span></td>
                  <td className="px-3 py-2">
                    {e.instrumentId ? <Link className="text-primary-700 hover:underline" to={`/instruments/${e.instrumentId}`}>{e.referenceNo ?? 'Instrument'}</Link> : <span className="text-slate-500">{e.entityType.replace('_', ' ')}</span>}
                  </td>
                </tr>
                {open.has(e.id) && (
                  <tr><td /><td colSpan={5} className="bg-slate-50 px-3 py-2"><Diff before={e.before} after={e.after} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {events.isLoading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
        {events.data && events.data.items.length === 0 && <p className="p-4 text-sm text-slate-500">No events match these filters.</p>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-600">{events.data ? `${events.data.total.toLocaleString('en-IN')} event${events.data.total === 1 ? '' : 's'}` : ''}</span>
        {pages > 1 && (
          <span className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </span>
        )}
      </div>
    </div>
  );
}

function DocumentAccessTab() {
  const [instrumentId, setInstrumentId] = useState('');
  const rows = useDocumentAccess(instrumentId);
  const columns: Column<DocumentAccessRow>[] = [
    { key: 'when', header: 'When', className: 'whitespace-nowrap', sortValue: (r) => r.id, cell: (r) => formatDateTime(r.createdAt) },
    { key: 'who', header: 'Who', sortValue: (r) => r.actorLabel, cell: (r) => <>{r.actorLabel}{r.role && <span className="text-xs text-slate-500"> · {ROLE_LABELS[r.role]}</span>}</> },
    { key: 'doc', header: 'Document', cell: (r) => <>{r.filename ?? 'Document'}{r.docType && <span className="text-xs text-slate-500"> · {DOC_TYPE_LABELS[r.docType]}</span>}</> },
    { key: 'how', header: 'How', cell: (r) => (r.mode === 'preview' ? 'Viewed' : 'Downloaded') },
    {
      key: 'inst', header: 'Instrument',
      cell: (r) => r.instrumentId ? (
        <span className="flex items-center gap-2">
          <Link className="text-primary-700 hover:underline" to={`/instruments/${r.instrumentId}`}>{r.referenceNo ?? 'Instrument'}</Link>
          {!instrumentId && <button type="button" className="text-xs text-slate-500 underline" onClick={() => setInstrumentId(r.instrumentId as string)}>only this</button>}
        </span>
      ) : '—',
    },
  ];
  return (
    <div>
      {instrumentId && <p className="mb-3 text-sm">One instrument only. <button type="button" className="text-primary-700 underline" onClick={() => setInstrumentId('')}>Show all</button></p>}
      <Table caption="Who viewed which document, newest first" columns={columns} rows={rows.data} rowKey={(r) => String(r.id)} loading={rows.isLoading}
        emptyTitle="No document has been opened yet" emptyDescription="Every view and download of a document is recorded here." />
    </div>
  );
}

/** /audit (admin, auditor): the hash-chained audit trail with its integrity check. Read-only. */
export function AuditLog() {
  const [tab, setTab] = useState('events');
  const [eventId, setEventId] = useState<number | null>(null);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every action in the portal, hash-chained so that any later change to a record is detected." />
      <IntegrityBanner onShowEvent={(id) => { setEventId(id); setTab('events'); }} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'events', label: 'Events', content: <EventsTab eventId={eventId} clearEventId={() => setEventId(null)} /> },
        { id: 'documents', label: 'Document access', content: <DocumentAccessTab /> },
      ]} />
    </div>
  );
}
