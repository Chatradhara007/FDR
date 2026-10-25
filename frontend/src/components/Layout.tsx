import { Landmark, LogOut } from 'lucide-react';
import { ROLE_LABELS } from '@fdr/shared';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { cn } from '@/lib/cn';
import { NAV } from '@/lib/nav';
import { AlertBell } from './AlertBell';
import { Badge } from './Badge';
import { Button } from './Button';
import { ClockBadge, ClockControls } from './ClockBadge';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = user ? NAV[user.role] : [];
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-primary-900 text-primary-100 md:flex">
        <div className="flex items-center gap-2 px-5 py-4 text-white">
          <Landmark className="size-5" aria-hidden />
          <div className="leading-tight">
            <p className="text-sm font-semibold">FDR Portal — AICTE</p>
            <p className="text-xs text-primary-200">Security deposits</p>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 px-2 py-2">
          <ul className="space-y-0.5">
            {items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) =>
                    cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm', isActive ? 'bg-primary-700 text-white' : 'hover:bg-primary-800 hover:text-white')
                  }
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-surface px-6 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-slate-700 md:hidden">FDR Portal — AICTE</p>
            <ClockBadge />
            {user?.role === 'admin' && <ClockControls />}
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <AlertBell />
              <div className="text-right leading-tight">
                <p className="text-sm font-medium text-slate-800" data-testid="user-name">{user.name}</p>
                {user.institutionName && <p className="text-xs text-slate-500">{user.institutionName}</p>}
              </div>
              <Badge tone="primary">{ROLE_LABELS[user.role]}</Badge>
              <Button
                size="sm"
                variant="ghost"
                icon={<LogOut className="size-4" aria-hidden />}
                onClick={() => {
                  logout();
                  navigate('/login', { replace: true });
                }}
              >
                Sign out
              </Button>
            </div>
          )}
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
