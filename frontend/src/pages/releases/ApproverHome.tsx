import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ReleaseListItem, WorkItem } from '@fdr/shared';
import { ApiError } from '@/api/client';
import { useAlertSummary } from '@/api/alerts';
import { useMyDay } from '@/api/reporting';
import { useDecide, useReleaseRequest } from '@/api/releases';
import { useAuth } from '@/auth/AuthContext';
import { Button, ConditionLine, DateText, EmptyState, Kicker, Money, ScoreBreakdown, StatChip, useToast } from '@/components';
import { NoteModal } from '@/components/NoteModal';
import { useClock } from '@/hooks/useClock';
import { countWord, firstName, greeting } from '@/lib/greeting';
import { Desk, type DeskKeys, type DeskTab } from '@/pages/desk/Desk';
import { rankKicker, scoreParts, toReasons, WhyThisOrder } from '@/pages/desk/parts';
import { useReleaseRequests } from '@/api/releases';
import { ApproveModal } from './ReleaseReviewPage';

/** A release waiting for the approver, with its My day score when it has one. */
interface Row { r: ReleaseListItem; work: WorkItem | undefined }

const LEGEND = [
  { k: ['J', 'K'], label: 'move' },
  { k: ['A'], label: 'approve' },
  { k: ['O'], label: 'open record' },
];

type Pending = { kind: 'approve' | 'reject' | 'return'; id: string } | null;

