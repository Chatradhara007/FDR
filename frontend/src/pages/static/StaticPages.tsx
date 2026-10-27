import type { ReactNode } from 'react';
import { PageHeader } from '@/components';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-[44rem]">
      <PageHeader title={title} />
      <div className="space-y-4 text-[1.0625rem] leading-[1.75] text-slate-800 [&_h2]:mt-8 [&_h2]:[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6">{children}</div>
      <p className="mt-10 border-t border-line pt-4 text-sm text-slate-600">This page belongs to a hackathon prototype. Its text is a placeholder and is not an official policy of any organisation.</p>
    </article>
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
      <dl className="divide-y divide-line">
        {FAQ.map((f, i) => (
          <div key={f.q} className="py-5 first:pt-0">
            <dt className="font-semibold text-slate-900">{f.q}</dt>
            <dd className="mt-1.5 text-slate-700">{f.a}</dd>
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
