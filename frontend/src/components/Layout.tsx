import { Landmark } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { NAV } from '@/lib/nav';

export function Layout() {
  // Role comes from the session once login exists (Phase 1).
  const items = NAV.anonymous;
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-primary-900 text-primary-100 md:flex">
        <div className="flex items-center gap-2 px-5 py-4 text-white">
          <Landmark className="size-5" aria-hidden />
          <div className="leading-tight">
            <p className="text-sm font-semibold">FDR Portal</p>
            <p className="text-xs text-primary-200">AICTE · Security deposits</p>
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
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-surface px-6">
          <p className="text-sm font-medium text-slate-700">Security Deposit / FDR Management</p>
          <p className="text-xs text-slate-500">Not signed in</p>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
