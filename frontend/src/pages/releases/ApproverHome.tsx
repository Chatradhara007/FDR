import { useDashboard } from '@/api/reporting';
import { useReleaseRequests } from '@/api/releases';
import { CountUp, PageHeader, StatRow, StatTile } from '@/components';
import { MyDayList } from '@/pages/myday/MyDay';
import { DecisionBanner } from './parts';
import { ReleaseTable } from './ReleaseList';

/** /approver: release decisions waiting for the competent authority first, then My day. */
export function ApproverHome() {
  const pending = useReleaseRequests({ awaitingMe: true, pageSize: 100 });
  const d = useDashboard({}).data;
  const n = (v: number | undefined) => (v === undefined ? '—' : <CountUp value={v} />);
  const soon = d?.maturityBuckets.find((b) => b.key === 'd0_30')?.count;
  return (
    <div className="space-y-10">
      <PageHeader title="Approvals" subtitle="Release requests recommended by the scrutiny officer, waiting for your decision." />
      <StatRow>
        <StatTile label="Awaiting your decision" value={n(pending.data?.total)} tone={pending.data?.total ? 'warning' : undefined} />
        <StatTile label="Escalated" value={n(d?.kpis.openEscalations)} to="/alerts" />
        <StatTile label="Maturing within 30 days" value={n(soon)} to="/dashboard" />
      </StatRow>
      <section aria-labelledby="awaiting">
        <h2 id="awaiting" className="mb-4 text-xl font-semibold text-slate-900">Awaiting your decision</h2>
        <DecisionBanner />
        <ReleaseTable rows={pending.data?.items} loading={pending.isLoading} emptyTitle="No release decision is waiting for you" />
      </section>
      <MyDayList limit={10} title="My day" />
    </div>
  );
}
