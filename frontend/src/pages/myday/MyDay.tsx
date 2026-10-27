import { ArrowRight, CircleHelp, HandCoins, Landmark } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, type RiskWeights, type WorkItem } from '@fdr/shared';
import { useMyDay } from '@/api/reporting';
import { EmptyState, Money } from '@/components';
import { cn } from '@/lib/cn';

function ScorePill({ score }: { score: number }) {
  const band = score >= 60 ? 'High' : score >= 35 ? 'Medium' : 'Low';
  return (
    <span className="inline-flex w-28 shrink-0 flex-col items-start whitespace-nowrap">
      <span className="font-serif text-2xl leading-none font-semibold tabular-nums text-slate-900">{score}</span>
      <span className={cn('mt-1 inline-flex items-center gap-1 text-sm', band === 'High' ? 'text-danger-700' : band === 'Medium' ? 'text-warning-700' : 'text-slate-600')}>
        <span className={cn('size-2 rounded-full', band === 'High' ? 'bg-danger-600' : band === 'Medium' ? 'bg-warning-600' : 'bg-slate-400')} aria-hidden />
        {band} risk
      </span>
    </span>
  );
}

const WEIGHT_LABELS: Array<[keyof RiskWeights, string, string]> = [
  ['amount', 'Amount at stake', 'amount ÷ cap, up to 1'],
  ['urgency', 'Urgency', 'days to maturity within the horizon; in scrutiny, days waiting ÷ 10'],
  ['verification', 'Verification', 'mismatch 1 · unavailable 0.8 · unverified 0.7 · pending 0.6 · confirmed 0'],
  ['discrepancy', 'Open discrepancy', '1 if any'],
  ['escalation', 'Escalation', 'worst open alert level ÷ 3'],
];

/** "Why this order?": the weights come from the risk_weights rule (admins change them in Rules). */
function WhyThisOrder({ weights }: { weights: RiskWeights }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:underline underline-offset-4">
        <CircleHelp className="size-4" aria-hidden /> Why this order?
      </button>
      {open && (
        <div role="dialog" aria-label="How My day is ranked" className="fade-in absolute right-0 z-20 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-5 text-sm shadow-md">
          <p className="font-medium text-slate-800">Score = 100 × Σ weight × factor</p>
          <table className="mt-2 w-full">
            <tbody className="divide-y divide-line">
              {WEIGHT_LABELS.map(([k, label, how]) => (
                <tr key={k}><td className="py-1.5 pr-2 font-medium">{label}</td><td className="py-1.5 text-right tabular-nums">{Math.round(Number(weights[k]) * 100)}%</td><td className="py-1.5 pl-2 text-sm text-slate-600">{how}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-slate-600">Amount cap <Money amount={weights.amountCap} compact />, urgency horizon {weights.urgencyHorizonDays} days. Weights are set in the rules (risk_weights). The score orders your work; the decisions stay yours.</p>
        </div>
      )}
    </div>
  );
}

function WorkCard({ item, rank }: { item: WorkItem; rank: number }) {
  const Icon = item.kind === 'release' ? HandCoins : Landmark;
  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-5" data-testid="myday-item">
      <span className="w-5 text-right text-sm text-slate-500 tabular-nums">{rank}</span>
      <ScorePill score={item.score} />
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Icon className="size-4 text-slate-500" aria-hidden />
          <span className="font-medium text-slate-900">{item.title}</span>
          <span className="text-sm text-slate-600"><Money amount={item.amount} compact /></span>
          {item.kind === 'release' && <span className="text-sm text-slate-600">· Release request</span>}
        </div>
        <p className="mt-1 text-sm text-slate-600">{item.reasons.join(' · ')}</p>
      </div>
      <Link to={item.link} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#d6d0c4] px-4 text-sm font-medium text-ink hover:bg-strip">
        {item.nextAction} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </li>
  );
}

/** My day: the ranked worklist for the signed-in official (officer home, section on the approver home). */
export function MyDayList({ limit, title = 'Your worklist' }: { limit?: number; title?: string }) {
  const q = useMyDay();
  const items = q.data ? (limit ? q.data.items.slice(0, limit) : q.data.items) : [];
  return (
    <section aria-labelledby="myday-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 id="myday-title" className="font-serif text-xl font-semibold text-slate-900">
          {title}
          {q.data && <span className="ml-2 font-sans text-sm font-normal text-slate-600">{q.data.items.length} item(s), ranked · {formatDate(q.data.asOf)}</span>}
        </h2>
        {q.data && <WhyThisOrder weights={q.data.weights} />}
      </div>
      <div className="rounded-xl border border-line bg-surface">
        {q.isLoading && <p className="px-5 py-6 text-sm text-slate-600">Loading…</p>}
        {q.isError && <EmptyState title="Could not load My day" description={q.error.message} />}
        {q.data && items.length === 0 && <EmptyState title="Nothing needs you right now" description="New work appears here as the clock moves and cases arrive." />}
        {items.length > 0 && (
          <ol className="divide-y divide-line">
            {items.map((item, i) => <WorkCard key={`${item.kind}-${item.id}`} item={item} rank={i + 1} />)}
          </ol>
        )}
      </div>
    </section>
  );
}
