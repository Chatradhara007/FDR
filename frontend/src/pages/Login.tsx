import { useQuery } from '@tanstack/react-query';
import { AlertCircle, FlaskConical, Info, Landmark, LogIn } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { DemoUser, SessionUser } from '@fdr/shared';
import { ApiError, apiFetch } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { clearSignOutReason, getSignOutReason } from '@/auth/token';
import { Button, Card, FieldError } from '@/components';
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

const inputCls = 'h-9 w-full rounded-md border border-slate-300 px-3 text-sm aria-[invalid=true]:border-danger-600';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <Landmark className="size-9 text-primary-700" aria-hidden />
          <h1 className="text-xl font-semibold text-slate-900">FDR Portal — AICTE</h1>
          <p className="text-sm text-slate-600">
            Lodge, verify, track and release the fixed deposits and security deposits institutions keep with AICTE.
          </p>
          {quick.length > 0 && (
            <p className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              <FlaskConical className="size-3.5" aria-hidden /> Synthetic demo data — no real institutions or deposits
            </p>
          )}
        </div>
        {reason && (
          <p role="status" className="flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-800">
            <Info className="size-4 shrink-0" aria-hidden />
            {reason}
          </p>
        )}
        <Card>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {formError && (
              <p role="alert" className="flex items-center gap-2 rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                <AlertCircle className="size-4 shrink-0" aria-hidden />
                {formError}
              </p>
            )}
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldErrors.email} aria-describedby="email-error" className={inputCls} />
              <FieldError id="email-error" message={fieldErrors.email} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!fieldErrors.password} aria-describedby="password-error" className={inputCls} />
              <FieldError id="password-error" message={fieldErrors.password} />
            </div>
            <Button type="submit" className="w-full" loading={pending === 'form'} disabled={!!pending} icon={<LogIn className="size-4" aria-hidden />}>
              Sign in
            </Button>
          </form>
        </Card>
        {quick.length > 0 && (
          <Card title="Demo mode — sign in as">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
          </Card>
        )}
      </div>
    </div>
  );
}
