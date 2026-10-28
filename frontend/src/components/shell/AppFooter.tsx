import { Link } from 'react-router-dom';
import { useShowcase } from '@/hooks/useShowcase';

const LINKS = [
  { to: '/help/faq', label: 'Help' },
  { to: '/policies/accessibility', label: 'Accessibility' },
  { to: '/policies/privacy', label: 'Privacy' },
];

/** One small line on app pages. */
export function AppFooter({ showcase = false }: { showcase?: boolean }) {
  return (
    <footer className="mx-auto w-full max-w-[1400px] px-4 pb-8 sm:px-7 print:hidden">
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted">
        <span>{showcase ? 'Prototype for SIH26265 · all data is sample data' : 'Prototype for SIH26265. All deposits, banks and institutions shown are synthetic demo data.'}</span>
        {LINKS.map((l) => <Link key={l.to} to={l.to} className="underline-offset-2 hover:text-ink hover:underline">{l.label}</Link>)}
      </p>
    </footer>
  );
}

/** Public pages (sign in, verify, policies): the same line plus the help and policy links. */
export function PublicFooter() {
  const showcase = useShowcase();
  const groups = [
    { title: 'Help', links: [{ to: '/help/about', label: 'How it works' }, { to: '/help/faq', label: 'FAQ' }, { to: '/help/contact', label: 'Contact helpdesk' }] },
    { title: 'Policies', links: [
      { to: '/policies/terms', label: 'Terms of use' },
      { to: '/policies/privacy', label: 'Privacy policy' },
      { to: '/policies/accessibility', label: 'Accessibility statement' },
      { to: '/policies/disclaimer', label: 'Disclaimer' },
    ] },
  ];
  return (
    <footer className="mt-6 border-t border-border bg-white print:hidden">
      <div className="mx-auto flex max-w-[1400px] flex-wrap gap-x-12 gap-y-4 px-4 py-6 text-sm sm:px-7">
        {groups.map((g) => (
          <div key={g.title}>
            <h2 className="kicker mb-2 text-muted">{g.title}</h2>
            <ul className="space-y-1">{g.links.map((l) => <li key={l.to}><Link to={l.to} className="gov-link">{l.label}</Link></li>)}</ul>
          </div>
        ))}
        <p className="min-w-0 flex-[1_1_280px] text-[0.8125rem] text-muted">
          {showcase ? 'Prototype for SIH26265 · all data is sample data' : 'Prototype built for Smart India Hackathon 2026 (SIH26265). All data shown is synthetic. This is not an official AICTE website.'}
        </p>
      </div>
    </footer>
  );
}
