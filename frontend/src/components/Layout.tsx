import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useMeta } from '@/api/instruments';
import { useAuth } from '@/auth/AuthContext';
import { menuFor, menuLinks } from '@/lib/nav';
import { Breadcrumbs } from './shell/Breadcrumbs';
import { CommandPalette } from './shell/CommandPalette';
import { MenuBar } from './shell/MenuBar';
import { SiteFooter } from './shell/SiteFooter';
import { SiteHeader } from './shell/SiteHeader';
import { UtilityBar } from './shell/UtilityBar';

/** 4 px tricolour accent line (three flat bands, no gradient). */
function TricolourLine() {
  return (
    <div className="flex h-1 print:hidden" aria-hidden>
      <span className="flex-1 bg-saffron" /><span className="flex-1 bg-white" /><span className="flex-1 bg-india-green" />
    </div>
  );
}

/** Centred, fluid content column (max 1600 px). */
function Main({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 print:max-w-none print:p-0">
      {children}
    </main>
  );
}

/** Signed-in shell: tricolour line, accessibility bar, header, menu bar, breadcrumbs, content, footer. */
export function Layout() {
  const { user } = useAuth();
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
      <TricolourLine />
      <UtilityBar />
      <SiteHeader onSearch={() => setPalette(true)} />
      <MenuBar entries={entries} />
      <Breadcrumbs />
      <Main><Outlet /></Main>
      <SiteFooter />
      <CommandPalette open={palette} onClose={() => setPalette(false)} links={menuLinks(entries)} canSearchRegister={!!user && user.role !== 'institution'} />
    </div>
  );
}

/** Public pages (sign in, help, policies, release verification): same header and footer, no menu. */
export function PublicLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TricolourLine />
      <UtilityBar signedIn={false} />
      <SiteHeader />
      <div className="h-2 bg-navy print:hidden" aria-hidden />
      <Breadcrumbs />
      <Main>{children ?? <Outlet />}</Main>
      <SiteFooter />
    </div>
  );
}
