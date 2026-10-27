import { ChevronDown, Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { MenuEntry, NavItem } from '@/lib/nav';

const itemCls = 'relative flex h-11 items-center gap-1 whitespace-nowrap px-4 text-[0.9375rem] font-semibold text-white hover:bg-primary-600 focus-visible:bg-primary-600';
/** Saffron underline on the active entry (plus aria-current; never colour alone: it is also bold and underlined). */
const activeCls = 'after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:bg-saffron bg-primary-800';

function isActive(path: string, item: NavItem) {
  return path === item.to;
}

function Group({ label, items, path, onNavigate }: { label: string; items: NavItem[]; path: string; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const active = items.some((i) => isActive(path, i));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const focusItem = (i: number) => links.current[(i + items.length) % items.length]?.focus();
  /** Item to focus once the list has rendered (opened from the keyboard). */
  const pendingFocus = useRef<number | null>(null);
  useEffect(() => {
    if (open && pendingFocus.current !== null) { focusItem(pendingFocus.current); pendingFocus.current = null; }
  });

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pendingFocus.current = 0;
      if (open) focusItem(0); else setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      pendingFocus.current = items.length - 1;
      if (open) focusItem(items.length - 1); else setOpen(true);
    } else if (e.key === 'Escape') setOpen(false);
  };
  const onItemKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(items.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); button.current?.focus(); }
  };

  return (
    <li ref={root} className="relative" onBlur={(e) => { if (!root.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button ref={button} type="button" aria-expanded={open} aria-haspopup="true" aria-controls={id}
        onClick={() => setOpen((o) => !o)} onKeyDown={onButtonKey}
        className={cn(itemCls, 'w-full', active && activeCls)}>
        {label}
        <ChevronDown className={cn('size-4', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul id={id} className="z-40 min-w-56 border border-line bg-white py-1 lg:absolute lg:top-full lg:left-0">
          {items.map((item, i) => (
            <li key={item.to}>
              <NavLink to={item.to} end ref={(el) => { links.current[i] = el; }} onKeyDown={(e) => onItemKey(e, i)}
                onClick={() => { setOpen(false); onNavigate(); }}
                className={({ isActive: a }) => cn('block border-l-4 px-4 py-2 text-sm', a ? 'border-saffron bg-primary-50 font-bold text-navy' : 'border-transparent text-navy hover:bg-primary-50 focus-visible:bg-primary-50')}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Full-width deep-navy menu bar with role-aware items and dropdown groups; a hamburger below 1024 px. */
export function MenuBar({ entries }: { entries: MenuEntry[] }) {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);
  return (
    <nav aria-label="Main" className="bg-navy print:hidden" data-testid="menu-bar">
      <div className="mx-auto max-w-[1600px] px-0 sm:px-2 lg:px-4">
        <button type="button" className={cn(itemCls, 'lg:hidden')} aria-expanded={mobileOpen} aria-controls="main-menu"
          onClick={() => setMobileOpen((o) => !o)}>
          {mobileOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />} Menu
        </button>
        <ul id="main-menu" data-testid="menu-list"
          className={cn('flex-col lg:flex lg:flex-row lg:flex-nowrap lg:items-stretch', mobileOpen ? 'flex' : 'hidden')}>
          {entries.map((e) =>
            e.kind === 'link' ? (
              <li key={e.item.to}>
                <NavLink to={e.item.to} end className={({ isActive: a }) => cn(itemCls, a && activeCls)}>{e.item.label}</NavLink>
              </li>
            ) : (
              <Group key={e.label} label={e.label} items={e.items} path={pathname} onNavigate={() => setMobileOpen(false)} />
            ),
          )}
        </ul>
      </div>
    </nav>
  );
}
