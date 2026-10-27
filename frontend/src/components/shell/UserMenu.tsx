import { ChevronDown, LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@fdr/shared';
import { useAuth } from '@/auth/AuthContext';
import { DisplayControls } from './DisplayControls';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}

/** Avatar button: who is signed in, display settings, help links and Sign out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => setOpen(false), [pathname]);
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
        className="flex h-10 items-center gap-2 rounded-full pr-1 pl-1 hover:bg-strip 2xl:pr-2">
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-ink" aria-hidden>{initials(user.name)}</span>
        <span className="hidden max-w-40 truncate text-sm font-medium text-slate-800 2xl:inline" data-testid="user-name">{user.name}</span>
        <ChevronDown className="hidden size-4 text-slate-500 2xl:block" aria-hidden />
      </button>
      {open && (
        <div id={id} className="fade-in absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-2 shadow-md">
          <div className="px-3 pt-2 pb-3">
            <p className="font-medium text-slate-900">{user.name}</p>
            <p className="text-sm text-slate-600">{ROLE_LABELS[user.role]}{user.institutionName && ` · ${user.institutionName}`}</p>
          </div>
          <div className="border-t border-line px-3 py-3">
            <p className="mb-2 text-sm font-medium text-slate-600">Display</p>
            <DisplayControls />
          </div>
          <div className="border-t border-line py-1.5">
            <Link to="/help/faq" className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-strip">Help</Link>
            <Link to="/policies/accessibility" className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-strip">Accessibility</Link>
          </div>
          <div className="border-t border-line pt-1.5">
            <button type="button" onClick={() => { logout(); navigate('/login', { replace: true }); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-strip">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
