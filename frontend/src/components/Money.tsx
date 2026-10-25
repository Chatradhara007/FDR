import { formatINR, formatINRCompact } from '@fdr/shared';

/** Amounts arrive as strings (NUMERIC); compact shows ₹25 L with the full value as a tooltip. */
export function Money({ amount, compact }: { amount: string | null | undefined; compact?: boolean }) {
  if (amount == null || amount === '') return <span className="text-slate-400">—</span>;
  const full = formatINR(amount);
  return (
    <span className="tabular-nums" title={compact ? full : undefined}>
      {compact ? formatINRCompact(amount) : full}
    </span>
  );
}
