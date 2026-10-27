import { ArrowRight, CheckCheck, Inbox, MailCheck, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ALERT_KINDS, ALERT_KIND_LABELS, ALERT_RESOLUTION_LABELS, INSTRUMENT_TYPE_LABELS, type Alert, type AlertKind, type AlertStatus, type Role } from '@fdr/shared';
import { useAcknowledgeAlert, useAlerts, useResolveAlert } from '@/api/alerts';
import { useAuth } from '@/auth/AuthContext';
import {
  AlertKindChip, AlertLevelChip, Button, DateText, Drawer, EmptyState, FormField, Money, PageHeader, Panel, StatusChip, Tabs, useToast,
} from '@/components';
import { NoteModal } from '@/components/NoteModal';

const TABS: { id: AlertStatus; label: string; empty: string }[] = [
  { id: 'OPEN', label: 'Open', empty: 'No open alerts. Nothing needs your attention right now.' },
  { id: 'ACKNOWLEDGED', label: 'Acknowledged', empty: 'Nothing acknowledged and still waiting.' },
  { id: 'ESCALATED', label: 'Escalated', empty: 'None of your alerts has been escalated.' },
  { id: 'RESOLVED', label: 'Resolved', empty: 'No resolved alerts yet.' },
];

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 rounded-[8px] bg-chip px-2 py-0.5 font-medium text-ink-2 hover:bg-border">
      {label}<X className="size-3.5" aria-hidden /><span className="sr-only"> (remove filter)</span>
    </button>
  );
}

const RESOLVERS: Role[] = ['officer', 'approver', 'admin'];

/** Every role opens the instrument's passport. */
const instrumentPath = (id: string) => `/instruments/${id}`;

interface Group { instrumentId: string; first: Alert; alerts: Alert[] }

function groupByInstrument(alerts: Alert[]): Group[] {
  const groups = new Map<string, Group>();
  for (const a of alerts) {
    const g = groups.get(a.instrumentId);
    if (g) g.alerts.push(a);
    else groups.set(a.instrumentId, { instrumentId: a.instrumentId, first: a, alerts: [a] });
  }
  return [...groups.values()];
}

