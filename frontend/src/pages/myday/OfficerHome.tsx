import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FIELD_LABELS, TRACKED_FIELDS, TRUST_TIER_LABELS, VERIFIABLE_STATUSES, type ReleaseView, type VerifyResponse, type WorkItem } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useInstrument } from '@/api/instruments';
import { useMyDay } from '@/api/reporting';
import { useDecide, useRecommend, useReleaseRequest, useUpdateCondition } from '@/api/releases';
import { useClaim, useReturnInstrument, useVerify } from '@/api/scrutiny';
import { useAuth } from '@/auth/AuthContext';
import {
  Button, ConditionLine, ConfirmModal, EmptyState, Kicker, Modal, Money, ProofLegend, ProofStrip, ScoreBreakdown, StatChip, useToast,
} from '@/components';
import { NoteModal } from '@/components/NoteModal';
import { useClock } from '@/hooks/useClock';
import { countWord, firstName, greeting } from '@/lib/greeting';
import { Desk, type DeskKeys, type DeskTab } from '@/pages/desk/Desk';
import { rankKicker, scoreParts, toReasons, WhyThisOrder } from '@/pages/desk/parts';

const escalated = (i: WorkItem) => i.components.escalation >= 0.66;
const onBank = (i: WorkItem) => i.reasons.some((r) => /bank still processing|bank unavailable|not yet verified/i.test(r));

const TABS: DeskTab<WorkItem>[] = [
  { id: 'todo', label: 'To do', filter: () => true },
  { id: 'escalated', label: 'Escalated', filter: escalated },
  { id: 'bank', label: 'Waiting on bank', filter: onBank },
];

const LEGEND = [
  { k: ['J', 'K'], label: 'move' },
  { k: ['R'], label: 'recommend' },
  { k: ['B'], label: 'ask bank' },
  { k: ['O'], label: 'open record' },
];

type Pending = { kind: 'recommend' | 'bank' | 'return'; item: WorkItem } | null;

/** /officer: "My day", the officer desk (docs/design/mockup-officer-desk.html). */
export function OfficerHome() {
  const { user } = useAuth();
  const clock = useClock();
  const navigate = useNavigate();
  const q = useMyDay();
  const items = q.data?.items;
  const [pending, setPending] = useState<Pending>(null);

  const keys = useMemo<DeskKeys<WorkItem>>(() => ({
    r: (item) => { if (item.kind === 'release') setPending({ kind: 'recommend', item }); },
    b: (item) => setPending({ kind: 'bank', item }),
    o: (item) => navigate(item.link),
  }), [navigate]);

  const n = items?.length ?? 0;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="text-[1.875rem] leading-tight font-bold tracking-[-0.02em]">{greeting(clock.data?.now)}, {firstName(user?.name)}</h1>
          <p className="mt-1.5 text-base text-muted">
            {q.data && (n
              ? `${countWord(n, 'deposit needs', 'deposits need', true)} you today. They are ordered by what costs most to leave.`
              : 'Nothing needs you right now. New work appears here as the clock moves and cases arrive.')}
            {q.isError && 'My day could not be loaded. Try again in a moment.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatChip value={n} label="waiting for you" />
          <StatChip value={items?.filter(escalated).length ?? 0} label="escalated" tone="attention" />
          <StatChip value={items?.filter(onBank).length ?? 0} label="waiting on the bank" />
          <WhyThisOrder weights={q.data?.weights} />
        </div>
      </div>

      <Desk
        items={q.isError ? [] : items}
        queueLabel="My day"
        rowTestId="myday-item"
        tabs={TABS}
        keys={keys}
        legend={LEGEND}
        toRow={(i) => ({ key: `${i.kind}-${i.id}`, title: i.institution, reference: i.referenceNo ?? 'No reference yet', amount: <Money amount={i.amount} compact />, reasons: toReasons(i.reasons), score: i.score })}
        empty={<EmptyState title="Nothing in this list" description="New work appears here as the clock moves and cases arrive." />}
        panel={(item, rank) => (
          <SelectedItem key={`${item.kind}-${item.id}`} item={item} rank={rank} weights={q.data!.weights}
            onRecommend={() => setPending({ kind: 'recommend', item })}
            onBank={() => setPending({ kind: 'bank', item })}
            onReturn={() => setPending({ kind: 'return', item })} />
        )}
      />

      {pending?.kind === 'recommend' && <RecommendDialog item={pending.item} onClose={() => setPending(null)} />}
      {pending?.kind === 'bank' && <BankDialog item={pending.item} onClose={() => setPending(null)} />}
      {pending?.kind === 'return' && <ReturnDialog item={pending.item} onClose={() => setPending(null)} />}
    </>
  );
}

