import { formatDateGov } from '@/lib/format';

export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <time dateTime={value} className="whitespace-nowrap tabular-nums">
      {formatDateGov(value)}
    </time>
  );
}
