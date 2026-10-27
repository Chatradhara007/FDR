import { FlaskConical, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useMeta } from '@/api/instruments';
import { useAuth } from '@/auth/AuthContext';
import { menuFor, menuLinks } from '@/lib/nav';
import { AlertBell } from './AlertBell';
import { ClockChip } from './ClockBadge';
import { CommandPalette } from './shell/CommandPalette';
import { MenuBar } from './shell/MenuBar';
import { useDisplayPrefs } from './shell/prefs';
import { AppFooter, SiteFooter } from './shell/SiteFooter';
import { UserMenu } from './shell/UserMenu';
import { Wordmark } from './shell/Wordmark';

function SkipLink() {
  return (
    <a href="#main" className="sr-only z-[60] rounded-lg bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
      Skip to main content
    </a>
  );
}

/** Slim, unobtrusive strip shown while the server runs in demo mode. */
function DemoRibbon() {
  return (
    <div data-testid="demo-ribbon" className="flex items-center justify-center gap-1.5 bg-strip px-4 py-1 text-sm text-slate-600 print:hidden">
      <FlaskConical className="size-3.5 text-warning-700" aria-hidden /> Demo mode · synthetic data
    </div>
  );
}

function Main({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" tabIndex={-1} className={`mx-auto w-full flex-1 px-4 py-8 outline-none sm:px-6 lg:px-8 lg:py-10 print:max-w-none print:p-0 ${wide ? 'max-w-[1440px]' : 'max-w-[1264px]'}`}>
      {children}
    </main>
  );
}

/** Pages with charts get a little more width. */
const WIDE = /^\/(dashboard|reports)/;

/** Signed-in shell: one slim top bar, content, one footer line. */
export function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  useDisplayPrefs();
  const demoMode = useMeta().data?.demoMode === true;
  const entries = useMemo(() => (user ? menuFor(user.role, demoMode) : []), [user, demoMode]);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      {demoMode && <DemoRibbon />}
      <header className="relative border-b border-line bg-surface print:hidden">
        <div className="border-b border-line bg-strip">
          <div className="mx-auto flex h-10 max-w-[1440px] items-center justify-between gap-4 px-4 text-sm sm:px-6 lg:px-8">
            <p className="min-w-0 truncate text-gray-600">
              <span className="font-medium text-gray-800">All India Council for Technical Education</span>
              <span className="hidden md:inline"> · Security Deposit &amp; FDR Portal</span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <ClockChip />
              <UserMenu />
            </div>
          </div>
        </div>
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Wordmark />
          <MenuBar entries={entries} />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setPalette(true)} aria-keyshortcuts="Control+K" aria-label="Search (Ctrl+K)"
              className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-gray-600 hover:bg-strip 2xl:border 2xl:border-line 2xl:px-3">
              <Search className="size-[18px]" aria-hidden />
              <span className="hidden 2xl:inline">Search</span>
              <kbd className="hidden rounded border border-line px-1 text-xs 2xl:inline">Ctrl K</kbd>
            </button>
            <AlertBell />
          </div>
        </div>
      </header>
      <Main wide={WIDE.test(pathname)}><Outlet /></Main>
      <AppFooter />
      <CommandPalette open={palette} onClose={() => setPalette(false)} links={menuLinks(entries)} canSearchRegister={!!user && user.role !== 'institution'} />
    </div>
  );
}

/** Public pages (sign in, help, policies, release verification): wordmark header and a fuller footer. */
export function PublicLayout({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  useDisplayPrefs();
  const login = pathname === '/login';
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Wordmark bilingual={login} />
          <span className="text-sm text-slate-600">Prototype · SIH 2026</span>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-10 outline-none sm:px-6 lg:px-8 print:max-w-none print:p-0">
        {children ?? <Outlet />}
      </main>
      <SiteFooter />
    </div>
  );
}