function SelectedItem({ item, rank, weights, onRecommend, onBank, onReturn }: {
  item: WorkItem; rank: number; weights: NonNullable<ReturnType<typeof useMyDay>['data']>['weights'];
  onRecommend: () => void; onBank: () => void; onReturn: () => void;
}) {
  const release = item.kind === 'release';
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Kicker tone="attention">{rankKicker(rank, item.reasons)}</Kicker>
          <h2 className="mt-1.5 text-[1.625rem] leading-tight font-bold tracking-[-0.015em] break-words">{item.institution}</h2>
          <div className="mono mt-1.5 text-[0.84375rem] break-all text-muted">
            {item.referenceNo ?? 'No reference yet'} · <Money amount={item.amount} /> · {release ? 'release request' : item.nextAction.toLowerCase()}
          </div>
        </div>
        <Link to={item.link} className="rounded-[8px] border border-border px-3.5 py-2 text-sm font-medium text-ink hover:bg-subtle">Open full record</Link>
      </div>

      <div className="mt-[22px] flex flex-wrap gap-7">
        <div className="min-w-0 flex-[1_1_300px]">
          <Kicker className="mb-3">Why it is ranked here</Kicker>
          <ScoreBreakdown parts={scoreParts(item, weights)}
            footer={<>Weights are set by your administrator. <WhyThisOrder weights={weights} label="See the rule" /></>} />
        </div>
        <div className="min-w-0 flex-[1_1_300px]">
          {release ? <ReleaseConditions requestId={item.id} /> : <WhatIsProven instrumentId={item.instrumentId} />}
        </div>
      </div>

      <div className="mt-[26px] flex flex-wrap items-center gap-3 border-t border-hairline pt-[22px]">
        {release
          ? <Button size="lg" kbd="R" onClick={onRecommend}>Recommend release</Button>
          : <Link to={item.link} className="max-w-full"><Button size="lg" kbd="O" className="h-auto min-h-12 max-w-full py-2 whitespace-normal">{item.nextAction}</Button></Link>}
        <Button size="lg" variant="secondary" kbd="B" onClick={onBank}>{release ? 'Ask the bank again' : 'Ask the bank'}</Button>
        <Button size="lg" variant="secondary" onClick={onReturn}>Return to institution</Button>
        <span className="min-w-0 flex-[1_1_220px] text-[0.84375rem] text-muted">
          {release
            ? 'After you recommend, the Approver decides. You cannot approve your own recommendation.'
            : 'Accepting a deposit is always your decision; the portal only shows what is proven.'}
        </span>
      </div>
    </>
  );
}

