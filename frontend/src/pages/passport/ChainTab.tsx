import { ArrowDown, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ChainLink } from '@fdr/shared';
import { DateText, Money, StatusChip } from '@/components';
import { cn } from '@/lib/cn';

function GapLabel({ link }: { link: ChainLink }) {
  const d = link.gapDaysFromPrevious;
  const days = (n: number) => `${n}-day`;
  if (link.gapKind === 'gap' && d !== null) return <span className="font-semibold text-danger-700">{days(d)} gap</span>;
  if (link.gapKind === 'overlap' && d !== null) return <span className="font-semibold text-teal-hover">{days(-d)} overlap</span>;
  if (link.gapKind === 'continuous') return <span className="font-medium text-muted">continuous</span>;
  return <span className="text-muted">dates not known yet</span>;
}

/** The renewal chain, oldest first; each arrow says whether cover was continuous. Click a node to open its passport. */
export function ChainTab({ chain }: { chain: ChainLink[] }) {
  if (chain.length <= 1) {
    return <p className="text-sm text-muted">This instrument has not been renewed and does not replace an earlier one.</p>;
  }
  return (
    <ol className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:overflow-x-auto md:pb-2" aria-label="Renewal chain">
      {chain.map((link, i) => (
        <li key={link.id} className="flex flex-col items-center gap-2 md:flex-row">
          {i > 0 && (
            <div className="flex flex-col items-center px-1 text-xs md:min-w-28" data-testid="chain-arrow">
              <GapLabel link={link} />
              <ArrowRight className="hidden size-5 text-muted md:block" aria-hidden />
              <ArrowDown className="size-5 text-muted md:hidden" aria-hidden />
            </div>
          )}
          <Link
            to={`/instruments/${link.id}`}
            aria-current={link.isCurrent ? 'page' : undefined}
            className={cn(
              'block w-64 rounded-[14px] border p-3 text-sm hover:border-teal',
              link.isCurrent ? 'border-teal bg-teal-tint ring-2 ring-primary-700/30' : 'border-hairline bg-surface',
            )}
          >
            <p className="font-semibold break-all text-ink">{link.referenceNo ?? 'Draft replacement'}</p>
            <p className="text-xs text-muted">{link.issuingBank ?? '—'} · <Money amount={link.amount} /></p>
            <p className="mt-1 text-xs text-muted"><DateText value={link.issueDate} /> → <DateText value={link.maturityDate} /></p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <StatusChip status={link.status} />
              {link.isCurrent && <span className="text-xs font-medium text-teal">This instrument</span>}
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
