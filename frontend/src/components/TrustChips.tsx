import { AlertTriangle, BadgeCheck, Circle, CircleHelp, FileCheck2, Hourglass, ShieldCheck, WifiOff, type LucideIcon } from 'lucide-react';
import { TRUST_TIER_LABELS, VERIFICATION_STATE_LABELS, type TrustTier, type VerificationState } from '@fdr/shared';
import { Badge, type Tone } from './Badge';

const VERIFICATION: Record<VerificationState, { tone: Tone; icon: LucideIcon }> = {
  UNVERIFIED: { tone: 'neutral', icon: CircleHelp },
  PENDING: { tone: 'info', icon: Hourglass },
  CONFIRMED: { tone: 'success', icon: BadgeCheck },
  MISMATCH: { tone: 'danger', icon: AlertTriangle },
  UNAVAILABLE: { tone: 'warning', icon: WifiOff },
};

/** How much of the record the bank has proven (icon + label, never colour alone). */
export function VerificationChip({ state }: { state: VerificationState }) {
  const v = VERIFICATION[state];
  const Icon = v.icon;
  return (
    <Badge tone={v.tone} icon={<Icon className="size-3.5" aria-hidden />}>
      {VERIFICATION_STATE_LABELS[state]}
    </Badge>
  );
}

const TIER: Record<TrustTier, { tone: Tone; icon: LucideIcon; label: string }> = {
  CLAIMED: { tone: 'neutral', icon: Circle, label: 'Claimed by institution' },
  DOCUMENT: { tone: 'info', icon: FileCheck2, label: TRUST_TIER_LABELS.DOCUMENT },
  BANK_CONFIRMED: { tone: 'success', icon: ShieldCheck, label: TRUST_TIER_LABELS.BANK_CONFIRMED },
};

/** Trust tier of one field: Claimed (outline circle), Document-checked (file check), Bank-confirmed (shield check). */
export function TrustBadge({ tier, short }: { tier: TrustTier; short?: boolean }) {
  const t = TIER[tier];
  const Icon = t.icon;
  return (
    <Badge tone={t.tone} icon={<Icon className="size-3.5" aria-hidden />}>
      {short ? TRUST_TIER_LABELS[tier] : t.label}
    </Badge>
  );
}

/** Kept for the institution pages (Phase 02 name). */
export const TrustChip = TrustBadge;

/** The instrument's headline tier: the weakest of its seven fields. */
export function WeakestTierBadge({ tier }: { tier: TrustTier | null }) {
  if (!tier) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
      <span>Weakest field:</span>
      <TrustBadge tier={tier} short />
    </span>
  );
}
