import { PageHeader } from '@/components';
import { MyDayList } from './MyDay';

/** /officer: the scrutiny officer's ranked worklist. */
export function OfficerHome() {
  return (
    <>
      <PageHeader title="My day" subtitle="What to act on first, ranked by amount, urgency, verification, discrepancies and escalation." />
      <MyDayList />
    </>
  );
}
