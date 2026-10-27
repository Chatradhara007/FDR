import { useQuery } from '@tanstack/react-query';
import { FlaskConical, LogIn } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { DOC_TYPE_LABELS, INSTRUMENT_TYPES, INSTRUMENT_TYPE_LABELS, type DemoUser, type DocType, type SessionUser } from '@fdr/shared';
import constants from '../../../shared/constants.json';
import { ApiError, apiFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { clearSignOutReason, getSignOutReason } from '@/auth/token';
import { Button, ButtonBar, FormField, MandatoryNote, Notice, Panel } from '@/components';
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
  useEffect(clearSignOutReason, []);

  // 404 when DEMO_MODE is off: the quick buttons simply don't render.
  const demoUsers = useQuery({ queryKey: ['demo-users'], queryFn: () => apiFetch<DemoUser[]>('/demo/users'), retry: false, staleTime: Infinity });

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

  const quick = QUICK.map((q) => ({ ...q, user: demoUsers.data?.find((d) => d.email === q.email) })).filter((q) => q.user);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Instructions />
      <div className="space-y-4">
        {reason && <Notice role="status">{reason}</Notice>}
        <Panel title="Sign in">
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {formError && <Notice kind="error" role="alert">{formError}</Notice>}
            <MandatoryNote />
            <FormField id="email" label="E-mail address" required error={fieldErrors.email}>
              <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldErrors.email} aria-describedby="email-error" className="gov-input" />
            </FormField>
            <FormField id="password" label="Password" required error={fieldErrors.password}>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!fieldErrors.password} aria-describedby="password-error" className="gov-input" />
            </FormField>
            <ButtonBar>
              <Button type="submit" loading={pending === 'form'} disabled={!!pending} icon={<LogIn className="size-4" aria-hidden />}>
                Sign in
              </Button>
              <Button type="reset" variant="secondary" disabled={!!pending} onClick={() => { setEmail(''); setPassword(''); setFieldErrors({}); setFormError(null); }}>
                Reset
              </Button>
            </ButtonBar>
          </form>
        </Panel>
        {quick.length > 0 && (
          <Panel title="Demo accounts (synthetic data)">
            <p className="mb-3 text-sm text-slate-700">
              <FlaskConical className="mr-1 inline size-4 align-text-bottom text-warning-700" aria-hidden />
              These accounts exist only in the demonstration dataset. No real institutions or deposits are shown.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
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
          </Panel>
        )}
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
    <Panel title="Notices / Instructions for users">
      <div className="space-y-4 text-[0.9375rem] text-slate-800">
        <section>
          <h3 className="mb-1 font-bold text-navy">1. Lodging a Fixed Deposit Receipt (institutions)</h3>
          <ol className="list-decimal space-y-1 pl-6">
            <li>Sign in with the account issued to your institution.</li>
            <li>Under <strong>My institution</strong>, choose to add a new instrument.</li>
            <li>Enter the particulars exactly as printed on the receipt: Ref. No., issuing bank and branch, amount, date of issue, date of maturity and beneficiary.</li>
            <li>Upload the required documents (below) and submit the record for scrutiny.</li>
            <li>Track the status on the instrument page. If AICTE returns the record, correct it as advised in the remarks and resubmit.</li>
          </ol>
        </section>
        <section>
          <h3 className="mb-1 font-bold text-navy">2. Documents required</h3>
          <table className="gov-table">
            <thead><tr><th scope="col" className="w-20 text-right!">Sl. No.</th><th scope="col">Type of instrument</th><th scope="col">Documents to be uploaded</th></tr></thead>
            <tbody>
              {requiredDocs().map((r, i) => (
                <tr key={r.type}><td className="num">{i + 1}</td><td>{r.type}</td><td>{r.docs.join(', ') || '—'}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-700">Default list. The administrator may change it; the submission form always shows the documents currently required. Files: PDF, JPEG or PNG, up to 10 MB each.</p>
        </section>
        <section>
          <h3 className="mb-1 font-bold text-navy">3. Whom to contact</h3>
          <p>For sign-in problems or questions about a record, use <Link className="gov-link" to="/help/contact">Contact helpdesk</Link>. See also the <Link className="gov-link" to="/help/faq">FAQ</Link>.</p>
        </section>
        <Notice>The portal supports officials in their work; every acceptance and release is decided by an official.</Notice>
      </div>
    </Panel>
  );
}
