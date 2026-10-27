import { formatDateGov } from '@/lib/format';

export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-500">—</span>;
  return (
    <time dateTime={value} className="whitespace-nowrap tabular-nums">
      {formatDateGov(value)}
    </time>
  );
}
