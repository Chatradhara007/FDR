import { CheckCircle2, CircleAlert, Landmark, MessageSquarePlus, ShieldAlert, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LIVE_STATUSES, type ReviewPayload, type VerifyResponse } from '@fdr/shared';
import { useAccept, useVerify } from '@/api/scrutiny';
import { Button, ConditionLine, Notice, Panel, useToast } from '@/components';
import { NoteModal } from '@/components/NoteModal';

/** Seconds left on the bank's "retry after", counting down once a second. */
function useCountdown(): [number, (s: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}

const RESULT_TOAST: Record<string, string> = {
  CONFIRMED: 'Bank confirmed every field',
  MISMATCH: 'The bank record differs — see the discrepancy',
  NOT_FOUND: 'The bank has no record of this reference',
  PENDING: 'The bank is processing the request',
  UNAVAILABLE: 'Bank verification is unavailable',
};

/** "Can this be accepted?": every blocker from the server, the officer's judgement calls, and the actions.
 *  Accept is the one primary button; the software never accepts on its own. */
export function DecisionPanel({ review, canAct, onReturn, onAddObservation }: {
  review: ReviewPayload;
  canAct: boolean;
  onReturn: () => void;
  onAddObservation: () => void;
}) {
  const inst = review.instrument;
  const toast = useToast();
  const verify = useVerify(inst.id);
  const accept = useAccept(inst.id);
  const [retryIn, setRetryIn] = useCountdown();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const live = LIVE_STATUSES.includes(inst.status);
  const verifiable = inst.status === 'UNDER_SCRUTINY' || live;
  const inScrutiny = inst.status === 'UNDER_SCRUTINY';
  const warnings = review.gaps.filter((g) => g.severity === 'warning');

  const onVerify = () =>
    verify.mutate(undefined, {
      onSuccess: (r: VerifyResponse) => {
        if (r.result === 'PENDING') setRetryIn(r.retryAfterSeconds ?? 5);
        const kind = r.result === 'CONFIRMED' ? 'success' : r.result === 'PENDING' ? 'info' : 'warning';
        toast[kind](RESULT_TOAST[r.result] ?? r.result);
      },
      onError: (err) => toast.error(err.message),
    });

  const onAccept = (overrideNote?: string) =>
    accept.mutate(overrideNote, {
      onSuccess: () => { setOverrideOpen(false); toast.success('Instrument accepted — now Active'); },
      onError: (err) => { if (!overrideNote) toast.error(err.message); },
    });

  const state = inst.verificationState;
  return (
    <Panel title={inScrutiny || inst.status === 'SUBMITTED' ? 'Can this be accepted?' : 'Bank check'} className="lg:sticky lg:top-4">
      <section aria-label="Actions" className="space-y-4">
        {state === 'PENDING' && (
          <Notice role="status">{retryIn > 0 ? `Bank is processing — retry in ${retryIn}s` : 'Bank is processing — you can ask again now'}</Notice>
        )}
        {state === 'UNAVAILABLE' && (
          <Notice role="status" kind="warning">Bank verification unavailable — confirm against documents and use override</Notice>
        )}
        {(inScrutiny || inst.status === 'SUBMITTED') && (
          <div id="accept-blockers" className="-mt-1">
            {review.canAccept ? (
              <ConditionLine met>Nothing stands in the way. Accepting is your decision.</ConditionLine>
            ) : (
              <>
                <p className="mb-1 text-sm font-semibold">Accept is not available yet:</p>
                {review.acceptBlockers.map((b) => <ConditionLine key={b} met={false}>{b}</ConditionLine>)}
              </>
            )}
            {warnings.length > 0 && (
              <>
                <p className="mt-3 mb-1 text-sm font-semibold">For your judgement (does not block)</p>
                {warnings.map((g, i) => (
                  <div key={`${g.code}-${g.ref ?? i}`} className="flex items-start gap-2.5 border-t border-hairline py-2.5 text-[0.90625rem] leading-snug text-attn-text">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /><span><span className="sr-only">Warning: </span>{g.message}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        {canAct && (
          <div className="flex flex-col gap-2">
            {inScrutiny && (
              <Button size="lg" icon={<CheckCircle2 className="size-4" aria-hidden />} disabled={!review.canAccept} loading={accept.isPending && !overrideOpen}
                aria-describedby={review.canAccept ? undefined : 'accept-blockers'} onClick={() => onAccept()}>
                Accept
              </Button>
            )}
            {inScrutiny && review.canAcceptWithOverride && (
              <Button variant="secondary" icon={<ShieldAlert className="size-4" aria-hidden />} onClick={() => { accept.reset(); setOverrideOpen(true); }}>
                Accept with override
              </Button>
            )}
            {verifiable && (
              <Button variant="dark" icon={<Landmark className="size-4" aria-hidden />} loading={verify.isPending} disabled={retryIn > 0} onClick={onVerify}>
                {verify.isPending ? 'Asking the bank…' : live ? 'Re-verify with bank' : 'Verify with bank'}
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              {(inScrutiny || inst.status === 'SUBMITTED') && (
                <Button variant="secondary" className="flex-1" icon={<Undo2 className="size-4" aria-hidden />} onClick={onReturn}>Return to institution</Button>
              )}
              <Button variant="secondary" className="flex-1" icon={<MessageSquarePlus className="size-4" aria-hidden />} onClick={onAddObservation}>Add observation</Button>
            </div>
            <p className="text-[0.8125rem] text-muted">The portal checks and records; the decision to accept or return is yours. Nothing is accepted automatically.</p>
          </div>
        )}
      </section>
      <NoteModal
        open={overrideOpen}
        title="Accept without bank confirmation"
        label="Override note (why you accept without bank confirmation)"
        submitLabel="Accept with override"
        variant="danger"
        intro={
          <Notice kind="warning">
            The bank has not confirmed this instrument. Your note is recorded in the audit trail and the passport will show
            “Accepted without bank confirmation”.
          </Notice>
        }
        pending={accept.isPending}
        error={accept.error}
        onClose={() => setOverrideOpen(false)}
        onSubmit={(note) => onAccept(note)}
      />
    </Panel>
  );
}
