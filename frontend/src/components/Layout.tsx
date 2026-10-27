import { FlaskConical, Menu, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useMeta } from '@/api/instruments';
import { useAuth } from '@/auth/AuthContext';
import { menuFor, menuLinks } from '@/lib/nav';
import { ROLE_HOME } from '@/lib/roles';
import { AlertBell } from './AlertBell';
import { AppFooter, PublicFooter } from './shell/AppFooter';
import { ClockChip } from './shell/ClockChip';
import { CommandPalette } from './shell/CommandPalette';
import { NavPills } from './shell/NavPills';
import { UserMenu } from './shell/UserMenu';

function SkipLink() {
  return (
    <a href="#main" className="sr-only z-50 rounded-[8px] bg-ink px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
      Skip to main content
    </a>
  );
}

/** Small teal square + "FDR Portal". */
function Wordmark({ to }: { to: string }) {
  return (
    <Link to={to} className="flex shrink-0 items-center gap-[9px] text-[1.0625rem] font-bold whitespace-nowrap text-ink">
      <span aria-hidden className="inline-block size-6 rounded-[6px] bg-teal" />FDR Portal
    </Link>
  );
}

/** Slim, unobtrusive demo-mode line under the header. */
function DemoRibbon() {
  return (
    <div data-testid="demo-ribbon" className="border-b border-attn-border bg-attn-tint print:hidden">
      <p className="mx-auto flex max-w-[1400px] items-center gap-1.5 px-4 py-1 text-[0.8125rem] text-attn-text sm:px-7">
        <FlaskConical className="size-3.5 shrink-0" aria-hidden /> Demo mode · synthetic data
      </p>
    </div>
  );
}

/** Signed-in shell: 60 px header (wordmark, nav pills, search, app clock, alerts, account), demo ribbon, content, one-line footer. */
export function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const demoMode = useMeta().data?.demoMode === true;
  const entries = useMemo(() => (user ? menuFor(user.role, demoMode) : []), [user, demoMode]);
  const [palette, setPalette] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const internal = !!user && user.role !== 'institution';
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="border-b border-border bg-white print:hidden">
        <div className="mx-auto flex min-h-[60px] max-w-[1600px] flex-wrap items-center gap-x-2 px-4 sm:gap-x-3 sm:px-7 lg:flex-nowrap lg:gap-x-5">
          <Wordmark to={user ? ROLE_HOME[user.role] : '/'} />
          <NavPills entries={entries} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
          <div className="flex-1" />
          <button type="button" onClick={() => setPalette(true)} aria-keyshortcuts="Control+K"
            aria-label={internal ? 'Jump to a deposit: type a reference (Ctrl+K)' : 'Search pages (Ctrl+K)'}
            className="inline-flex h-[38px] min-w-0 shrink items-center gap-2 rounded-[8px] border border-border bg-canvas px-2.5 text-sm text-muted hover:border-slate-400 2xl:w-[300px] 2xl:px-3.5">
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="hidden truncate 2xl:inline">{internal ? 'Jump to a deposit: type a reference' : 'Search pages'}</span>
            <kbd className="mono ml-auto hidden text-xs 2xl:inline">Ctrl K</kbd>
          </button>
          <ClockChip admin={user?.role === 'admin'} />
          <AlertBell />
          <UserMenu />
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-sm font-semibold lg:hidden"
            aria-expanded={mobileOpen} aria-controls="main-menu" onClick={() => setMobileOpen((o) => !o)}>
            {mobileOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />} Menu
          </button>
        </div>
      </header>
      {demoMode && <DemoRibbon />}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-9 outline-none sm:px-7 print:max-w-none print:p-0">
        <Outlet />
      </main>
      <AppFooter />
      <CommandPalette open={palette} onClose={() => setPalette(false)} links={menuLinks(entries)} canSearchRegister={internal} />
    </div>
  );
}

/** Public pages (sign in, help, policies, release verification): the slim header without nav, and a fuller footer. */
export function PublicLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="border-b border-border bg-white print:hidden">
        <div className="mx-auto flex min-h-[60px] max-w-[1400px] items-center gap-4 px-4 sm:px-7">
          <Wordmark to="/" />
          <span className="hidden text-[0.8125rem] text-muted sm:inline">Security Deposit &amp; FDR Management · Prototype</span>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-8 pb-10 outline-none sm:px-7 print:max-w-none print:p-0">
        {children ?? <Outlet />}
      </main>
      <PublicFooter />
    </div>
  );
}
