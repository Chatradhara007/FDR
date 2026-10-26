import { formatDate } from '@fdr/shared';

export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <time dateTime={value} className="whitespace-nowrap tabular-nums">
      {formatDate(value)}
    </time>
  );
}
