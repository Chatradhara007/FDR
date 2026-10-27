import { Hand } from 'lucide-react';
import { BackLink } from '@/components/PageHeader';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS } from '@fdr/shared';
import { useClaim, useReturnInstrument, useReview } from '@/api/scrutiny';
import { useAuth } from '@/auth/AuthContext';
import { Button, Card, DateText, EmptyState, Kicker, Money, Notice, ProofLegend, ProofStrip, StatusChip, Tabs, VerificationChip, useToast } from '@/components';
import { Comparison } from './review/Comparison';
import { DecisionPanel } from './review/DecisionPanel';
import { AdvisoryPanel } from './review/AdvisoryPanel';
import { DiscrepancyCards } from './review/DiscrepancyCards';
import { DocumentsTab } from './review/DocumentsTab';
import { NoteModal } from '@/components/NoteModal';
import { ObservationsTab } from './review/ObservationsTab';
import { VerificationHistory } from './review/VerificationHistory';

/** The officer's review screen: claimed against confirmed, per field. */
export function ReviewPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const q = useReview(id);
  const claim = useClaim();
  const ret = useReturnInstrument(id);
  const [tab, setTab] = useState('documents');
  const [returnText, setReturnText] = useState<string | null>(null);

  if (q.isError) return <EmptyState title="Instrument not found" description="It may have been deleted, or the link is wrong." />;
  const review = q.data;
  if (!review) return <p className="text-sm text-muted">Loading…</p>;
  const inst = review.instrument;
  const isOfficer = user?.role === 'officer';
  const canReturn = inst.status === 'SUBMITTED' || inst.status === 'UNDER_SCRUTINY';
  const openReturn = (suggested = '') => { ret.reset(); setReturnText(suggested); };
  const latestReturn = inst.returns[0];

  return (
    <div className="mx-auto max-w-[1400px]">
      <BackLink to="/officer/queue" label="Scrutiny queue" />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <Kicker>{INSTRUMENT_TYPE_LABELS[inst.type]} · {inst.institutionName}</Kicker>
          <h1 className="mono mt-1 text-[1.75rem] leading-tight font-bold tracking-[-0.02em] break-all sm:text-[1.875rem]">{inst.referenceNo}</h1>
          <p className="mt-1.5 text-base text-ink-2">
            {inst.issuingBank}{inst.branch ? `, ${inst.branch}` : ''} · <span className="font-semibold"><Money amount={inst.amount} /></span> · matures <DateText value={inst.maturityDate} />
          </p>
          <p className="mt-1 text-sm text-muted">
            Submitted <DateText value={inst.submittedAt} /> · {review.assignedOfficerName ? `Assigned to ${review.assignedOfficerName}` : 'Not yet claimed'} ·{' '}
            <Link to={`/instruments/${inst.id}`} className="gov-link font-medium">Open passport (timeline, chain, alerts)</Link>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <ProofStrip provenance={review.fields} />
            <ProofLegend />
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <StatusChip status={inst.status} />
            <VerificationChip state={inst.verificationState} />
          </div>
          {isOfficer && inst.status === 'SUBMITTED' && (
            <Button size="lg" icon={<Hand className="size-4" aria-hidden />} loading={claim.isPending}
              onClick={() => claim.mutate(inst.id, { onSuccess: () => toast.success('Case claimed'), onError: (e) => toast.error(e.message) })}>
              Claim this case
            </Button>
          )}
        </div>
      </header>
      {inst.status === 'RETURNED' && latestReturn && (
        <Notice kind="warning" className="mb-4">Returned to the institution: “{latestReturn.reason}”</Notice>
      )}
      {inst.acceptedWithOverride && <Notice kind="warning" className="mb-4">Accepted without bank confirmation: {inst.overrideNote}</Notice>}

      {/* Under 1100px the side column stacks below the main content. From 1100px it is ONE sticky container, capped
          to the screen height (the shell header scrolls away, so: 100vh - 16px top - 24px) with its own scroll, so
          the cards inside stack with a normal gap and every action stays reachable on a short screen. */}
      <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
        <div data-testid="review-main" className="min-w-0 space-y-5">
          <Comparison review={review} onReturn={isOfficer && canReturn ? openReturn : undefined} />
          <DiscrepancyCards discrepancies={review.discrepancies} canAct={isOfficer} />
          <Card>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'documents', label: `Documents (${inst.documents.length})`, content: <DocumentsTab review={review} canCheck={isOfficer && inst.status === 'UNDER_SCRUTINY'} /> },
                { id: 'verifications', label: `Verification history (${review.verifications.length})`, content: <VerificationHistory verifications={review.verifications} /> },
                { id: 'observations', label: `Observations (${review.observations.filter((o) => o.status === 'OPEN').length} open)`, content: <ObservationsTab review={review} canAct={isOfficer} /> },
              ]}
            />
          </Card>
        </div>
        <aside data-testid="review-side" aria-label="Decision"
          className="min-w-0 space-y-5 min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:max-h-[calc(100vh-40px)] min-[1100px]:overflow-y-auto min-[1100px]:overscroll-contain min-[1100px]:rounded-[14px]">
          <DecisionPanel review={review} canAct={isOfficer} onReturn={() => openReturn()} onAddObservation={() => setTab('observations')} />
          <AdvisoryPanel review={review} />
        </aside>
      </div>

      <NoteModal
        open={returnText !== null}
        initial={returnText ?? ''}
        title="Return to institution"
        label="Reason (shown to the institution)"
        submitLabel="Return"
        variant="danger"
        intro="The institution sees this reason, corrects the record and submits again. Unchanged fields keep their trust level."
        pending={ret.isPending}
        error={ret.error}
        onClose={() => setReturnText(null)}
        onSubmit={(reason) => ret.mutate(reason, { onSuccess: () => { setReturnText(null); toast.success('Returned to the institution'); } })}
      />
    </div>
  );
}
