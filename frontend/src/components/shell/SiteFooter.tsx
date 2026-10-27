import { Link } from 'react-router-dom';
import { DisplayControls } from './DisplayControls';

const NOTICE = 'Prototype for Smart India Hackathon 2026 (SIH26265). All data is synthetic. Not an official AICTE website.';

/** App pages: one quiet line. */
export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-line print:hidden">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-5 text-sm text-slate-600 sm:px-6 lg:px-8">
        <p>{NOTICE}</p>
        <p className="flex gap-5">
          <Link to="/help/faq" className="hover:text-ink hover:underline underline-offset-4">Help</Link>
          <Link to="/policies/accessibility" className="hover:text-ink hover:underline underline-offset-4">Accessibility</Link>
          <Link to="/policies/privacy" className="hover:text-ink hover:underline underline-offset-4">Privacy</Link>
        </p>
      </div>
    </footer>
  );
}

function Col({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      <ul className="space-y-2">
        {links.map((l) => <li key={l.to}><Link to={l.to} className="text-sm text-slate-600 underline-offset-4 hover:text-ink hover:underline">{l.label}</Link></li>)}
      </ul>
    </div>
  );
}

/** Public pages (sign in, verify, policies): a fuller footer with help, policies and display settings. */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface print:hidden">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6 lg:px-8">
        <Col title="Help" links={[{ to: '/login', label: 'Sign in' }, { to: '/help/faq', label: 'Frequently asked questions' }, { to: '/help/contact', label: 'Contact the helpdesk' }]} />
        <Col title="Policies" links={[
          { to: '/policies/terms', label: 'Terms of use' },
          { to: '/policies/privacy', label: 'Privacy policy' },
          { to: '/policies/accessibility', label: 'Accessibility statement' },
          { to: '/policies/disclaimer', label: 'Disclaimer' },
        ]} />
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Display</h2>
          <DisplayControls />
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-[1200px] px-4 py-4 text-sm text-slate-600 sm:px-6 lg:px-8">{NOTICE}</p>
      </div>
    </footer>
  );
}
