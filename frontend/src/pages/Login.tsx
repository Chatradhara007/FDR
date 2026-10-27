import { useQuery } from '@tanstack/react-query';
import { FlaskConical, LogIn } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { DemoUser, SessionUser } from '@fdr/shared';
import { ApiError, apiFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { clearSignOutReason, getSignOutReason } from '@/auth/token';
import { Button, FormField, Notice } from '@/components';
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
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16 lg:py-6">
      <Intro />
      <div className="space-y-6">
        {reason && <Notice role="status">{reason}</Notice>}
        <section className="rounded-xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="font-serif text-2xl font-semibold text-slate-900">Sign in</h2>
          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
            {formError && <Notice kind="error" role="alert">{formError}</Notice>}
            <FormField id="email" label="E-mail address" required error={fieldErrors.email}>
              <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldErrors.email} aria-describedby="email-error" className="gov-input" />
            </FormField>
            <FormField id="password" label="Password" required error={fieldErrors.password}>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!fieldErrors.password} aria-describedby="password-error" className="gov-input" />
            </FormField>
            <Button type="submit" className="w-full" loading={pending === 'form'} disabled={!!pending} icon={<LogIn className="size-4" aria-hidden />}>
              Sign in
            </Button>
          </form>
        </section>
        {quick.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-slate-900">Demo accounts (synthetic data)</h2>
            <p className="mt-1 mb-3 flex items-start gap-1.5 text-sm text-slate-600">
              <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />
              One click signs in. No real institutions or deposits are shown.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
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
    </div>
  );
}

const STEPS = [
  { title: 'Lodge', text: 'Institutions enter the deposit as printed on the receipt and upload the documents.' },
  { title: 'Verify', text: 'An AICTE officer checks it with the issuing bank and accepts it, or returns it with remarks.' },
  { title: 'Watch and release', text: 'The portal tracks maturity and renewals. An official decides every release.' },
];

function Intro() {
  return (
    <div className="max-w-xl">
      <h1 className="font-serif text-4xl leading-tight font-semibold text-slate-900">Security deposits and FDRs, in one ledger.</h1>
      <p className="mt-4 text-lg text-slate-600">Sign in with the account issued to you.</p>
      <ol className="mt-10 space-y-6">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-[#d6d0c4] font-serif text-ink">{i + 1}</span>
            <div>
              <p className="font-medium text-slate-900">{s.title}</p>
              <p className="text-slate-600">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-sm text-slate-600">
        Need help? See the <Link className="gov-link" to="/help/faq">FAQ</Link> or <Link className="gov-link" to="/help/contact">contact the helpdesk</Link>.
      </p>
    </div>
  );
}
