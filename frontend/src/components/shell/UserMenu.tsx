import { Contrast, LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@fdr/shared';
import { useAuth } from '@/auth/AuthContext';
import { cn } from '@/lib/cn';
import { useDisplayPrefs, type TextSize } from './prefs';

const SIZES: { key: TextSize; label: string; name: string }[] = [
  { key: 'sm', label: 'A-', name: 'Decrease text size' },
  { key: 'md', label: 'A', name: 'Default text size' },
  { key: 'lg', label: 'A+', name: 'Increase text size' },
];

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}

/** Round avatar; opens name and role, text size, high contrast and Sign out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { size, setSize, contrast, setContrast } = useDisplayPrefs();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!user) return null;
  return (
    <div ref={root} className="relative">
      <button type="button" aria-expanded={open} aria-controls={id} aria-label={`Account: ${user.name}`} onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-full text-left">
        <span aria-hidden className={cn('flex size-[34px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white', user.role === 'institution' ? 'bg-teal' : 'bg-ink')}>
          {initials(user.name)}
        </span>
        {user.role === 'institution' && (
          <span aria-hidden className="hidden max-w-56 text-[13px] leading-tight xl:block">
            <span className="block truncate font-semibold">{user.name}</span>
            <span className="block truncate text-muted">{user.institutionName}</span>
          </span>
        )}
      </button>
      {open && (
        <div id={id} className="absolute top-full right-0 z-40 mt-1.5 w-72 rounded-[12px] border border-border bg-white p-4 shadow-lg">
          <p className="font-semibold" data-testid="user-name">{user.name}</p>
          <p className="text-[0.8125rem] text-muted">{ROLE_LABELS[user.role]}{user.institutionName && ` · ${user.institutionName}`}</p>
          <div className="mt-4 border-t border-hairline pt-3">
            <p className="kicker mb-2 text-muted">Text size</p>
            <div role="group" aria-label="Text size" className="flex gap-1.5">
              {SIZES.map((s) => (
                <button key={s.key} type="button" aria-label={s.name} aria-pressed={size === s.key} onClick={() => setSize(s.key)}
                  className={cn('h-9 min-w-11 rounded-[8px] border px-2 font-semibold', size === s.key ? 'border-ink bg-ink text-white' : 'border-border hover:bg-subtle')}>
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" aria-pressed={contrast} onClick={() => setContrast(!contrast)}
              className={cn('mt-2 inline-flex h-9 w-full items-center gap-2 rounded-[8px] border px-3 text-sm font-semibold', contrast ? 'border-ink bg-ink text-white' : 'border-border hover:bg-subtle')}>
              <Contrast className="size-4" aria-hidden /> High contrast {contrast ? 'on' : 'off'}
            </button>
          </div>
          <button type="button" onClick={() => { logout(); navigate('/login', { replace: true }); }}
            className="mt-3 inline-flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-sm font-semibold text-ink hover:bg-chip">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