/** Release conditions; manual ones are the officer's to tick (the portal cannot know them). */
function ReleaseConditions({ requestId }: { requestId: string }) {
  const q = useReleaseRequest(requestId);
  const update = useUpdateCondition(requestId);
  const toast = useToast();
  const view = q.data;
  return (
    <>
      <Kicker className="mb-3">Release conditions</Kicker>
      {!view && <p className="text-sm text-muted">Loading…</p>}
      {view?.conditions.filter((c) => c.auto || c.met).map((c) => (
        <ConditionLine key={c.id} met={c.met}>{c.description}{!c.met && c.reason ? `: ${c.reason}` : ''}</ConditionLine>
      ))}
      {view?.conditions.filter((c) => !c.auto && !c.met).map((c) => (
        <label key={c.id} className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-teal bg-teal-tint p-3 text-[0.90625rem] leading-snug">
          <input type="checkbox" className="mt-px size-[18px] accent-teal" checked={c.met} disabled={!view.canEditConditions || update.isPending}
            onChange={(e) => update.mutate({ id: c.id, met: e.target.checked }, { onError: (err) => toast.error(err.message) })} />
          <span><strong>{c.description}</strong><br /><span className="text-[0.8125rem] text-muted">This is yours to tick. The portal cannot know it.</span></span>
        </label>
      ))}
      {view && view.actionBlockers.length > 0 && (
        <p className="mt-3 text-[0.8125rem] text-attn-text">Recommend is not possible yet: {view.actionBlockers.join('; ')}.</p>
      )}
    </>
  );
}

/** For a deposit: the proof strip and every field the bank has not confirmed yet. */
function WhatIsProven({ instrumentId }: { instrumentId: string }) {
  const q = useInstrument(instrumentId);
  const d = q.data;
  return (
    <>
      <Kicker className="mb-3">What is proven</Kicker>
      {!d && <p className="text-sm text-muted">Loading…</p>}
      {d && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-3"><ProofStrip provenance={d.provenance} /><ProofLegend /></div>
          {TRACKED_FIELDS.map((f) => {
            const tier = d.provenance.find((p) => p.fieldName === f)?.tier ?? 'CLAIMED';
            return <ConditionLine key={f} met={tier === 'BANK_CONFIRMED'}>{FIELD_LABELS[f]}: {tier === 'CLAIMED' ? 'Claimed by institution' : TRUST_TIER_LABELS[tier]}</ConditionLine>;
          })}
        </>
      )}
    </>
  );
}

// ---- Dialogs (keys and buttons open the same ones; nothing is written without a confirming click) ----

function RecommendDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const q = useReleaseRequest(item.id);
  const recommend = useRecommend(item.id);
  const toast = useToast();
  const view = q.data;
  if (!view) return null;
  const turn = view.currentLevelInfo?.action === 'RECOMMEND';
  if (!turn || !view.canRecommend) {
    return (
      <Modal open title="Recommend release" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <p className="text-ink-2">Recommend is not possible yet{view.actionBlockers.length ? ':' : '.'}</p>
        {view.actionBlockers.length > 0 && <ul className="mt-2 list-disc pl-5 text-ink-2">{view.actionBlockers.map((b) => <li key={b}>{b}</li>)}</ul>}
      </Modal>
    );
  }
  return (
    <NoteModal open title="Recommend release" label="Remarks" submitLabel="Recommend"
      intro="Your recommendation and the state of every condition are recorded. The competent authority decides next."
      pending={recommend.isPending} error={recommend.error} onClose={onClose}
      onSubmit={(remarks) => recommend.mutate({ remarks, level: view.request.currentLevel }, {
        onSuccess: () => { onClose(); toast.success('Recommended — sent to the competent authority'); },
        onError: (e) => { if (!(e instanceof ApiError && e.status === 422)) { toast.error(e.message); onClose(); } },
      })} />
  );
}

