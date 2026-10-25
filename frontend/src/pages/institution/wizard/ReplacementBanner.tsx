import { RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDate } from '@fdr/shared';
import { useInstrument } from '@/api/instruments';

/** On a renewal draft: what it replaces, and the rule it must meet (§5.3). */
export function ReplacementBanner({ parentId }: { parentId: string }) {
  const parent = useInstrument(parentId).data;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-info-600/30 bg-info-50 px-4 py-3 text-sm text-info-700">
      <RefreshCcw className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">
          Replacement for <Link to={`/instruments/${parentId}`} className="underline">{parent?.referenceNo ?? 'an earlier instrument'}</Link>
          {parent?.maturityDate && <> (matures {formatDate(parent.maturityDate)})</>}
        </p>
        <p>Enter the new deposit’s reference and dates. It must mature after the instrument it replaces; a gap in cover or a lower amount is flagged for the officer.</p>
      </div>
    </div>
  );
}
