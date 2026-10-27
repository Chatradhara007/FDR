import { ChevronRight, Download, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DOC_TYPE_LABELS, EVENT_LABELS, ROLE_LABELS, formatDateTime, type AuditEvent, type DocumentAccessRow,
} from '@fdr/shared';
import { downloadAuditEvents, useAuditEvents, useDocumentAccess, useIntegrity, useRecheckIntegrity } from '@/api/admin';
import type { Params } from '@/api/reporting';
import { Button, Drawer, ErrorState, Kicker, LoadingState, PageHeader, Pager, Panel, Table, Tabs, useToast, type Column } from '@/components';
import { cn } from '@/lib/cn';

const ENTITY_TYPES = [
  'instrument', 'document', 'verification', 'discrepancy', 'observation', 'alert', 'release_request', 'release_condition',
  'rule', 'user', 'clock', 'job', 'report',
];
const ACTIONS = Object.keys(EVENT_LABELS).sort();
const PAGE_SIZE = 50;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** The first thing on the page: is the chain intact? Intact (teal) or broken (danger) with a link to the first bad event. */
function IntegrityCard({ onShowEvent }: { onShowEvent: (id: number) => void }) {
  const integrity = useIntegrity();
  const recheck = useRecheckIntegrity();
  const r = integrity.data;
  if (integrity.isError) return <Panel className="mb-6"><ErrorState error={integrity.error} onRetry={() => void integrity.refetch()} title="The integrity check could not run" /></Panel>;
  if (!r) return <Panel className="mb-6"><LoadingState rows={2} label="Checking the audit chain…" /></Panel>;
  const again = (
    <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={recheck.isPending} onClick={() => recheck.mutate()}>
      Check again
    </Button>
  );
  return r.ok ? (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-border border-l-[5px] border-l-teal bg-surface px-6 py-5" role="status" data-testid="integrity-ok" aria-label="Audit integrity">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-7 shrink-0 text-teal" aria-hidden />
        <div>
          <Kicker>Audit integrity</Kicker>
          <p className="text-lg font-bold text-ink">Log integrity verified</p>
          <p className="text-sm text-muted">{r.checked.toLocaleString('en-IN')} events recomputed, every hash matches. Checked at {timeOf(r.verifiedAt)}.</p>
        </div>
      </div>
      {again}
    </section>
  ) : (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-danger/40 border-l-[5px] border-l-danger bg-danger-tint px-6 py-5" role="alert" data-testid="integrity-failed" aria-label="Audit integrity">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-7 shrink-0 text-danger" aria-hidden />
        <div>
          <Kicker>Audit integrity</Kicker>
          <p className="text-lg font-bold text-danger-700">Integrity check failed at event #{r.firstBrokenId}</p>
          <p className="text-sm text-ink">The log has been altered after it was written. Events from this one onwards cannot be trusted.</p>
          {r.firstBrokenId !== null && (
            <Button variant="link" size="sm" onClick={() => onShowEvent(r.firstBrokenId as number)}>Show event #{r.firstBrokenId}</Button>
          )}
        </div>
      </div>
      {again}
    </section>
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
    return <pre className="mono text-[0.8125rem] whitespace-pre-wrap break-all">{JSON.stringify({ before, after }, null, 2)}</pre>;
  }
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  return (
    <table className="w-full table-fixed text-[0.8125rem]">
      <caption className="sr-only">Values before and after this event</caption>
      <thead><tr className="border-b border-hairline text-left text-xs font-bold tracking-[0.05em] text-muted uppercase"><th scope="col" className="w-1/4 py-2 pr-3">Field</th><th scope="col" className="py-2 pr-3">Before</th><th scope="col" className="py-2">After</th></tr></thead>
      <tbody>
        {keys.map((k) => {
          const changed = before !== null && JSON.stringify(b[k]) !== JSON.stringify(a[k]);
          return (
            <tr key={k} className={cn('border-b border-hairline', changed && 'bg-attn-tint')}>
              <td className="py-2 pr-3 align-top font-semibold break-words">{k}{changed && <span className="block font-medium text-attn-text">changed</span>}</td>
              <td className="mono py-2 pr-3 align-top break-all">{show(b[k])}</td>
              <td className="mono py-2 align-top break-all">{show(a[k])}</td>
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
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const [downloading, setDownloading] = useState(false);
  const params: Params = {
    action: filters.action, entityType: filters.entityType, from: filters.from, to: filters.to, q: filters.q,
    actorId: filters.actorId, eventId: eventId ?? undefined, includeSignIns: signIns ? 'true' : 'false', page, pageSize: PAGE_SIZE,
  };
  const events = useAuditEvents(params);
  const pages = events.data ? Math.max(1, Math.ceil(events.data.total / PAGE_SIZE)) : 1;
  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };
  const download = async () => {
    setDownloading(true);
    try { await downloadAuditEvents(params); } catch (e) { toast.error(e instanceof Error ? e.message : 'Download failed'); } finally { setDownloading(false); }
  };
  const columns: Column<AuditEvent>[] = [
    { key: 'id', header: '#', cell: (e) => <span className="mono text-muted">{e.id}</span> },
    { key: 'time', header: 'Time', className: 'whitespace-nowrap', cell: (e) => formatDateTime(e.createdAt) },
    {
      key: 'actor', header: 'Who', cell: (e) => e.actorId ? (
        <button type="button" className="text-left hover:underline" title="Show only this person"
          onClick={(ev) => { ev.stopPropagation(); setFilters({ ...filters, actorId: e.actorId as string, actorLabel: e.actorLabel }); setPage(1); }}>{e.actorLabel}</button>
      ) : e.actorLabel,
    },
    { key: 'what', header: 'What happened', cell: (e) => <><span className="text-ink">{e.label}</span><span className="mono block text-[0.8125rem] text-muted">{e.action}</span></> },
    {
      key: 'record', header: 'Record', cell: (e) => e.instrumentId
        ? <Link className="mono text-teal hover:underline" onClick={(ev) => ev.stopPropagation()} to={`/instruments/${e.instrumentId}`}>{e.referenceNo ?? 'Instrument'}</Link>
        : <span className="text-muted">{e.entityType.replace('_', ' ')}</span>,
    },
    {
      key: 'open', header: <span className="sr-only">Details</span>, cell: (e) => (
        <Button variant="ghost" size="sm" aria-label={`Show before and after of event ${e.id}`} onClick={(ev) => { ev.stopPropagation(); setOpen(e); }}>
          Details<ChevronRight className="size-4" aria-hidden />
        </Button>
      ),
    },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold text-ink">Action
          <select className="gov-input mt-1 block w-auto" value={filters.action} onChange={set('action')}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{EVENT_LABELS[a]}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">Record type
          <select className="gov-input mt-1 block w-auto" value={filters.entityType} onChange={set('entityType')}>
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">From<input type="date" className="gov-input mt-1 block w-auto" value={filters.from} onChange={set('from')} /></label>
        <label className="text-sm font-semibold text-ink">To<input type="date" className="gov-input mt-1 block w-auto" value={filters.to} onChange={set('to')} /></label>
        <label className="min-w-0 flex-1 basis-48 text-sm font-semibold text-ink">Search<input type="search" className="gov-input mt-1 block" placeholder="Person, reference, value" value={filters.q} onChange={set('q')} /></label>
        <label className="inline-flex h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-4 accent-teal" checked={signIns} onChange={(e) => { setSignIns(e.target.checked); setPage(1); }} />
          Show sign-ins
        </label>
        <Button variant="secondary" icon={<Download className="size-4" aria-hidden />} loading={downloading} onClick={() => void download()}>Export CSV</Button>
      </div>
      {(filters.actorId || eventId !== null) && (
        <p className="mb-3 flex flex-wrap gap-3 text-sm">
          {filters.actorId && <span>Person: <strong>{filters.actorLabel}</strong> <Button variant="link" size="sm" onClick={() => setFilters({ ...filters, actorId: '', actorLabel: '' })}>Clear</Button></span>}
          {eventId !== null && <span>Event #{eventId} only <Button variant="link" size="sm" onClick={clearEventId}>Show all</Button></span>}
        </p>
      )}
      <Table caption="Audit events, newest first" columns={columns} rows={events.data?.items} rowKey={(e) => String(e.id)} rowTestId="audit-row"
        loading={events.isLoading} error={events.error} onRetry={() => void events.refetch()} onRowClick={setOpen}
        emptyTitle="No events match these filters" emptyDescription="Clear a filter or widen the dates." />
      <Pager page={page} pages={pages} onPage={setPage} total={events.data?.total} noun={events.data?.total === 1 ? 'event' : 'events'} />
      <Drawer open={!!open} width="lg" onClose={() => setOpen(null)} title={open ? `Event #${open.id}: ${open.label}` : ''}
        description={open && <>{formatDateTime(open.createdAt)} · {open.actorLabel} · <span className="mono">{open.action}</span></>}>
        {open && <Diff before={open.before} after={open.after} />}
      </Drawer>
    </div>
  );
}

function DocumentAccessTab() {
  const [instrumentId, setInstrumentId] = useState('');
  const rows = useDocumentAccess(instrumentId);
  const columns: Column<DocumentAccessRow>[] = [
    { key: 'when', header: 'When', className: 'whitespace-nowrap', sortValue: (r) => r.id, cell: (r) => formatDateTime(r.createdAt) },
    { key: 'who', header: 'Who', sortValue: (r) => r.actorLabel, cell: (r) => <>{r.actorLabel}{r.role && <span className="text-[0.8125rem] text-muted"> · {ROLE_LABELS[r.role]}</span>}</> },
    { key: 'doc', header: 'Document', cell: (r) => <>{r.filename ?? 'Document'}{r.docType && <span className="text-[0.8125rem] text-muted"> · {DOC_TYPE_LABELS[r.docType]}</span>}</> },
    { key: 'how', header: 'How', cell: (r) => (r.mode === 'preview' ? 'Viewed' : 'Downloaded') },
    {
      key: 'inst', header: 'Instrument',
      cell: (r) => r.instrumentId ? (
        <span className="flex items-center gap-2">
          <Link className="text-teal hover:underline" to={`/instruments/${r.instrumentId}`}>{r.referenceNo ?? 'Instrument'}</Link>
          {!instrumentId && <button type="button" className="text-[0.8125rem] text-muted underline" onClick={() => setInstrumentId(r.instrumentId as string)}>only this</button>}
        </span>
      ) : '—',
    },
  ];
  return (
    <div>
      {instrumentId && <p className="mb-3 text-sm">One instrument only. <button type="button" className="text-teal underline" onClick={() => setInstrumentId('')}>Show all</button></p>}
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
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Audit log" subtitle="Every action in the portal, hash-chained so that any later change to a record is detected." />
      <IntegrityCard onShowEvent={(id) => { setEventId(id); setTab('events'); }} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'events', label: 'Events', content: <EventsTab eventId={eventId} clearEventId={() => setEventId(null)} /> },
        { id: 'documents', label: 'Document access', content: <DocumentAccessTab /> },
      ]} />
    </div>
  );
}
