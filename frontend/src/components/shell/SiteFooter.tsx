import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useClock } from '@/hooks/useClock';
import { formatDateGov } from '@/lib/format';
import { ROLE_HOME } from '@/lib/roles';

function Col({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div>
      <h2 className="mb-2 border-b border-primary-500 pb-1 text-sm font-bold tracking-wide text-white uppercase">{title}</h2>
      <ul className="space-y-1">
        {links.map((l) => <li key={l.to}><Link to={l.to} className="text-sm text-primary-100 underline-offset-2 hover:text-white hover:underline">{l.label}</Link></li>)}
      </ul>
    </div>
  );
}

/** Navy footer on every page: quick links, help, policies, the prototype disclaimer and the last updated date. */
export function SiteFooter() {
  const { user } = useAuth();
  const clock = useClock(!!user);
  const quick = user
    ? [{ to: ROLE_HOME[user.role], label: 'Home' }, { to: '/alerts', label: 'Alerts' }, ...(user.role === 'institution' ? [] : [{ to: '/register', label: 'Register' }, { to: '/reports', label: 'Reports' }])]
    : [{ to: '/login', label: 'Sign in' }];
  return (
    <footer className="mt-10 border-t-4 border-saffron bg-navy text-primary-100 print:hidden">
      <div className="mx-auto grid max-w-[1600px] gap-6 px-4 py-6 sm:grid-cols-3 sm:px-6 lg:px-8">
        <Col title="Quick links" links={quick} />
        <Col title="Help" links={[{ to: '/help/faq', label: 'FAQ' }, { to: '/help/contact', label: 'Contact helpdesk' }]} />
        <Col title="Policies" links={[
          { to: '/policies/terms', label: 'Terms of use' },
          { to: '/policies/privacy', label: 'Privacy policy' },
          { to: '/policies/accessibility', label: 'Accessibility statement' },
          { to: '/policies/disclaimer', label: 'Disclaimer' },
        ]} />
      </div>
      <div className="border-t border-primary-600">
        <div className="mx-auto flex max-w-[1600px] flex-wrap justify-between gap-x-6 gap-y-1 px-4 py-3 text-sm sm:px-6 lg:px-8">
          <p>Prototype built for Smart India Hackathon 2026 (SIH26265). All data shown is synthetic. This is not an official AICTE website.</p>
          <p className="flex flex-wrap gap-x-4">
            {clock.data && <span>Last updated: {formatDateGov(clock.data.today)}</span>}
            <span>Best viewed in the latest Chrome, Edge or Firefox</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
