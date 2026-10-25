import { ArrowLeft, Hand, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { INSTRUMENT_TYPE_LABELS } from '@fdr/shared';
import { useClaim, useReturnInstrument, useReview } from '@/api/scrutiny';
import { useAuth } from '@/auth/AuthContext';
import { Button, Card, DateText, EmptyState, Money, StatusChip, Tabs, VerificationChip, WeakestTierBadge, useToast } from '@/components';
import { ActionBar } from './review/ActionBar';
import { Checklist } from './review/Checklist';
import { DiscrepancyCards } from './review/DiscrepancyCards';
import { DocumentsTab } from './review/DocumentsTab';
import { FieldsPanel } from './review/FieldsPanel';
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
  if (!review) return <p className="text-sm text-slate-500">Loading…</p>;
  const inst = review.instrument;
  const isOfficer = user?.role === 'officer';
  const canReturn = inst.status === 'SUBMITTED' || inst.status === 'UNDER_SCRUTINY';
  const openReturn = (suggested = '') => { ret.reset(); setReturnText(suggested); };
  const latestReturn = inst.returns[0];

  return (
    <>
      <Link to="/officer/queue" className="mb-3 inline-flex items-center gap-1 text-sm text-primary-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Scrutiny queue
      </Link>
      <header className="mb-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{INSTRUMENT_TYPE_LABELS[inst.type]} · {inst.institutionName}</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{inst.referenceNo}</h1>
            <p className="mt-1 text-sm text-slate-700">
              {inst.issuingBank}{inst.branch ? `, ${inst.branch}` : ''} · <span className="font-semibold"><Money amount={inst.amount} /></span> · matures <DateText value={inst.maturityDate} />
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Submitted <DateText value={inst.submittedAt} /> · {review.assignedOfficerName ? `Assigned to ${review.assignedOfficerName}` : 'Not yet claimed'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap gap-2">
              <StatusChip status={inst.status} />
              <VerificationChip state={inst.verificationState} />
            </div>
            <WeakestTierBadge tier={inst.weakestTier} />
            {isOfficer && inst.status === 'SUBMITTED' && (
              <Button size="sm" icon={<Hand className="size-4" aria-hidden />} loading={claim.isPending}
                onClick={() => claim.mutate(inst.id, { onSuccess: () => toast.success('Case claimed'), onError: (e) => toast.error(e.message) })}>
                Claim this case
              </Button>
            )}
          </div>
        </div>
        {inst.status === 'RETURNED' && latestReturn && (
          <p className="mt-3 flex items-center gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
            <Undo2 className="size-4" aria-hidden /> Returned to the institution: “{latestReturn.reason}”
          </p>
        )}
        {inst.acceptedWithOverride && <p className="mt-3 text-sm font-medium text-warning-700">Accepted without bank confirmation: {inst.overrideNote}</p>}
      </header>

      <ActionBar review={review} canAct={isOfficer} onReturn={() => openReturn()} onAddObservation={() => setTab('observations')} />
      <DiscrepancyCards discrepancies={review.discrepancies} canAct={isOfficer} canReturn={canReturn} onReturn={openReturn} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <FieldsPanel review={review} />
          <Checklist gaps={review.gaps} />
        </div>
        <Card className="lg:col-span-3">
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
    </>
  );
}
