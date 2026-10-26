import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, ClipboardCheck, FileText, Landmark, Printer, ThumbsUp, Undo2, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { INSTRUMENT_TYPE_LABELS, VERIFIABLE_STATUSES, type ReleaseView, type VerifyResponse } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useDecide, useRecommend, useReleaseRequest } from '@/api/releases';
import { useVerify } from '@/api/scrutiny';
import { useAuth } from '@/auth/AuthContext';
import {
  Button, Card, DateText, DocumentList, EmptyState, FieldError, Modal, Money, ReleaseStatusChip, StatusChip, VerificationChip, useToast,
} from '@/components';
import { NoteModal } from '@/components/NoteModal';
import { ROLE_HOME } from '@/lib/roles';
import { ApprovalChain, BlockedBanner, ConditionsList, DecisionBanner, RequestFacts } from './parts';

type Pending = null | 'recommend' | 'approve' | 'return' | 'reject';

/** Approve: mandatory remarks plus the refund reference at the final level. */
function ApproveModal({ open, final, onClose, onSubmit, pending, error }: {
  open: boolean; final: boolean; onClose: () => void; onSubmit: (remarks: string, refund: string) => void; pending: boolean; error: unknown;
}) {
  const [remarks, setRemarks] = useState('');
  const [refund, setRefund] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => { if (open) { setRemarks(''); setRefund(''); setLocal(null); } }, [open]);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  return (
    <Modal open={open} title={final ? 'Approve release' : 'Approve at this level'} onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={pending} icon={<CheckCircle2 className="size-4" aria-hidden />}
          onClick={() => (remarks.trim() ? onSubmit(remarks.trim(), refund.trim()) : setLocal('Remarks are required'))}>
          Approve
        </Button>
      </>}>
      <p className="mb-3 text-slate-700">
        {final
          ? 'Approving releases the instrument. The conditions are checked again at this moment; if one fails the approval is refused.'
          : 'The request then goes to the next level, which a different person must decide.'}
      </p>
      <label htmlFor="approve-remarks" className="mb-1 block text-xs font-medium text-slate-600">Remarks</label>
      <textarea id="approve-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)}
        aria-invalid={!!(local ?? fields.remarks)} aria-describedby="approve-remarks-err"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <FieldError id="approve-remarks-err" message={local ?? fields.remarks} />
      {final && (
        <>
          <label htmlFor="approve-refund" className="mt-3 mb-1 block text-xs font-medium text-slate-600">Refund reference (optional)</label>
          <input id="approve-refund" value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="e.g. PFMS/2026/REF/0042"
            className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm" />
          <FieldError id="approve-refund-err" message={fields.refundReference} />
        </>
      )}
    </Modal>
  );
}

