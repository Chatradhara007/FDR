import { useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, CircleCheck, CircleX, Gavel, ShieldX, UserCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RELEASE_DECISION_LABELS, ROLE_LABELS, STATUS_LABELS, type ReleaseApproval, type ReleaseCondition, type ReleaseView } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useUpdateCondition } from '@/api/releases';
import { Badge, Button, DateText, FieldError, useToast } from '@/components';
import { cn } from '@/lib/cn';

const time = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

/** Red banner listing every failing mandatory condition; shown to everyone who can see the request. */
export function BlockedBanner({ view }: { view: ReleaseView }) {
  if (!view.blocked) return null;
  const head = view.blockers.length === 1 ? view.blockers[0] : `${view.blockers.length} conditions are not met`;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-danger-600/30 bg-danger-50 p-4 text-sm text-danger-700">
      <p className="flex items-center gap-2 font-semibold"><ShieldX className="size-5" aria-hidden /> Release blocked — {head.toLowerCase()}</p>
      {view.blockers.length > 1 && (
        <ul className="mt-2 list-disc space-y-1 pl-8">{view.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
      )}
      <p className="mt-2 text-xs">A recommendation or approval is not possible until every mandatory condition is met.</p>
    </div>
  );
}

/** CLAUDE.md rule 12: the portal never decides. */
export function DecisionBanner() {
  return (
    <p className="mb-4 flex items-center gap-2 text-sm text-slate-600">
      <Gavel className="size-4 shrink-0 text-ink" aria-hidden />
      The portal supports the decision; the decision rests with the competent authority. Nothing is approved automatically.
    </p>
  );
}

function CauseLink({ c, instrumentId }: { c: ReleaseCondition; instrumentId: string }) {
  if (!c.link || c.met) return null;
  const review = `/officer/review/${instrumentId}`;
  const target =
    c.link.type === 'documents' ? { to: '#release-documents', text: 'See release documents' }
      : c.link.type === 'verification' ? { to: review, text: 'Open the verification' }
        : c.link.type === 'observation' ? { to: review, text: 'Open the observation' }
          : { to: review, text: `${c.reason ?? 'Open discrepancy'}` };
  const inner = <>{target.text} <ArrowRight className="size-3.5" aria-hidden /></>;
  const cls = 'inline-flex items-center gap-1 text-xs font-medium text-danger-700 underline-offset-2 hover:underline';
  return target.to.startsWith('#') ? <a href={target.to} className={cls}>{inner}</a> : <Link to={target.to} className={cls}>{inner}</Link>;
}

function ManualEditor({ c, requestId }: { c: ReleaseCondition; requestId: string }) {
  const toast = useToast();
  const update = useUpdateCondition(requestId);
  const [met, setMet] = useState(c.met);
  const [remarks, setRemarks] = useState(c.remarks ?? '');
  const errors = update.error instanceof ApiError ? update.error.fieldErrors() : {};
  const dirty = met !== c.met || remarks.trim() !== (c.remarks ?? '');
  const id = `cond-${c.id}`;
  return (
    <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={met} onChange={(e) => setMet(e.target.checked)} className="size-4" />
        Confirmed by me
      </label>
      <label htmlFor={`${id}-remarks`} className="block text-xs font-medium text-slate-600">Remarks (what did you check?)</label>
      <textarea id={`${id}-remarks`} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)}
        aria-invalid={!!errors.remarks} aria-describedby={errors.remarks ? `${id}-err` : undefined}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
      <FieldError id={`${id}-err`} message={errors.remarks} />
      <Button size="sm" variant="secondary" disabled={!dirty} loading={update.isPending}
        onClick={() => update.mutate({ id: c.id, met, remarks: remarks.trim() || undefined }, {
          onSuccess: () => toast.success(met ? 'Condition marked as met' : 'Condition marked as not met'),
          onError: (e) => { if (!(e instanceof ApiError && e.status === 422)) toast.error(e.message); },
        })}>
        Save
      </Button>
    </div>
  );
}

