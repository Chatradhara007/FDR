import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Notice, PageHeader, Panel } from '@/components';
import { useShowcase } from '@/hooks/useShowcase';

function Page({ title, children, note = true }: { title: string; children: ReactNode; note?: boolean }) {
  const showcase = useShowcase();
  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader back={{ to: '/', label: 'the portal' }} title={title} />
      {note && (
        <Notice className="mb-4">
          {showcase
            ? 'This portal is a prototype built for SIH26265. This page is not an official policy of any organisation.'
            : 'This page belongs to a hackathon prototype. Its text is a placeholder and is not an official policy of any organisation.'}
        </Notice>
      )}
      <Panel><div className="space-y-4 text-base leading-relaxed text-ink">{children}</div></Panel>
    </div>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: 'Who uses this portal?', a: 'Institutions lodge fixed deposit receipts (FDRs) and security deposits. AICTE officials verify them, watch their maturity, process renewals and authorise release. Auditors can view the audit trail and reports.' },
  { q: 'How does an institution lodge an FDR?', a: 'Sign in with the institution account, open My institution and choose to add a new instrument. Enter the particulars exactly as printed on the receipt, upload the required documents and submit the record for scrutiny.' },
  { q: 'What do "Claimed by institution", "Document-checked" and "Bank-confirmed" mean?', a: 'They show how much of each particular is proven. Claimed means only the institution has stated it; Document-checked means an officer has checked it against the uploaded document; Bank-confirmed means the issuing bank has confirmed it.' },
  { q: 'Does the portal approve releases automatically?', a: 'No. The portal records the checks and the recommendation; the decision on every release is taken by an official.' },
  { q: 'Is the data real?', a: 'No. Every institution, deposit and person in this prototype is synthetic.' },
];

export function FaqPage() {
  return (
    <Page title="Frequently asked questions">
      <p>New here? Read <Link className="gov-link" to="/help/about">how the portal works</Link> on one page.</p>
      <dl className="divide-y divide-hairline">
        {FAQ.map((f, i) => (
          <div key={f.q} className="py-3 first:pt-0">
            <dt className="font-semibold text-ink">{i + 1}. {f.q}</dt>
            <dd className="mt-1">{f.a}</dd>
          </div>
        ))}
      </dl>
    </Page>
  );
}

export function ContactPage() {
  return (
    <Page title="Contact helpdesk">
      <p>This prototype has no live helpdesk. In a production deployment this page would list the helpdesk telephone number, working hours and e-mail address of the responsible office.</p>
      <table className="gov-table max-w-xl">
        <tbody>
          <tr><th scope="row" className="w-48">E-mail</th><td>helpdesk@example.invalid (placeholder)</td></tr>
          <tr><th scope="row">Telephone</th><td>Not available in the prototype</td></tr>
          <tr><th scope="row">Working hours</th><td>Not applicable</td></tr>
        </tbody>
      </table>
    </Page>
  );
}

export function TermsPage() {
  return (
    <Page title="Terms of use">
      <p>This portal is a prototype built for the Smart India Hackathon 2026 (problem SIH26265). It is provided for demonstration and evaluation only.</p>
      <p>No information on this portal creates any right, obligation or liability. Do not enter real personal, financial or institutional information.</p>
      <p>Final terms of use would be issued by the owning organisation before any production use.</p>
    </Page>
  );
}

export function PrivacyPage() {
  return (
    <Page title="Privacy policy">
      <p>The prototype holds only synthetic data. It stores the sign-in session token in the browser and, if changed, the chosen text size and contrast setting.</p>
      <p>No analytics or third-party tracking is used. Server logs record requests without access tokens.</p>
      <p>A production privacy policy would be issued by the owning organisation.</p>
    </Page>
  );
}

