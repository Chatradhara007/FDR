import { useState } from 'react';
import type { RiskWeights, WorkItem } from '@fdr/shared';
import { Drawer, Money, type Reason, type ScorePart } from '@/components';

/** Reasons that cost something if left (maturity, bank trouble, discrepancies, escalation) get the attention tint. */
const URGENT = /matur|lapse|mismatch|discrepan|escalat|unavailable|overdue|level [23]/i;
export const toReasons = (reasons: string[]): Reason[] => reasons.map((text) => ({ text, urgent: URGENT.test(text) }));

const FACTORS: Array<[keyof WorkItem['components'], string, string]> = [
  ['urgency', 'Time to maturity or waiting', 'days to maturity within the horizon; in scrutiny, days waiting ÷ 10'],
  ['discrepancy', 'Open problems', '1 if a discrepancy is open'],
  ['verification', 'Not proven by the bank', 'mismatch 1 · unavailable 0.8 · unverified 0.7 · pending 0.6 · confirmed 0'],
  ['amount', 'Amount at stake', 'amount ÷ cap, up to 1'],
  ['escalation', 'Escalation', 'worst open alert level ÷ 3'],
];

/** Points per factor: 100 × weight × factor, of 100 × weight. */
export function scoreParts(item: WorkItem, weights: RiskWeights): ScorePart[] {
  return FACTORS.map(([k, label]) => {
    const w = Number(weights[k]);
    const f = item.components[k];
    return { label, pts: Math.round(100 * w * f), max: Math.round(100 * w), urgent: k !== 'amount' && f >= 0.5 };
  }).filter((p) => p.max > 0);
}

/** "First because …" / "#3 because …" from the item's first reason. */
export function rankKicker(rank: number, reasons: string[]): string {
  const why = reasons[0];
  return `${rank === 1 ? 'First' : `Number ${rank}`}${why ? ` because: ${why}` : ''}`;
}

/** "Why this order?": the ranking rule in a drawer (weights come from the risk_weights rule). */
export function WhyThisOrder({ weights, label = 'Why this order?' }: { weights: RiskWeights | undefined; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-teal hover:text-teal-hover hover:underline">{label}</button>
      <Drawer open={open} title="How the queue is ranked" onClose={() => setOpen(false)}>
        <p>Score = 100 × Σ weight × factor. The highest score is first.</p>
        {weights && (
          <table className="gov-table mt-3">
            <thead><tr><th scope="col">Factor</th><th scope="col" className="text-right!">Weight</th></tr></thead>
            <tbody>
              {FACTORS.map(([k, l, how]) => (
                <tr key={k}><td><strong className="block font-semibold">{l}</strong><span className="text-[0.8125rem] text-muted">{how}</span></td><td className="num">{Math.round(Number(weights[k]) * 100)}%</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {weights && <p className="mt-3 text-sm text-muted">Amount cap <Money amount={weights.amountCap} compact />, urgency horizon {weights.urgencyHorizonDays} days.</p>}
        <p className="mt-3 text-sm text-muted">Weights are set by your administrator in the rules (risk_weights). The score orders your work; the decisions stay yours.</p>
      </Drawer>
    </>
  );
}