/** The conditions checklist: auto conditions live ✓/✗ with a link to the cause; manual ones ticked by an officer. */
export function ConditionsList({ view, editable = false, internal = true }: { view: ReleaseView; editable?: boolean; internal?: boolean }) {
  const instrumentId = view.request.instrumentId;
  return (
    <ul className="divide-y divide-slate-100">
      {view.conditions.map((c) => (
        <li key={c.id} className={cn('py-2.5', c.changedSinceRecommendation && 'bg-warning-50 px-2')} data-condition={c.code}>
          <div className="flex items-start gap-2">
            {c.met
              ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden />
              : <CircleX className="mt-0.5 size-4 shrink-0 text-danger-700" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800">
                <span className={cn('mr-1 font-semibold', c.met ? 'text-success-700' : 'text-danger-700')}>{c.met ? 'Met' : 'Not met'}:</span>
                {c.description}
                {!c.mandatory && <span className="ml-1 text-xs text-slate-500">(optional)</span>}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {c.auto
                  ? <span className="inline-flex items-center gap-1"><Bot className="size-3.5" aria-hidden /> Checked automatically, live</span>
                  : <span className="inline-flex items-center gap-1"><UserCheck className="size-3.5" aria-hidden /> Officer check{c.checkedByName && c.checkedAt ? ` · ${c.checkedByName}, ${time(c.checkedAt)}` : ''}</span>}
                {c.changedSinceRecommendation && (
                  <Badge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
                    Changed since recommendation (was {c.metAtRecommendation ? 'met' : 'not met'})
                  </Badge>
                )}
              </div>
              {!c.met && c.reason && !(internal && c.link?.type === 'discrepancy') && <p className="mt-1 text-xs text-danger-700">{c.reason}</p>}
              {internal && <CauseLink c={c} instrumentId={instrumentId} />}
              {c.remarks && <p className="mt-1 text-xs text-slate-600">“{c.remarks}”</p>}
              {editable && !c.auto && <ManualEditor key={`${c.id}-${c.met}-${c.remarks}`} c={c} requestId={view.request.id} />}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Who decided what at each level, in order (returns and resubmissions included). */
export function ApprovalChain({ view }: { view: ReleaseView }) {
  const levels = view.request.requiredLevels;
  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Approval levels">
        {levels.map((lv) => {
          const current = view.currentLevelInfo?.level === lv.level;
          return (
            <li key={lv.level} className={cn('rounded-md border px-2 py-1', current ? 'border-primary-600 bg-primary-50 font-semibold text-primary-800' : 'border-slate-200 text-slate-600')}>
              L{lv.level} · {lv.label} ({ROLE_LABELS[lv.role].toLowerCase()}){current ? ' — waiting' : ''}
            </li>
          );
        })}
      </ol>
      {view.approvals.length === 0
        ? <p className="text-sm text-slate-500">No decisions yet.</p>
        : (
          <table className="min-w-full text-sm">
            <caption className="sr-only">Decisions on this request</caption>
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th scope="col" className="py-1 pr-3 font-semibold">Level</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Who</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Decision</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Remarks</th>
                <th scope="col" className="py-1 font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {view.approvals.map((a) => <ApprovalRow key={a.id} a={a} />)}
            </tbody>
          </table>
        )}
    </div>
  );
}

function ApprovalRow({ a }: { a: ReleaseApproval }) {
  const tone = a.decision === 'REJECT' ? 'text-danger-700' : a.decision === 'RETURN' ? 'text-warning-700' : 'text-success-700';
  return (
    <tr>
      <td className="py-2 pr-3 align-top text-slate-600">L{a.level} · {a.label}</td>
      <td className="py-2 pr-3 align-top">{a.approverName}{a.approverDesignation && <span className="block text-xs text-slate-500">{a.approverDesignation}</span>}</td>
      <td className={cn('py-2 pr-3 align-top font-medium', tone)}>{RELEASE_DECISION_LABELS[a.decision]}</td>
      <td className="py-2 pr-3 align-top text-slate-700">{a.remarks ?? <span className="text-slate-400">—</span>}</td>
      <td className="py-2 align-top text-xs text-slate-500">{time(a.decidedAt)}</td>
    </tr>
  );
}

export function RequestFacts({ view }: { view: ReleaseView }) {
  const r = view.request;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-slate-500">Requested by</dt><dd>{r.requestedByName}, <DateText value={r.requestedAt} /></dd></div>
      <div><dt className="text-xs text-slate-500">Status before the request</dt><dd>{view.instrument.statusBeforeRelease ? STATUS_LABELS[view.instrument.statusBeforeRelease] : '—'}</dd></div>
      <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Reason</dt><dd className="whitespace-pre-wrap">{r.reason}</dd></div>
      {r.refundReference && <div><dt className="text-xs text-slate-500">Refund reference</dt><dd>{r.refundReference}</dd></div>}
    </dl>
  );
}