/** "B": one-line confirmation, then (claim if needed and) verify with the bank. */
function BankDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const inst = useInstrument(item.instrumentId);
  const verify = useVerify(item.instrumentId);
  const claim = useClaim();
  const qc = useQueryClient();
  const toast = useToast();
  const d = inst.data;
  if (!d) return null;
  const needsClaim = d.status === 'SUBMITTED';
  if (!needsClaim && !VERIFIABLE_STATUSES.includes(d.status)) {
    return (
      <Modal open title="Ask the bank" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <p className="text-ink-2">This deposit cannot be sent to the bank while it is {d.status.toLowerCase().replace(/_/g, ' ')}.</p>
      </Modal>
    );
  }
  const done = (r: VerifyResponse) => {
    void qc.invalidateQueries();
    const msg = r.result === 'CONFIRMED' ? 'Bank confirmed every field' : r.result === 'MISMATCH' ? 'The bank record differs — a discrepancy is open' : `Bank: ${r.result.toLowerCase()}`;
    toast[r.result === 'CONFIRMED' ? 'success' : 'warning'](msg);
    onClose();
  };
  const fail = (e: Error) => { void qc.invalidateQueries(); toast.error(e.message); onClose(); };
  const go = () => {
    if (needsClaim) claim.mutate(d.id, { onSuccess: () => verify.mutate(undefined, { onSuccess: done, onError: fail }), onError: fail });
    else verify.mutate(undefined, { onSuccess: done, onError: fail });
  };
  return (
    <ConfirmModal open title="Ask the bank" confirmLabel={needsClaim ? 'Claim and ask the bank' : 'Ask the bank'}
      pending={verify.isPending || claim.isPending} onConfirm={go} onClose={onClose}>
      {needsClaim ? 'Claim ' : 'Send '}{d.referenceNo ?? 'this deposit'} {needsClaim ? 'and send it ' : ''}to {d.issuingBank ?? 'the bank'} for verification now? This is recorded in the audit log.
    </ConfirmModal>
  );
}

function ReturnDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  return item.kind === 'release' ? <ReturnRelease item={item} onClose={onClose} /> : <ReturnInstrument item={item} onClose={onClose} />;
}

function ReturnRelease({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const q = useReleaseRequest(item.id);
  const decide = useDecide(item.id);
  const toast = useToast();
  const view: ReleaseView | undefined = q.data;
  if (!view) return null;
  if (!view.canDecide) {
    return (
      <Modal open title="Return to institution" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <p className="text-ink-2">This request is not at your level, so it cannot be returned from here. Open the full record to see where it is.</p>
      </Modal>
    );
  }
  return (
    <NoteModal open title="Return to institution" label="Message to the institution" submitLabel="Return"
      intro="The institution sees this message, adds what is missing and resubmits. The history is kept."
      pending={decide.isPending} error={decide.error} onClose={onClose}
      onSubmit={(remarks) => decide.mutate({ decision: 'RETURN', remarks, level: view.request.currentLevel }, {
        onSuccess: () => { onClose(); toast.success('Returned to the institution'); },
        onError: (e) => { if (!(e instanceof ApiError && e.status === 422)) { toast.error(e.message); onClose(); } },
      })} />
  );
}

function ReturnInstrument({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const inst = useInstrument(item.instrumentId);
  const ret = useReturnInstrument(item.instrumentId);
  const qc = useQueryClient();
  const toast = useToast();
  const d = inst.data;
  if (!d) return null;
  if (d.status !== 'UNDER_SCRUTINY') {
    return (
      <Modal open title="Return to institution" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <p className="text-ink-2">Only a deposit you are scrutinising can be returned. {d.status === 'SUBMITTED' ? 'Claim it first from the full record.' : 'Open the full record for what can be done now.'}</p>
      </Modal>
    );
  }
  return (
    <NoteModal open title="Return to institution" label="Reason" submitLabel="Return"
      intro="The institution sees this reason, corrects the record and resubmits."
      pending={ret.isPending} error={ret.error} onClose={onClose}
      onSubmit={(reason) => ret.mutate(reason, {
        onSuccess: () => { void qc.invalidateQueries(); onClose(); toast.success('Returned to the institution'); },
        onError: (e) => { if (!(e instanceof ApiError && e.status === 422)) { toast.error(e.message); onClose(); } },
      })} />
  );
}