/** /approver: "Awaiting your decision", the officer-desk layout for the competent authority. */
export function ApproverHome() {
  const { user } = useAuth();
  const clock = useClock();
  const navigate = useNavigate();
  const pendingQ = useReleaseRequests({ awaitingMe: true, pageSize: 100 });
  const myday = useMyDay();
  const alerts = useAlertSummary();
  const [pending, setPending] = useState<Pending>(null);

  const rows = useMemo<Row[] | undefined>(() => {
    if (!pendingQ.data) return undefined;
    const work = myday.data?.items ?? [];
    return pendingQ.data.items
      .map((r) => ({ r, work: work.find((w) => w.kind === 'release' && w.id === r.id) }))
      .sort((a, b) => (b.work?.score ?? -1) - (a.work?.score ?? -1) || b.r.ageDays - a.r.ageDays);
  }, [pendingQ.data, myday.data]);

  const tabs = useMemo<DeskTab<Row>[]>(() => [
    { id: 'all', label: 'Awaiting you', filter: () => true },
    { id: 'old', label: 'Waiting 3+ days', filter: (x) => x.r.ageDays >= 3 },
  ], []);
  const keys = useMemo<DeskKeys<Row>>(() => ({
    a: (x) => setPending({ kind: 'approve', id: x.r.id }),
    o: (x) => navigate(`/approver/releases/${x.r.id}`),
  }), [navigate]);

  const n = rows?.length ?? 0;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="text-[1.875rem] leading-tight font-bold tracking-[-0.02em]">{greeting(clock.data?.now)}, {firstName(user?.name)}</h1>
          <p className="mt-1.5 text-base text-muted">
            {rows && (n
              ? `${countWord(n, 'release is', 'releases are', true)} awaiting your decision. Each was recommended by a scrutiny officer.`
              : 'No release is awaiting your decision. Recommended releases appear here.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatChip value={n} label="awaiting your decision" />
          <StatChip value={rows?.filter((x) => x.r.ageDays >= 3).length ?? 0} label="waiting 3+ days" tone="attention" />
          <Link to="/alerts" className="rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm hover:bg-subtle">
            <strong className="text-lg tabular-nums">{alerts.data?.total ?? 0}</strong> open alerts · Show escalations
          </Link>
        </div>
      </div>

      <h2 className="sr-only">Awaiting your decision</h2>
      <Desk
        items={pendingQ.isError ? [] : rows}
        queueLabel="Awaiting your decision"
        tabs={tabs}
        keys={keys}
        legend={LEGEND}
        toRow={(x) => ({
          key: x.r.id, title: x.r.institutionName, reference: x.r.referenceNo ?? 'No reference', amount: <Money amount={x.r.amount} compact />,
          reasons: x.work ? toReasons(x.work.reasons) : [{ text: `Waiting ${x.r.ageDays} day${x.r.ageDays === 1 ? '' : 's'}`, urgent: x.r.ageDays >= 3 }],
          score: x.work?.score ?? '—',
        })}
        empty={<EmptyState title="Nothing awaiting your decision" description="Recommended releases appear here." />}
        panel={(x, rank) => <Selected key={x.r.id} row={x} rank={rank} weights={myday.data?.weights} onDecide={(kind) => setPending({ kind, id: x.r.id })} />}
      />

      {pending && <DecisionDialogs pending={pending} onClose={() => setPending(null)} />}
    </>
  );
}

function Selected({ row, rank, weights, onDecide }: {
  row: Row; rank: number; weights: NonNullable<ReturnType<typeof useMyDay>['data']>['weights'] | undefined;
  onDecide: (kind: 'approve' | 'reject' | 'return') => void;
}) {
  const q = useReleaseRequest(row.r.id);
  const view = q.data;
  const rec = view ? [...view.approvals].reverse().find((a) => a.decision === 'RECOMMEND') : undefined;
  const myTurn = view?.currentLevelInfo?.action === 'DECIDE';
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Kicker tone="attention">{rankKicker(rank, row.work?.reasons ?? [`Waiting ${row.r.ageDays} days`])}</Kicker>
          <h2 className="mt-1.5 text-[1.625rem] leading-tight font-bold tracking-[-0.015em] break-words">{row.r.institutionName}</h2>
          <div className="mono mt-1.5 text-[0.84375rem] break-all text-muted">
            {row.r.referenceNo} · <Money amount={row.r.amount} /> · requested <DateText value={row.r.requestedAt} />
          </div>
        </div>
        <Link to={`/approver/releases/${row.r.id}`} className="rounded-[8px] border border-border px-3.5 py-2 text-sm font-medium text-ink hover:bg-subtle">Open full record</Link>
      </div>

      <div className="mt-[22px] flex flex-wrap gap-7">
        <div className="min-w-0 flex-[1_1_300px]">
          <Kicker className="mb-3">Recommendation</Kicker>
          {!view && <p className="text-sm text-muted">Loading…</p>}
          {view && !rec && <p className="text-[0.9375rem] text-muted">No recommendation recorded yet.</p>}
          {rec && (
            <div className="rounded-[10px] border border-hairline bg-subtle p-4 text-[0.9375rem]">
              <p><strong>{rec.approverName}</strong>{rec.approverDesignation && `, ${rec.approverDesignation}`} recommended release on <DateText value={rec.decidedAt} />.</p>
              {rec.remarks && <p className="mt-2 text-ink-2">“{rec.remarks}”</p>}
            </div>
          )}
          {row.work && weights && (
            <div className="mt-6">
              <Kicker className="mb-3">Why it is ranked here</Kicker>
              <ScoreBreakdown parts={scoreParts(row.work, weights)} footer={<>Weights are set by your administrator. <WhyThisOrder weights={weights} label="See the rule" /></>} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-[1_1_300px]">
          <Kicker className="mb-3">Release conditions</Kicker>
          {view?.conditions.map((c) => (
            <ConditionLine key={c.id} met={c.met}>{c.description}{c.changedSinceRecommendation ? ' · changed since recommendation' : ''}</ConditionLine>
          ))}
          {view && view.actionBlockers.length > 0 && (
            <p className="mt-3 text-[0.8125rem] text-attn-text">Approve is not possible yet: {view.actionBlockers.join('; ')}.</p>
          )}
        </div>
      </div>

      <div className="mt-[26px] flex flex-wrap items-center gap-3 border-t border-hairline pt-[22px]">
        <Button size="lg" kbd="A" disabled={!view || !myTurn || !view.canApprove} onClick={() => onDecide('approve')}>Approve release</Button>
        <Button size="lg" variant="secondary" disabled={!view?.canDecide} onClick={() => onDecide('return')}>Return to institution</Button>
        <Button size="lg" variant="secondary" disabled={!view?.canDecide} onClick={() => onDecide('reject')}>Reject</Button>
        <span className="min-w-0 flex-[1_1_220px] text-[0.84375rem] text-muted">
          You decide as the competent authority. You cannot approve a request you recommended yourself; the portal never approves on its own.
        </span>
      </div>
    </>
  );
}

function DecisionDialogs({ pending, onClose }: { pending: NonNullable<Pending>; onClose: () => void }) {
  const q = useReleaseRequest(pending.id);
  const decide = useDecide(pending.id);
  const toast = useToast();
  const view = q.data;
  if (!view) return null;
  const level = view.request.currentLevel;
  const isFinal = level === view.request.requiredLevels.length;
  const failed = (e: Error) => { if (!(e instanceof ApiError && e.status === 422)) { toast.error(e.message); onClose(); } };
  if (pending.kind === 'approve') {
    return (
      <ApproveModal open final={isFinal} pending={decide.isPending} error={decide.error} onClose={onClose}
        onSubmit={(remarks, refund) => decide.mutate({ decision: 'APPROVE', remarks, refundReference: refund || undefined, level }, {
          onSuccess: (v) => { onClose(); toast.success(v.request.status === 'APPROVED' ? 'Approved — the instrument is released' : 'Approved at this level'); },
          onError: failed,
        })} />
    );
  }
  const reject = pending.kind === 'reject';
  return (
    <NoteModal open title={reject ? 'Reject release' : 'Return to institution'} label={reject ? 'Reason for rejection' : 'Message to the institution'}
      submitLabel={reject ? 'Reject' : 'Return'} variant={reject ? 'danger' : 'primary'}
      intro={reject ? 'The request is closed and the instrument goes back to the status it had before.' : 'The institution sees this message, adds what is missing and resubmits.'}
      pending={decide.isPending} error={decide.error} onClose={onClose}
      onSubmit={(remarks) => decide.mutate({ decision: reject ? 'REJECT' : 'RETURN', remarks, level }, {
        onSuccess: () => { onClose(); toast.success(reject ? 'Release rejected' : 'Returned to the institution'); }, onError: failed,
      })} />
  );
}
