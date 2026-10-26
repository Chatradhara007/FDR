import { ArrowRight, CircleHelp, Gauge, HandCoins, Landmark } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, type RiskWeights, type WorkItem } from '@fdr/shared';
import { useMyDay } from '@/api/reporting';
import { Card, EmptyState, Money } from '@/components';
import { cn } from '@/lib/cn';

function ScorePill({ score }: { score: number }) {
  const band = score >= 60 ? 'High' : score >= 35 ? 'Medium' : 'Low';
  return (
    <span className={cn('inline-flex min-w-20 flex-col items-center rounded-md px-2 py-1 ring-1 ring-inset',
      band === 'High' ? 'bg-danger-50 text-danger-700 ring-danger-600/30' : band === 'Medium' ? 'bg-warning-50 text-warning-700 ring-warning-600/30' : 'bg-slate-50 text-slate-700 ring-slate-300')}>
      <span className="text-xl font-bold tabular-nums leading-tight">{score}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide">{band} risk</span>
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
        className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline">
        <CircleHelp className="size-4" aria-hidden /> Why this order?
      </button>
      {open && (
        <div role="dialog" aria-label="How My day is ranked" className="absolute right-0 z-20 mt-2 w-96 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-lg">
          <p className="font-medium text-slate-800">Score = 100 × Σ weight × factor</p>
          <table className="mt-2 w-full">
            <tbody className="divide-y divide-slate-100">
              {WEIGHT_LABELS.map(([k, label, how]) => (
                <tr key={k}><td className="py-1 pr-2 font-medium">{label}</td><td className="py-1 text-right tabular-nums">{Math.round(Number(weights[k]) * 100)}%</td><td className="py-1 pl-2 text-xs text-slate-500">{how}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Amount cap <Money amount={weights.amountCap} compact />, urgency horizon {weights.urgencyHorizonDays} days. Weights are set in the rules (risk_weights). The score orders your work; the decisions stay yours.</p>
        </div>
      )}
    </div>
  );
}

function WorkCard({ item, rank }: { item: WorkItem; rank: number }) {
  const Icon = item.kind === 'release' ? HandCoins : Landmark;
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm" data-testid="myday-item">
      <span className="w-6 text-right text-sm text-slate-400 tabular-nums">{rank}</span>
      <ScorePill score={item.score} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="size-4 text-slate-500" aria-hidden />
          <span className="font-semibold text-slate-900">{item.title}</span>
          <span className="text-sm text-slate-700"><Money amount={item.amount} compact /></span>
          {item.kind === 'release' && <span className="text-xs text-slate-500">Release request</span>}
        </div>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {item.reasons.map((r) => <li key={r} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{r}</li>)}
        </ul>
      </div>
      <Link to={item.link} className="inline-flex items-center gap-1 rounded-md bg-primary-700 px-3 py-2 text-sm font-medium text-white hover:bg-primary-800">
        {item.nextAction} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </li>
  );
}

/** My day: the ranked worklist for the signed-in official (officer home, section on the approver home). */
export function MyDayList({ limit }: { limit?: number }) {
  const q = useMyDay();
  const items = q.data ? (limit ? q.data.items.slice(0, limit) : q.data.items) : [];
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Gauge className="size-4" aria-hidden />My day{q.data && ` · ${formatDate(q.data.asOf)} · ${q.data.items.length} item(s)`}</span>}
      actions={q.data && <WhyThisOrder weights={q.data.weights} />}>
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {q.isError && <EmptyState title="Could not load My day" description={q.error.message} />}
      {q.data && items.length === 0 && <EmptyState title="Nothing needs you right now" description="New work appears here as the clock moves and cases arrive." />}
      <ol className="space-y-3">
        {items.map((item, i) => <WorkCard key={`${item.kind}-${item.id}`} item={item} rank={i + 1} />)}
      </ol>
    </Card>
  );
}
