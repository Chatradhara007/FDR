import { useQuery } from '@tanstack/react-query';
import { FlaskConical, LogIn } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { DOC_TYPE_LABELS, INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS, type DemoUser, type DocType, type SessionUser } from '@fdr/shared';
import constants from '../../../shared/constants.json';
import { ApiError, apiFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { clearSignOutReason, getSignOutReason } from '@/auth/token';
import { Button, FormField, MandatoryNote, Notice } from '@/components';
import { useShowcaseState } from '@/hooks/useShowcase';
import { ROLE_HOME } from '@/lib/roles';

// Demo mode quick sign-in (D17). The seed gives every demo user this password.
const DEMO_PASSWORD = 'Demo@123';
const QUICK: { email: string; label: string }[] = [
  { email: 'inst1@demo.in', label: 'Institution 1' },
  { email: 'inst2@demo.in', label: 'Institution 2' },
  { email: 'officer@demo.in', label: 'Officer' },
  { email: 'officer2@demo.in', label: 'Officer 2' },
  { email: 'approver@demo.in', label: 'Approver' },
  { email: 'approver2@demo.in', label: 'Approver 2' },
  { email: 'admin@demo.in', label: 'Admin' },
  { email: 'auditor@demo.in', label: 'Auditor' },
];

/** Showcase mode: one sample account per role; a click fills the form, the user presses Sign in. */
const ROLE_PICKER: { email: string; label: string; does: string }[] = [
  { email: 'inst1@demo.in', label: 'Institution', does: 'Lodges deposits and requests release' },
  { email: 'officer@demo.in', label: 'Scrutiny officer', does: 'Verifies deposits with the bank' },
  { email: 'approver@demo.in', label: 'Approver', does: 'Decides releases' },
  { email: 'admin@demo.in', label: 'Admin', does: 'Users, rules and the app clock' },
  { email: 'auditor@demo.in', label: 'Auditor', does: 'Reads the audit trail and reports' },
];

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Shown once: read on mount, cleared after (an initializer may run twice in StrictMode).
  const [reason] = useState(getSignOutReason);
  const { showcase, known } = useShowcaseState();
  useEffect(clearSignOutReason, []);

  // 404 when DEMO_MODE is off: the quick buttons simply don't render.
  // Not asked in showcase mode (403 there): the role picker below replaces them.
  const demoUsers = useQuery({ queryKey: ['demo-users'], queryFn: () => apiFetch<DemoUser[]>('/demo/users'), retry: false, staleTime: Infinity,
    enabled: known && !showcase });

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  const signIn = async (e: string, p: string, key: string) => {
    setPending(key);
    setFieldErrors({});
    setFormError(null);
    try {
      const u: SessionUser = await login(e, p);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith(ROLE_HOME[u.role]) ? from : ROLE_HOME[u.role], { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setFieldErrors(err.fieldErrors());
      else setFormError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setPending(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(email, password, 'form');
  };

  const pick = (email: string) => {
    setEmail(email);
    setPassword(DEMO_PASSWORD);
    setFieldErrors({});
    setFormError(null);
    document.getElementById('sign-in')?.focus();
  };

  const quick = showcase ? [] : QUICK.map((q) => ({ ...q, user: demoUsers.data?.find((d) => d.email === q.email) })).filter((q) => q.user);

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-7">
        <h1 className="text-[2rem] leading-tight font-bold tracking-[-0.02em]">Sign in to the FDR Portal</h1>
        <p className="mt-2 text-[1.0625rem] text-muted">
          {showcase
            ? 'Institutions lodge fixed deposits and security deposits held by AICTE; officials verify them with the bank, track maturity and authorise release.'
            : 'Lodge, verify and release fixed deposits and security deposits held by AICTE.'}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-[22px]">
        <div className="min-w-0 flex-[1_1_420px] space-y-[22px] lg:max-w-[520px]">
          {reason && <Notice role="status">{reason}</Notice>}
          {showcase && (
            <section data-testid="role-picker" className="rounded-[14px] border border-border bg-white p-[26px]">
              <h2 className="text-lg font-bold">Sign in as</h2>
              <p className="mt-1.5 mb-4 text-sm text-muted">Choose a role to fill in its sample account, then press Sign in.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ROLE_PICKER.map((r) => (
                  <button key={r.email} type="button" onClick={() => pick(r.email)} aria-pressed={email === r.email}
                    aria-label={`Sign in as ${r.label}: fill in the sample account`}
                    className="rounded-[10px] border border-border px-3.5 py-2.5 text-left hover:border-slate-400 hover:bg-subtle aria-pressed:border-teal aria-pressed:bg-teal-tint">
                    <span className="block text-[0.9375rem] font-semibold text-ink">{r.label}</span>
                    <span className="block text-[0.8125rem] text-muted">{r.does}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="rounded-[14px] border border-border bg-white p-[26px]">
            <h2 className="text-lg font-bold">Your account</h2>
            <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
              {formError && <Notice kind="error" role="alert">{formError}</Notice>}
              <FormField id="email" label="E-mail address" required error={fieldErrors.email}>
                <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!fieldErrors.email} aria-describedby="email-error" className="gov-input" />
              </FormField>
              <FormField id="password" label="Password" required error={fieldErrors.password}>
                <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!fieldErrors.password} aria-describedby="password-error" className="gov-input" />
              </FormField>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button id="sign-in" type="submit" size="lg" loading={pending === 'form'} disabled={!!pending} icon={<LogIn className="size-4" aria-hidden />}>
                  Sign in
                </Button>
                <Button type="reset" variant="secondary" disabled={!!pending} onClick={() => { setEmail(''); setPassword(''); setFieldErrors({}); setFormError(null); }}>
                  Reset
                </Button>
              </div>
              <MandatoryNote />
            </form>
          </section>
          {quick.length > 0 && (
            <section className="rounded-[14px] border border-border bg-white p-[26px]">
              <h2 className="text-lg font-bold">Demo accounts (synthetic data)</h2>
              <p className="mt-1.5 mb-4 text-sm text-muted">
                <FlaskConical className="mr-1 inline size-4 align-text-bottom text-attn" aria-hidden />
                One click signs you in. These accounts exist only in the demonstration dataset.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {quick.map((q) => (
                  <Button
                    key={q.email}
                    variant="secondary"
                    size="sm"
                    title={`${q.user!.name}${q.user!.institutionName ? ` · ${q.user!.institutionName}` : ''}`}
                    loading={pending === q.email}
                    disabled={!!pending}
                    onClick={() => void signIn(q.email, DEMO_PASSWORD, q.email)}
                  >
                    {q.label}
                  </Button>
                ))}
              </div>
            </section>
          )}
        </div>
        <Instructions />
      </div>
    </div>
  );
}

/** Required documents per instrument type, from the rule defaults in shared/constants.json (an administrator may change the live rule). */
function requiredDocs(): { type: string; docs: string[] }[] {
  const rule = (constants.ruleDefaults as { key: string; config: unknown }[]).find((r) => r.key === 'required_docs');
  const config = (rule?.config ?? {}) as Record<string, DocType[]>;
  return INSTRUMENT_TYPES.map((t) => ({ type: INSTRUMENT_TYPE_LABELS[t], docs: (config[t] ?? []).map((d) => DOC_TYPE_LABELS[d] ?? d) }));
}

function Instructions() {
  return (
    <section className="min-w-0 flex-[2_1_480px] rounded-[14px] border border-border bg-white p-[26px] text-[0.9375rem]">
      <h2 className="text-lg font-bold">What this portal does</h2>
      <ol className="mt-4 space-y-3">
        {[
          ['Institutions lodge a deposit', 'Enter the particulars exactly as printed on the receipt and upload the documents below.'],
          ['An AICTE officer checks it with the bank', 'Each field shows how much is proven: bank-confirmed, document-checked or only claimed.'],
          ['The portal watches maturity', 'Reminders go out before a deposit matures; overdue items are escalated.'],
          ['Officials decide every release', 'An officer recommends, the competent authority approves, and a release order with a QR code is issued.'],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-chip text-[13px] font-bold text-ink-2">{i + 1}</span>
            <span><strong className="block">{t}</strong><span className="text-muted">{d}</span></span>
          </li>
        ))}
      </ol>
      <h3 className="kicker mt-7 mb-1 text-muted">Documents required</h3>
      <table className="gov-table">
        <thead><tr><th scope="col">Type of deposit</th><th scope="col">Documents to upload</th></tr></thead>
        <tbody>
          {requiredDocs().map((r) => (
            <tr key={r.type}><td className="font-semibold">{r.type}</td><td>{r.docs.join(', ') || '—'}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[0.8125rem] text-muted">Default list; the submission form always shows what is currently required. PDF, JPEG or PNG, up to 10 MB each.</p>
      <p className="mt-4 text-sm">Problems signing in? <Link className="gov-link" to="/help/contact">Contact the helpdesk</Link> or read the <Link className="gov-link" to="/help/faq">FAQ</Link>.</p>
    </section>
  );
}
