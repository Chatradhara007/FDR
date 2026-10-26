import { CheckCheck, ExternalLink, Inbox, MailCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ALERT_RESOLUTION_LABELS, INSTRUMENT_TYPE_LABELS, type Alert, type AlertStatus, type Role } from '@fdr/shared';
import { useAcknowledgeAlert, useAlerts, useResolveAlert } from '@/api/alerts';
import { useAuth } from '@/auth/AuthContext';
import {
  AlertKindChip, AlertLevelChip, Button, Card, DateText, EmptyState, Money, PageHeader, StatusChip, Tabs, useToast,
} from '@/components';
import { NoteModal } from '@/components/NoteModal';

const TABS: { id: AlertStatus; label: string; empty: string }[] = [
  { id: 'OPEN', label: 'Open', empty: 'No open alerts. Nothing needs your attention right now.' },
  { id: 'ACKNOWLEDGED', label: 'Acknowledged', empty: 'Nothing acknowledged and still waiting.' },
  { id: 'ESCALATED', label: 'Escalated', empty: 'None of your alerts has been escalated.' },
  { id: 'RESOLVED', label: 'Resolved', empty: 'No resolved alerts yet.' },
];

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
  const alerts = useAlerts({ status: tab, page, pageSize: 100 });
  const ack = useAcknowledgeAlert();
  const resolve = useResolveAlert();
  const groups = useMemo(() => groupByInstrument(alerts.data?.items ?? []), [alerts.data]);
  if (!user) return null;
  const canAct = user.role !== 'auditor';
  const canResolve = RESOLVERS.includes(user.role);
  const pages = alerts.data ? Math.max(1, Math.ceil(alerts.data.total / alerts.data.pageSize)) : 1;

  const list = (
    <div className="space-y-4" data-testid="alert-groups">
      {alerts.isLoading && <p className="text-sm text-slate-500">Loading alerts…</p>}
      {alerts.isError && <p className="text-sm text-danger-700">Could not load alerts. {alerts.error.message}</p>}
      {alerts.data && groups.length === 0 && (
        <EmptyState icon={Inbox} title="Nothing here" description={TABS.find((t) => t.id === tab)?.empty} />
      )}
      {groups.map((g) => (
        <Card
          key={g.instrumentId}
          title={
            <span className="flex flex-wrap items-center gap-2" data-testid="alert-group">
              <span>{INSTRUMENT_TYPE_LABELS[g.first.instrumentType]} {g.first.instrumentReferenceNo ?? '(no reference)'}</span>
              <StatusChip status={g.first.instrumentStatus} />
            </span>
          }
          actions={
            <Link to={instrumentPath(g.instrumentId)} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline">
              <ExternalLink className="size-4" aria-hidden /> Open instrument
            </Link>
          }
        >
          <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-600">
            {g.first.institutionName} · {g.first.issuingBank ?? 'bank not given'} · <Money amount={g.first.amount} />
            {g.first.maturityDate && <> · matures <DateText value={g.first.maturityDate} /></>}
          </p>
          <ul className="divide-y divide-slate-100">
            {g.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" data-testid="alert-row">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertKindChip kind={a.kind} />
                    <AlertLevelChip level={a.level} role={a.level > 1 ? a.recipientRole : undefined} />
                    <span className="text-xs text-slate-500">
                      Due <DateText value={a.dueDate} /> · {a.ageDays === 1 ? '1 day' : `${a.ageDays} days`} old
                    </span>
                  </div>
                  <p className="text-sm text-slate-800">{a.message}</p>
                  {a.status === 'RESOLVED' && a.resolution && (
                    <p className="text-xs text-slate-500">
                      {ALERT_RESOLUTION_LABELS[a.resolution]}{a.resolutionNote ? ` — “${a.resolutionNote}”` : ''}
                    </p>
                  )}
                  {a.status === 'ACKNOWLEDGED' && (
                    <p className="text-xs text-slate-500">Acknowledged. It still escalates until the cause is fixed or it is resolved.</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {canAct && a.status === 'OPEN' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<MailCheck className="size-4" aria-hidden />}
                      loading={ack.isPending && ack.variables === a.id}
                      onClick={() => ack.mutate(a.id, { onError: (e) => toast.error(e.message) })}
                    >
                      Acknowledge
                    </Button>
                  )}
                  {canResolve && a.status !== 'RESOLVED' && (
                    <Button size="sm" variant="secondary" icon={<CheckCheck className="size-4" aria-hidden />} onClick={() => { resolve.reset(); setResolving(a); }}>
                      Resolve with note
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
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
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Reminders, overdue items and escalations addressed to you, grouped by instrument. Fixing the cause closes an alert automatically."
      />
      <Tabs
        value={tab}
        onChange={(id) => { setTab(id as AlertStatus); setPage(1); }}
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, content: t.id === tab ? list : null }))}
      />
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
