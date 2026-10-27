import { AlertTriangle, BadgeCheck, CircleHelp, Hourglass, WifiOff, type LucideIcon } from 'lucide-react';
import { TRUST_TIER_LABELS, VERIFICATION_STATE_LABELS, type TrustTier, type VerificationState } from '@fdr/shared';
import { Badge, type Tone } from './Badge';
import { TierSquare } from './desk';

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

// The tier label everywhere: the same square shape as the proof strip, then the words (never colour alone).
const TIER: Record<TrustTier, { tone: Tone; label: string }> = {
  CLAIMED: { tone: 'neutral', label: 'Claimed by institution' },
  DOCUMENT: { tone: 'info', label: TRUST_TIER_LABELS.DOCUMENT },
  BANK_CONFIRMED: { tone: 'success', label: TRUST_TIER_LABELS.BANK_CONFIRMED },
};

/** Trust tier of one field: the proof-strip square (solid, half-filled, dashed) plus its label. */
export function TrustBadge({ tier, short }: { tier: TrustTier; short?: boolean }) {
  const t = TIER[tier];
  return (
    <Badge tone={t.tone} icon={<TierSquare tier={tier} size={12} />}>
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
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <span>Weakest field:</span>
      <TrustBadge tier={tier} short />
    </span>
  );
}
