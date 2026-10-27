import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Page heading: 30 px title, one plain sentence, actions on the right; optional "← Back to …" link above. */
export function PageHeader({ title, subtitle, actions, back }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && <BackLink to={back.to} label={back.label} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.875rem] leading-tight font-bold tracking-[-0.02em] text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-base text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** "← Back to <page>": every detail page has a way back now that breadcrumbs are gone. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-teal hover:text-teal-hover hover:underline print:hidden">
      <ArrowLeft className="size-4" aria-hidden /> Back to {label}
    </Link>
  );
}
