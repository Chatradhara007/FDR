import { useDashboard } from '@/api/reporting';
import { CountUp, PageHeader, StatRow, StatTile } from '@/components';
import { MyDayList } from './MyDay';

/** /officer: the ranked worklist is the page; three numbers above it. */
export function OfficerHome() {
  const d = useDashboard({}).data;
  const n = (v: number | undefined) => (v === undefined ? '—' : <CountUp value={v} />);
  return (
    <div className="space-y-10">
      <PageHeader title="My day" subtitle="What to act on first. The order is a suggestion; the decisions stay yours." />
      <StatRow>
        <StatTile label="To verify" value={n(d?.kpis.pendingScrutiny)} to="/officer/queue" />
        <StatTile label="Open discrepancies" value={n(d?.kpis.openDiscrepancies)} tone={d?.kpis.openDiscrepancies ? 'danger' : undefined} to="/reports?preset=discrepancies" />
        <StatTile label="Escalated" value={n(d?.kpis.openEscalations)} tone={d?.kpis.openEscalations ? 'warning' : undefined} to="/alerts" />
      </StatRow>
      <MyDayList />
    </div>
  );
}
