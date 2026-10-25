import { CheckCircle2, Hourglass, Landmark, MessageSquarePlus, ShieldAlert, Undo2, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LIVE_STATUSES, type ReviewPayload, type VerifyResponse } from '@fdr/shared';
import { useAccept, useVerify } from '@/api/scrutiny';
import { Button, useToast } from '@/components';
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

export function ActionBar({ review, canAct, onReturn, onAddObservation }: {
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
    <section aria-label="Actions" className="mb-4 space-y-3">
      {state === 'PENDING' && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-info-600/30 bg-info-50 px-4 py-2 text-sm text-info-700">
          <Hourglass className="size-4" aria-hidden />
          {retryIn > 0 ? `Bank is processing — retry in ${retryIn}s` : 'Bank is processing — you can ask again now'}
        </div>
      )}
      {state === 'UNAVAILABLE' && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          <WifiOff className="size-4" aria-hidden />
          Bank verification unavailable — confirm against documents and use override
        </div>
      )}
      {canAct && (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 bg-surface p-3 shadow-sm">
          {verifiable && (
            <Button icon={<Landmark className="size-4" aria-hidden />} loading={verify.isPending} disabled={retryIn > 0} onClick={onVerify} variant={inScrutiny ? 'primary' : 'secondary'}>
              {verify.isPending ? 'Asking the bank…' : live ? 'Re-verify with bank' : 'Verify with bank'}
            </Button>
          )}
          <Button variant="secondary" icon={<MessageSquarePlus className="size-4" aria-hidden />} onClick={onAddObservation}>Add observation</Button>
          {(inScrutiny || inst.status === 'SUBMITTED') && (
            <Button variant="secondary" icon={<Undo2 className="size-4" aria-hidden />} onClick={onReturn}>Return to institution</Button>
          )}
          {inScrutiny && (
            <div className="ml-auto flex flex-col items-end gap-1">
              <div className="flex gap-2">
                {review.canAcceptWithOverride && (
                  <Button variant="secondary" icon={<ShieldAlert className="size-4" aria-hidden />} onClick={() => { accept.reset(); setOverrideOpen(true); }}>
                    Accept with override
                  </Button>
                )}
                <Button icon={<CheckCircle2 className="size-4" aria-hidden />} disabled={!review.canAccept} loading={accept.isPending && !overrideOpen}
                  aria-describedby={review.canAccept ? undefined : 'accept-blockers'} onClick={() => onAccept()}>
                  Accept
                </Button>
              </div>
              {!review.canAccept && review.acceptBlockers.length > 0 && (
                <div id="accept-blockers" className="max-w-md text-right text-xs text-slate-600">
                  <p className="font-medium text-slate-700">Accept is not available yet:</p>
                  <ul>{review.acceptBlockers.map((b) => <li key={b}>• {b}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {canAct && <p className="text-xs text-slate-500">The portal checks and records; the decision to accept or return is yours. Nothing is accepted automatically.</p>}
      <NoteModal
        open={overrideOpen}
        title="Accept without bank confirmation"
        label="Override note (why you accept without bank confirmation)"
        submitLabel="Accept with override"
        variant="danger"
        intro={
          <p className="flex items-start gap-2 rounded-md border border-warning-600/30 bg-warning-50 px-3 py-2 text-warning-700">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            The bank has not confirmed this instrument. Your note is recorded in the audit trail and the passport will show
            “Accepted without bank confirmation”.
          </p>
        }
        pending={accept.isPending}
        error={accept.error}
        onClose={() => setOverrideOpen(false)}
        onSubmit={(note) => onAccept(note)}
      />
    </section>
  );
}
