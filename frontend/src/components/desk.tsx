import { Check, X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FIELD_LABELS, TRACKED_FIELDS, TRUST_TIER_LABELS, type ProvenanceRow, type TrackedField, type TrustTier } from '@fdr/shared';
import { cn } from '@/lib/cn';

// Mission Desk building blocks (docs/design/DESIGN.md, "Components to build once and reuse").

/** Small uppercase label above a title or a section (12–13 px, bold, 0.05em tracking). */
export function Kicker({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'muted' | 'attention'; className?: string }) {
  return <div className={cn('kicker', tone === 'attention' ? 'text-attn' : 'text-muted', className)}>{children}</div>;
}

/** Headline number chip: "5 waiting for you" (at most three per screen). */
export function StatChip({ value, label, tone = 'plain', testId }: { value: ReactNode; label: string; tone?: 'plain' | 'attention'; testId?: string }) {
  return (
    <span data-testid={testId} className={cn('rounded-[10px] border px-3.5 py-2 text-sm whitespace-nowrap',
      tone === 'attention' ? 'border-attn-border bg-attn-tint text-attn-text' : 'border-border bg-white text-ink')}>
      <strong className="text-lg tabular-nums">{value}</strong> {label}
    </span>
  );
}

// ---- Proof strip ----

const TIER_SQUARE: Record<TrustTier, string> = {
  BANK_CONFIRMED: 'bg-teal border-[1.5px] border-teal',
  DOCUMENT: 'border-[1.5px] border-tier-doc-border bg-[linear-gradient(to_top,var(--color-tier-doc)_50%,#fff_50%)]',
  CLAIMED: 'bg-white border-[1.5px] border-dashed border-tier-claimed',
};
const SHORT: Record<TrackedField, string> = {
  reference_no: 'reference', issuing_bank: 'bank', amount: 'amount', issue_date: 'issue date',
  maturity_date: 'maturity date', beneficiary_name: 'beneficiary', lien_marked: 'lien',
};

export function TierSquare({ tier, size = 13 }: { tier: TrustTier; size?: number }) {
  return <span aria-hidden className={cn('inline-block shrink-0 rounded-[3px] box-border', TIER_SQUARE[tier])} style={{ width: size, height: size }} />;
}

/** Seven squares, one per tracked field in the fixed order. Fields without provenance count as claimed.
 *  The tooltip and a screen-reader sentence list every field with its tier (never colour alone). */
export function ProofStrip({ provenance }: { provenance: Pick<ProvenanceRow, 'fieldName' | 'tier'>[] }) {
  const tiers = TRACKED_FIELDS.map((f) => ({ f, tier: provenance.find((p) => p.fieldName === f)?.tier ?? 'CLAIMED' as TrustTier }));
  const text = tiers.map(({ f, tier }) => `${FIELD_LABELS[f]}: ${TRUST_TIER_LABELS[tier]}`).join('; ');
  const bank = tiers.filter((t) => t.tier === 'BANK_CONFIRMED').length;
  return (
    <span className="inline-flex items-center gap-[3px]" title={text} data-testid="proof-strip">
      {tiers.map(({ f, tier }) => <span key={f} data-field={SHORT[f]} data-tier={tier}><TierSquare tier={tier} /></span>)}
      <span className="sr-only">{bank} of 7 fields bank-confirmed. {text}</span>
    </span>
  );
}

/** Legend for the proof strip: shape + text for each tier. */
export function ProofLegend() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-muted">
      {(['BANK_CONFIRMED', 'DOCUMENT', 'CLAIMED'] as const).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5"><TierSquare tier={t} size={12} />{TRUST_TIER_LABELS[t] === 'Claimed' ? 'Claimed by institution' : TRUST_TIER_LABELS[t]}</span>
      ))}
    </span>
  );
}

// ---- Queue row ----

export interface Reason { text: string; urgent?: boolean }

export function ReasonChip({ reason }: { reason: Reason }) {
  return (
    <span className={cn('rounded-[6px] px-2 py-[3px] text-[0.78125rem] font-medium', reason.urgent ? 'bg-attn-tint text-attn-text' : 'bg-chip text-ink-2')}>
      {reason.text}
    </span>
  );
}

/** Rank circle, institution, mono reference · amount, reason chips, priority score; selected = teal tint + 4 px edge. */
export function QueueRow({ rank, title, reference, amount, reasons, score, scoreLabel = 'priority', selected, onSelect, id, testId = 'queue-row' }: {
  testId?: string; rank: number; title: string; reference: ReactNode; amount: ReactNode; reasons: Reason[]; score: ReactNode; scoreLabel?: string;
  selected: boolean; onSelect: () => void; id?: string;
}) {
  return (
    <li id={id} role="option" aria-selected={selected} data-testid={testId} onClick={onSelect}
      className={cn('flex cursor-pointer items-start gap-3.5 border-b border-hairline p-4 hover:bg-subtle',
        selected && 'bg-teal-tint shadow-[inset_4px_0_0_var(--color-teal)] hover:bg-teal-tint')}>
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
        selected ? 'bg-teal text-white' : 'bg-chip text-ink-2')}>{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.96875rem] font-semibold break-words">{title}</div>
        <div className="mono mt-0.5 text-xs break-all text-muted">{reference} · {amount}</div>
        {reasons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">{reasons.map((r) => <ReasonChip key={r.text} reason={r} />)}</div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[1.375rem] leading-none font-bold tabular-nums">{score}</div>
        <div className="mt-1 text-xs text-muted">{scoreLabel}</div>
      </div>
    </li>
  );
}

