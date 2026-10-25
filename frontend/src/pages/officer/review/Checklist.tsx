import { CheckCircle2, CircleAlert, OctagonX } from 'lucide-react';
import type { Gap } from '@fdr/shared';
import { Card } from '@/components';

/** Completeness checklist from findGaps: blockers stop acceptance, warnings need the officer's judgement. */
export function Checklist({ gaps }: { gaps: Gap[] }) {
  return (
    <Card title="Completeness checklist">
      {gaps.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success-700"><CheckCircle2 className="size-4" aria-hidden /> Everything is in place and bank-confirmed.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {gaps.map((g, i) => (
            <li key={`${g.code}-${g.ref ?? i}`} className={g.severity === 'blocker' ? 'flex items-start gap-2 text-danger-700' : 'flex items-start gap-2 text-warning-700'}>
              {g.severity === 'blocker' ? <OctagonX className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
              <span><span className="sr-only">{g.severity === 'blocker' ? 'Blocker: ' : 'Warning: '}</span>{g.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
