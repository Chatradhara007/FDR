import { FlaskConical, LogOut, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useMeta } from '@/api/instruments';
import { useAuth } from '@/auth/AuthContext';
import { AlertBell } from '../AlertBell';
import { Crest } from './Crest';

/** White header band: crest, bilingual title and prototype tag; alerts, search and sign out on the right. */
export function SiteHeader({ onSearch }: { onSearch?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const demoMode = useMeta(!!user).data?.demoMode === true;
  return (
    <header className="border-b border-line bg-white print:hidden">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-3">
          <Crest className="h-14 w-12 shrink-0" />
          <div className="min-w-0 leading-tight">
            <p lang="hi" className="text-base font-semibold text-navy">सुरक्षा जमा एवं एफडीआर प्रबंधन पोर्टल</p>
            <p className="text-lg font-bold text-navy sm:text-xl">Security Deposit &amp; FDR Management Portal</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-700">
              <span className="border border-slate-500 px-1.5">Prototype · SIH 2026 · Problem SIH26265</span>
              {demoMode && (
                <span data-testid="demo-ribbon" className="inline-flex items-center gap-1 border border-warning-600 bg-warning-50 px-1.5 font-semibold text-warning-700">
                  <FlaskConical className="size-3.5" aria-hidden /> Demo mode · synthetic data
                </span>
              )}
            </p>
          </div>
        </Link>
        {user && (
          <div className="flex items-center gap-2">
            <AlertBell />
            {onSearch && (
              <button type="button" onClick={onSearch} aria-keyshortcuts="Control+K"
                className="inline-flex h-9 items-center gap-2 border border-slate-400 bg-white px-3 text-sm text-slate-800 hover:bg-primary-50">
                <Search className="size-4" aria-hidden /> Search <kbd className="hidden border border-slate-400 px-1 text-xs sm:inline">Ctrl K</kbd>
              </button>
            )}
            <button type="button" onClick={() => { logout(); navigate('/login', { replace: true }); }}
              className="inline-flex h-9 items-center gap-2 border border-navy bg-white px-3 text-sm font-semibold text-navy hover:bg-primary-50">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
