import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAlerts } from '@/api/alerts';
import { useReleaseRequests } from '@/api/releases';
import { AlertKindChip, AlertLevelChip, Card, PageHeader } from '@/components';
import { MyDayList } from '@/pages/myday/MyDay';
import { DecisionBanner } from './parts';
import { ReleaseTable } from './ReleaseList';

/** /approver: release decisions waiting for the competent authority, and the alerts escalated to it. */
export function ApproverHome() {
  const pending = useReleaseRequests({ awaitingMe: true, pageSize: 100 });
  const alerts = useAlerts({ status: 'open', pageSize: 10 });
  const items = alerts.data?.items ?? [];
  return (
    <>
      <PageHeader title="Approvals" subtitle="Release requests and escalations that need a competent-authority decision." />
      <DecisionBanner />
      <div className="space-y-4">
        <MyDayList limit={10} />
        <Card title={`Decisions waiting for you (${pending.data?.total ?? 0})`}>
          <ReleaseTable rows={pending.data?.items} loading={pending.isLoading} emptyTitle="No release decision is waiting for you" />
        </Card>
        <Card title={`Open alerts for the competent authority (${alerts.data?.total ?? 0})`}
          actions={<Link to="/alerts" className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline">Alerts inbox <ArrowRight className="size-4" aria-hidden /></Link>}>
          {items.length === 0 ? <p className="text-sm text-slate-500">Nothing escalated to you.</p> : (
            <ul className="divide-y divide-slate-100">
              {items.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertKindChip kind={a.kind} />
                    <AlertLevelChip level={a.level} role={a.level > 1 ? a.recipientRole : undefined} />
                    <Link to={`/instruments/${a.instrumentId}`} className="font-medium text-primary-700 hover:underline">{a.instrumentReferenceNo ?? 'Instrument'}</Link>
                    <span className="text-xs text-slate-500">{a.institutionName}</span>
                  </div>
                  <p className="mt-1 text-slate-700">{a.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