function Actions({ view }: { view: ReleaseView }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const id = view.request.id;
  const recommend = useRecommend(id);
  const decide = useDecide(id);
  const verify = useVerify(view.request.instrumentId);
  const [pending, setPending] = useState<Pending>(null);
  const level = view.currentLevelInfo;
  const myTurn = !!level && level.role === user?.role;
  const isFinal = !!level && level.level === view.request.requiredLevels.length;
  const canReverify = user?.role === 'officer' && VERIFIABLE_STATUSES.includes(view.instrument.status) && view.request.status !== 'APPROVED';
  const close = () => { setPending(null); recommend.reset(); decide.reset(); };
  const failed = (e: Error) => { if (!(e instanceof ApiError && e.status === 422)) { toast.error(e.message); close(); } };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['release', id] });

  const onVerify = () => verify.mutate(undefined, {
    onSuccess: (r: VerifyResponse) => {
      refresh();
      const msg = r.result === 'CONFIRMED' ? 'Bank confirmed every field' : r.result === 'MISMATCH' ? 'The bank record differs — a discrepancy is open' : `Bank: ${r.result.toLowerCase()}`;
      toast[r.result === 'CONFIRMED' ? 'success' : 'warning'](msg);
    },
    onError: (e) => { refresh(); toast.error(e.message); },
  });

  return (
    <Card className="mb-4" title="Actions">
      <div className="flex flex-wrap items-center gap-2">
        {canReverify && (
          <Button variant="secondary" icon={<Landmark className="size-4" aria-hidden />} loading={verify.isPending} onClick={onVerify}>
            Re-verify with bank
          </Button>
        )}
        {myTurn && level?.action === 'RECOMMEND' && (
          <Button icon={<ThumbsUp className="size-4" aria-hidden />} disabled={!view.canRecommend} onClick={() => setPending('recommend')}>Recommend</Button>
        )}
        {myTurn && level?.action === 'DECIDE' && (
          <Button icon={<CheckCircle2 className="size-4" aria-hidden />} disabled={!view.canApprove} onClick={() => setPending('approve')}>Approve</Button>
        )}
        {myTurn && view.canDecide && (
          <>
            <Button variant="secondary" icon={<Undo2 className="size-4" aria-hidden />} onClick={() => setPending('return')}>Return to institution</Button>
            <Button variant="danger" icon={<XCircle className="size-4" aria-hidden />} onClick={() => setPending('reject')}>Reject</Button>
          </>
        )}
        {view.orderNumber && (
          <Link to={`/releases/${id}/order`}><Button variant="secondary" icon={<Printer className="size-4" aria-hidden />}>Release / Discharge Order</Button></Link>
        )}
      </div>
      {myTurn && view.actionBlockers.length > 0 && (
        <div className="mt-3 text-sm text-danger-700">
          <p className="font-medium">{level?.action === 'RECOMMEND' ? 'Recommend' : 'Approve'} is not possible yet:</p>
          <ul className="list-disc pl-5">{view.actionBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {!myTurn && level && (
        <p className="mt-3 text-sm text-slate-600">Waiting at level {level.level}: {level.label}.</p>
      )}

      <NoteModal open={pending === 'recommend'} title="Recommend release" label="Remarks" submitLabel="Recommend"
        intro="Your recommendation and the state of every condition are recorded. The competent authority decides next."
        pending={recommend.isPending} error={recommend.error} onClose={close}
        onSubmit={(remarks) => recommend.mutate({ remarks, level: view.request.currentLevel }, {
          onSuccess: () => { close(); toast.success('Recommended — sent to the competent authority'); }, onError: failed,
        })} />
      <ApproveModal open={pending === 'approve'} final={isFinal} pending={decide.isPending} error={decide.error} onClose={close}
        onSubmit={(remarks, refund) => decide.mutate({ decision: 'APPROVE', remarks, refundReference: refund || undefined, level: view.request.currentLevel }, {
          onSuccess: (v) => { close(); toast.success(v.request.status === 'APPROVED' ? 'Approved — the instrument is released' : 'Approved at this level'); },
          onError: failed,
        })} />
      <NoteModal open={pending === 'return'} title="Return to institution" label="Message to the institution" submitLabel="Return"
        intro="The institution sees this message, adds what is missing and resubmits. The history is kept."
        pending={decide.isPending} error={decide.error} onClose={close}
        onSubmit={(remarks) => decide.mutate({ decision: 'RETURN', remarks, level: view.request.currentLevel }, {
          onSuccess: () => { close(); toast.success('Returned to the institution'); }, onError: failed,
        })} />
      <NoteModal open={pending === 'reject'} title="Reject release" label="Reason for rejection" submitLabel="Reject" variant="danger"
        intro="The request is closed and the instrument goes back to the status it had before."
        pending={decide.isPending} error={decide.error} onClose={close}
        onSubmit={(remarks) => decide.mutate({ decision: 'REJECT', remarks, level: view.request.currentLevel }, {
          onSuccess: () => { close(); toast.success('Release rejected'); }, onError: failed,
        })} />
    </Card>
  );
}

/** Conditions as they stood at the latest recommendation; rows that changed since are highlighted. */
function SnapshotCard({ view }: { view: ReleaseView }) {
  const rec = [...view.approvals].reverse().find((a) => a.decision === 'RECOMMEND');
  if (!rec?.conditionsSnapshot) return null;
  const changed = new Set(view.conditions.filter((c) => c.changedSinceRecommendation).map((c) => c.code));
  return (
    <Card title={`At recommendation (${rec.approverName})`}>
      <ul className="space-y-1 text-sm">
        {rec.conditionsSnapshot.map((c) => (
          <li key={c.code} className={changed.has(c.code) ? 'rounded bg-warning-50 px-1 font-medium text-warning-700' : 'text-slate-700'}>
            {c.met ? '✓ Met' : '✗ Not met'} — {c.description}{changed.has(c.code) ? ' · changed since recommendation' : ''}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Officer release review and approver decision page (same screen; actions follow whose turn it is). */
export function ReleaseReviewPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const q = useReleaseRequest(id);
  if (q.isError) return <EmptyState title="Release request not found" description="Check the link, or open it from the releases list." />;
  const view = q.data;
  if (!view) return <p className="text-sm text-slate-500">Loading…</p>;
  const inst = view.instrument;
  const r = view.request;
  const back = user?.role === 'officer' ? '/officer/releases' : user ? ROLE_HOME[user.role] : '/';
  const decider = user?.role === 'officer' || user?.role === 'approver';

  return (
    <>
      <Link to={back} className="mb-3 inline-flex items-center gap-1 text-sm text-primary-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Link>
      <header className="mb-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Release request · {INSTRUMENT_TYPE_LABELS[inst.type]} · {inst.institutionName}</p>
            <h1 className="mt-1 text-xl font-semibold break-all text-slate-900">{inst.referenceNo}</h1>
            <p className="mt-1 text-sm text-slate-700">
              {inst.issuingBank} · <span className="font-semibold"><Money amount={inst.amount} /></span> · matures <DateText value={inst.maturityDate} />
            </p>
            <p className="mt-1 flex flex-wrap gap-3 text-xs">
              <Link to={`/instruments/${inst.id}`} className="inline-flex items-center gap-1 text-primary-700 hover:underline"><FileText className="size-3.5" aria-hidden /> Open passport</Link>
              <Link to={`/officer/review/${inst.id}`} className="inline-flex items-center gap-1 text-primary-700 hover:underline"><ClipboardCheck className="size-3.5" aria-hidden /> Scrutiny review (discrepancies, observations)</Link>
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <ReleaseStatusChip status={r.status} />
            <StatusChip status={inst.status} />
            <VerificationChip state={inst.verificationState} />
          </div>
        </div>
      </header>

      {decider && <DecisionBanner />}
      <BlockedBanner view={view} />
      {r.status === 'RETURNED' && r.returnMessage && (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <Undo2 className="size-4" aria-hidden /> Returned to the institution: “{r.returnMessage}”
        </p>
      )}
      <Actions view={view} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card title="Release conditions">
            <ConditionsList view={view} editable={view.canEditConditions} />
          </Card>
          <Card title="Approval chain"><ApprovalChain view={view} /></Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Request"><RequestFacts view={view} /></Card>
          <div id="release-documents">
            <Card title={`Release documents (${view.documents.length})`}><DocumentList documents={view.documents} /></Card>
          </div>
          <SnapshotCard view={view} />
        </div>
      </div>
    </>
  );
}