// ---- Score breakdown ----

export interface ScorePart { label: string; pts: number; max: number; urgent?: boolean }

/** "Why it is ranked here": one bar per factor, points of the factor's maximum. */
export function ScoreBreakdown({ parts, footer }: { parts: ScorePart[]; footer?: ReactNode }) {
  return (
    <div>
      {parts.map((s) => (
        <div key={s.label} className="mb-3">
          <div className="flex justify-between gap-2 text-sm"><span>{s.label}</span><span className="mono">{s.pts} of {s.max}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded bg-track" role="img" aria-label={`${s.label}: ${s.pts} of ${s.max}`}>
            <div className={cn('h-2 rounded', s.urgent ? 'bg-attn' : 'bg-teal')} style={{ width: `${s.max ? Math.min(100, (s.pts / s.max) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
      {footer && <div className="mt-1 text-[0.8125rem] text-muted">{footer}</div>}
    </div>
  );
}

// ---- Condition line ----

/** ✓ met / … waiting, with the text (icon and text, never colour alone). */
export function ConditionLine({ met, children }: { met: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border-t border-hairline py-2.5 text-[0.90625rem] leading-snug">
      <span className={cn('flex size-[22px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold', met ? 'bg-teal-tint text-teal' : 'bg-attn-tint text-attn-text')}>
        {met ? <Check className="size-3.5" aria-hidden /> : '…'}
      </span>
      <span><span className="sr-only">{met ? 'Met: ' : 'Not met yet: '}</span>{children}</span>
    </div>
  );
}

// ---- Action card ----

/** White card with a 5 px attention edge: kicker, title, mono reference, one sentence, one dark button. */
export function ActionCard({ kicker, title, reference, children, action }: { kicker: string; title: string; reference?: ReactNode; children: ReactNode; action: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-l-[5px] border-border border-l-attn bg-white px-[22px] py-5" data-testid="action-card">
      <div className="kicker text-attn-text">{kicker}</div>
      <div className="mt-1.5 text-lg font-bold">{title}</div>
      {reference && <div className="mono mt-1 text-[0.78125rem] break-all text-muted">{reference}</div>}
      <p className="mt-3 mb-4 text-[0.9375rem] leading-normal text-ink-2">{children}</p>
      {action}
    </div>
  );
}

// ---- Tracker ----

export interface TrackerStep { title: string; note: ReactNode; state: 'done' | 'current' | 'next' }

/** Parcel-style stepper: done = filled teal circle with a tick, current = ringed, next = dashed. */
export function Tracker({ steps, note }: { steps: TrackerStep[]; note?: ReactNode }) {
  return (
    <div>
      <ol className="mt-7 flex flex-wrap gap-y-6">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={s.title} className="relative min-w-[180px] flex-[1_1_200px] pr-4" aria-current={s.state === 'current' ? 'step' : undefined}>
              <div className="flex items-center">
                <span className={cn('box-border flex size-[34px] shrink-0 items-center justify-center rounded-full font-bold',
                  s.state === 'done' && 'bg-teal text-base text-white',
                  s.state === 'current' && 'border-[3px] border-teal bg-white text-sm text-teal',
                  s.state === 'next' && 'border-2 border-dashed border-[#AEB8C2] bg-white text-sm text-[#7B8794]')}>
                  {s.state === 'done' ? <Check className="size-4" strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                {!last && <span aria-hidden className={cn('mx-2 h-[3px] flex-1 rounded-[6px]', s.state === 'done' ? 'bg-teal' : 'bg-[repeating-linear-gradient(to_right,#AEB8C2_0_6px,transparent_6px_12px)]')} />}
              </div>
              <div className="mt-3 text-[0.96875rem] font-bold">
                <span className="sr-only">{s.state === 'done' ? 'Done: ' : s.state === 'current' ? 'Now: ' : 'Next: '}</span>{s.title}
              </div>
              <div className="mt-1 text-sm leading-[1.45] text-muted">{s.note}</div>
            </li>
          );
        })}
      </ol>
      {note && <div className="mt-[22px] rounded-[10px] bg-teal-tint px-[18px] py-3.5 text-[0.9375rem] leading-normal">{note}</div>}
    </div>
  );
}

// ---- Keyboard legend ----

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono rounded-[4px] border border-border bg-white px-1.5 py-px text-[0.78125rem]">{children}</kbd>;
}

/** Under the queue: J K move, R recommend, B ask bank, O open record. */
export function KeyLegend({ keys }: { keys: { k: string[]; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 bg-subtle px-4 py-3 text-[0.78125rem] text-muted" aria-label="Keyboard shortcuts">
      {keys.map((x) => <span key={x.label}>{x.k.map((k) => <span key={k}><Kbd>{k}</Kbd> </span>)}{x.label}</span>)}
    </div>
  );
}

// ---- Drawer ----

/** Right-hand drawer for secondary detail (the one floating surface besides menus that may carry a shadow). */
export function Drawer({ open, title, onClose, children, width = 'md', description }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
  /** md = 448 px (filters, short details), lg = 720 px (before/after, long bodies). */
  width?: 'md' | 'lg'; description?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      // Keep Tab inside the drawer while it is open.
      const items = panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-ink/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={cn('fade-in absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-white shadow-xl outline-none', width === 'lg' ? 'max-w-3xl' : 'max-w-md')}>
        <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold break-words">{title}</h2>
            {description && <div className="mt-1 text-sm text-muted">{description}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-[8px] p-1.5 text-muted hover:bg-chip hover:text-ink"><X className="size-4" aria-hidden /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-6 text-[0.9375rem]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