export function AlertsInbox() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<AlertStatus>('OPEN');
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<Alert | null>(null);
  const [kind, setKind] = useState<AlertKind | ''>('');
  const [level, setLevel] = useState('');
  const [drawer, setDrawer] = useState(false);
  const alerts = useAlerts({ status: tab, kind, level, page, pageSize: 100 });
  const ack = useAcknowledgeAlert();
  const resolve = useResolveAlert();
  const groups = useMemo(() => groupByInstrument(alerts.data?.items ?? []), [alerts.data]);
  if (!user) return null;
  const filterCount = (kind ? 1 : 0) + (level ? 1 : 0);
  const canAct = user.role !== 'auditor';
  const canResolve = RESOLVERS.includes(user.role);
  const pages = alerts.data ? Math.max(1, Math.ceil(alerts.data.total / alerts.data.pageSize)) : 1;

  const list = (
    <div className="space-y-4" data-testid="alert-groups">
      {alerts.isLoading && <p className="text-sm text-muted">Loading alerts…</p>}
      {alerts.isError && <p className="text-sm text-danger-700">Could not load alerts. {alerts.error.message}</p>}
      {alerts.data && groups.length === 0 && (
        <EmptyState icon={Inbox} title="Nothing here" description={TABS.find((t) => t.id === tab)?.empty} />
      )}
      {groups.length > 0 && (
        <Panel flush>
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <li key={g.instrumentId} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1" data-testid="alert-group">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <span>{INSTRUMENT_TYPE_LABELS[g.first.instrumentType]} <span className="mono">{g.first.instrumentReferenceNo ?? '(no reference)'}</span></span>
                      <StatusChip status={g.first.instrumentStatus} />
                    </p>
                    <p className="mt-0.5 text-[0.8125rem] text-muted">
                      {g.first.institutionName} · {g.first.issuingBank ?? 'bank not given'} · <Money amount={g.first.amount} />
                      {g.first.maturityDate && <> · matures <DateText value={g.first.maturityDate} /></>}
                    </p>
                  </div>
                  <Link to={instrumentPath(g.instrumentId)} className="gov-link inline-flex items-center gap-1 text-sm font-semibold">
                    Open instrument <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </div>
                <ul className="mt-2">
                  {g.alerts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-hairline py-3 first:border-0" data-testid="alert-row">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <AlertKindChip kind={a.kind} />
                          <AlertLevelChip level={a.level} role={a.level > 1 ? a.recipientRole : undefined} />
                          <span className="text-[0.8125rem] text-muted">
                            Due <DateText value={a.dueDate} /> · {a.ageDays === 1 ? '1 day' : `${a.ageDays} days`} old
                          </span>
                        </div>
                        <p className="text-[0.9375rem] text-ink">{a.message}</p>
                        {a.status === 'RESOLVED' && a.resolution && (
                          <p className="text-[0.8125rem] text-muted">
                            {ALERT_RESOLUTION_LABELS[a.resolution]}{a.resolutionNote ? ` — “${a.resolutionNote}”` : ''}
                          </p>
                        )}
                        {a.status === 'ACKNOWLEDGED' && (
                          <p className="text-[0.8125rem] text-muted">Acknowledged. It still escalates until the cause is fixed or it is resolved.</p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {canAct && a.status === 'OPEN' && (
                          <Button size="sm" variant="ghost" icon={<MailCheck className="size-4" aria-hidden />}
                            loading={ack.isPending && ack.variables === a.id}
                            onClick={() => ack.mutate(a.id, { onError: (e) => toast.error(e.message) })}>
                            Acknowledge
                          </Button>
                        )}
                        {canResolve && a.status !== 'RESOLVED' && (
                          <Button size="sm" variant="ghost" icon={<CheckCheck className="size-4" aria-hidden />} onClick={() => { resolve.reset(); setResolving(a); }}>
                            Resolve with note
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader
        title="Alerts"
        subtitle="Reminders, overdue items and escalations addressed to you, grouped by instrument. Fixing the cause closes an alert automatically."
        actions={
          <Button variant="secondary" icon={<SlidersHorizontal className="size-4" aria-hidden />} onClick={() => setDrawer(true)} aria-haspopup="dialog">
            Filters{filterCount > 0 && <span className="rounded-[6px] bg-ink px-1.5 text-xs text-white tabular-nums">{filterCount}</span>}
          </Button>
        }
      />
      {filterCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {kind && <FilterChip label={ALERT_KIND_LABELS[kind]} onRemove={() => { setKind(''); setPage(1); }} />}
          {level && <FilterChip label={`Level ${level}`} onRemove={() => { setLevel(''); setPage(1); }} />}
        </div>
      )}
      <Tabs
        value={tab}
        onChange={(id) => { setTab(id as AlertStatus); setPage(1); }}
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, content: t.id === tab ? list : null }))}
      />
      <Drawer open={drawer} title="Filter alerts" onClose={() => setDrawer(false)}>
        <div className="space-y-4">
          <FormField id="f-kind" label="Kind">
            <select id="f-kind" className="gov-input" value={kind} onChange={(e) => { setKind(e.target.value as AlertKind | ''); setPage(1); }}>
              <option value="">All kinds</option>
              {ALERT_KINDS.map((k) => <option key={k} value={k}>{ALERT_KIND_LABELS[k]}</option>)}
            </select>
          </FormField>
          <FormField id="f-level" label="Escalation level">
            <select id="f-level" className="gov-input" value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }}>
              <option value="">All levels</option>
              {[1, 2, 3].map((l) => <option key={l} value={String(l)}>Level {l}</option>)}
            </select>
          </FormField>
          <p className="text-[0.8125rem] text-muted">The tabs above the list choose open, acknowledged, escalated or resolved alerts.</p>
          <div className="flex gap-2 pt-2">
            <Button className="flex-1" onClick={() => setDrawer(false)}>Show alerts</Button>
            <Button variant="secondary" onClick={() => { setKind(''); setLevel(''); setPage(1); }}>Clear</Button>
          </div>
        </div>
      </Drawer>
      <NoteModal
        open={!!resolving}
        title="Resolve alert"
        label="Note"
        submitLabel="Resolve"
        intro="Closes this alert by hand and records your note. It does not change the instrument; the decision on the instrument stays with the responsible official."
        onClose={() => setResolving(null)}
        pending={resolve.isPending}
        error={resolve.error}
        onSubmit={(note) => resolving && resolve.mutate({ id: resolving.id, note }, {
          onSuccess: () => { setResolving(null); toast.success('Alert resolved'); },
        })}
      />
    </div>
  );
}
