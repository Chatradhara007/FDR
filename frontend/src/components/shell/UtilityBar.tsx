import { Contrast } from 'lucide-react';
import { ROLE_LABELS } from '@fdr/shared';
import { useAuth } from '@/auth/AuthContext';
import { cn } from '@/lib/cn';
import { ClockBadge, ClockControls } from '../ClockBadge';
import { useDisplayPrefs, type TextSize } from './prefs';

const SIZES: { key: TextSize; label: string; name: string }[] = [
  { key: 'sm', label: 'A-', name: 'Decrease text size' },
  { key: 'md', label: 'A', name: 'Default text size' },
  { key: 'lg', label: 'A+', name: 'Increase text size' },
];

/** Light-grey accessibility bar: skip link, text size, contrast; signed-in user, role and app clock on the right. */
export function UtilityBar({ signedIn = true }: { signedIn?: boolean }) {
  const { user } = useAuth();
  const { size, setSize, contrast, setContrast } = useDisplayPrefs();
  return (
    <div className="border-b border-line bg-[#eceff3] text-sm print:hidden">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href="#main" className="text-link underline-offset-2 hover:underline">Skip to main content</a>
          <span className="text-slate-400" aria-hidden>|</span>
          <div role="group" aria-label="Text size" className="flex items-center">
            {SIZES.map((s) => (
              <button key={s.key} type="button" aria-label={s.name} aria-pressed={size === s.key} onClick={() => setSize(s.key)}
                className={cn('h-7 min-w-8 border border-slate-400 px-1.5 font-semibold -ml-px first:ml-0', size === s.key ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-primary-50')}>
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" aria-pressed={contrast} onClick={() => setContrast(!contrast)}
            className={cn('inline-flex h-7 items-center gap-1 border border-slate-400 px-2 font-semibold', contrast ? 'bg-black text-white' : 'bg-white text-navy hover:bg-primary-50')}>
            <Contrast className="size-4" aria-hidden /> High contrast
          </button>
        </div>
        {signedIn && user && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-slate-800">
              <span className="font-semibold" data-testid="user-name">{user.name}</span>
              {user.institutionName && <span className="text-slate-700"> · {user.institutionName}</span>}
              <span className="text-slate-700"> · Role: {ROLE_LABELS[user.role]}</span>
            </span>
            <ClockBadge />
            {user.role === 'admin' && <ClockControls />}
          </div>
        )}
      </div>
    </div>
  );
}
