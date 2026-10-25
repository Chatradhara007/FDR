import { AlertTriangle, BadgeCheck, CircleHelp, FileCheck2, Hourglass, Landmark, MessageSquareQuote, WifiOff, type LucideIcon } from 'lucide-react';
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
  CLAIMED: { tone: 'neutral', icon: MessageSquareQuote, label: 'Claimed by institution' },
  DOCUMENT: { tone: 'info', icon: FileCheck2, label: TRUST_TIER_LABELS.DOCUMENT },
  BANK_CONFIRMED: { tone: 'success', icon: Landmark, label: TRUST_TIER_LABELS.BANK_CONFIRMED },
};

/** Trust tier of one field. */
export function TrustChip({ tier }: { tier: TrustTier }) {
  const t = TIER[tier];
  const Icon = t.icon;
  return (
    <Badge tone={t.tone} icon={<Icon className="size-3.5" aria-hidden />}>
      {t.label}
    </Badge>
  );
}