export function AccessibilityPage() {
  return (
    <Page title="Accessibility statement">
      <p>The portal aims to follow the Guidelines for Indian Government Websites (GIGW 3.0) and WCAG 2.1 level AA.</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>A "Skip to main content" link is the first item on every page.</li>
        <li>Text size can be changed with A-, A and A+; a high-contrast mode is available in the top bar.</li>
        <li>Every menu, dropdown, tab and dialog can be used with the keyboard, and focus is always visible.</li>
        <li>Status and trust are shown with an icon and text, never by colour alone.</li>
        <li>Charts are accompanied by a table or text with the same values.</li>
        <li>Animations are switched off when the operating system asks for reduced motion.</li>
      </ul>
      <p>Known limitations: some pages still use the earlier table and form styles and are being migrated. Report accessibility problems through the helpdesk page.</p>
    </Page>
  );
}

export function DisclaimerPage() {
  return (
    <Page title="Disclaimer">
      <p>This is not an official AICTE website. It is a prototype built for the Smart India Hackathon 2026 (SIH26265).</p>
      <p>All institutions, deposits, banks' responses, users and amounts shown are synthetic. Any resemblance to real records is coincidental.</p>
      <p>The crest shown in the header is a neutral design mark and is not a national emblem or the logo of any organisation.</p>
    </Page>
  );
}

const ROLES: [string, string][] = [
  ['Institution', 'Lodges each fixed deposit receipt or security deposit, uploads its documents, renews it before it matures and asks for its release.'],
  ['Scrutiny officer', 'Checks every deposit with the issuing bank and against its documents, records what does not match and recommends releases.'],
  ['Approver', 'The competent authority. Decides every release and receives matters that have waited too long.'],
  ['Admin', 'Manages users, the rules the portal follows (reminder dates, required documents, release conditions) and the app clock.'],
  ['Auditor', 'Reads everything and changes nothing: the audit trail, its integrity check, reports and the dashboard.'],
];

const TIERS: [string, string][] = [
  ['Claimed by institution', 'Only the institution has stated this value. Nobody has checked it yet.'],
  ['Document-checked', 'An officer has compared the value with the uploaded document and it matches.'],
  ['Bank-confirmed', 'The issuing bank has confirmed the value. This is the strongest proof.'],
];

/** /help/about: one screen on roles, trust tiers, the audit chain and the release order. */
export function AboutPage() {
  const section = 'mt-6 first:mt-0';
  return (
    <Page title="How the portal works" note={false}>
      <p>
        Institutions give AICTE fixed deposits and security deposits as guarantees. The portal keeps each one on record, shows how much
        of it has been proven, warns before it matures and takes it through to release. Officials make every decision; the portal never
        approves anything on its own.
      </p>
      <section className={section} aria-labelledby="about-roles">
        <h2 id="about-roles" className="text-lg font-bold">Who does what</h2>
        <dl className="mt-2 space-y-2">
          {ROLES.map(([r, d]) => <div key={r}><dt className="inline font-semibold">{r}: </dt><dd className="inline">{d}</dd></div>)}
        </dl>
      </section>
      <section className={section} aria-labelledby="about-trust">
        <h2 id="about-trust" className="text-lg font-bold">Three levels of proof</h2>
        <p className="mt-2">Every particular of a deposit (amount, dates, bank, beneficiary, lien) carries one of three labels:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-6">
          {TIERS.map(([t, d]) => <li key={t}><strong>{t}.</strong> {d}</li>)}
        </ol>
        <p className="mt-2">When the bank and the institution disagree, the record shows both values until an officer resolves the difference.</p>
      </section>
      <section className={section} aria-labelledby="about-audit">
        <h2 id="about-audit" className="text-lg font-bold">A record that cannot be quietly changed</h2>
        <p className="mt-2">
          Every action is written to the audit trail with who did it and when. Each entry is sealed together with the entry before it,
          like links in a chain, so if anyone alters an old entry the chain no longer matches. The auditor can run the integrity check
          at any time and see exactly where it breaks.
        </p>
      </section>
      <section className={section} aria-labelledby="about-release">
        <h2 id="about-release" className="text-lg font-bold">Release, in order</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-6">
          <li>The institution asks for the deposit to be released.</li>
          <li>An officer checks the release conditions and recommends a decision.</li>
          <li>The approver decides. Large amounts may need more than one approver.</li>
          <li>The portal issues a release order with a QR code. Anyone, such as the bank, can scan it to confirm the order is genuine.</li>
        </ol>
      </section>
    </Page>
  );
}
