import { ChevronDown, Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { MenuEntry, NavItem } from '@/lib/nav';

const itemCls = 'relative flex h-11 items-center gap-1 whitespace-nowrap rounded-lg px-3 text-[0.9375rem] font-medium text-slate-700 hover:bg-strip hover:text-slate-900 xl:h-9';
/** Ink underline on the active entry, plus aria-current (never colour alone). */
const activeCls = 'text-ink after:absolute after:inset-x-3 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-ink max-xl:bg-strip max-xl:after:hidden';

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
        <ul id={id} className="z-40 min-w-56 py-1 xl:absolute xl:top-full xl:left-0 xl:mt-2 xl:rounded-xl xl:border xl:border-line xl:bg-white xl:p-1.5 xl:shadow-md">
          {items.map((item, i) => (
            <li key={item.to}>
              <NavLink to={item.to} end ref={(el) => { links.current[i] = el; }} onKeyDown={(e) => onItemKey(e, i)}
                onClick={() => { setOpen(false); onNavigate(); }}
                className={({ isActive: a }) => cn('block rounded-lg px-3 py-2 max-xl:pl-6', a ? 'bg-primary-50 font-medium text-ink' : 'text-slate-700 hover:bg-strip focus-visible:bg-strip')}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Role-aware menu inside the top bar; below 1280 px a "Menu" button opens it as a panel under the bar. */
export function MenuBar({ entries }: { entries: MenuEntry[] }) {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);
  return (
    <nav aria-label="Main" className="min-w-0 print:hidden" data-testid="menu-bar">
      <button type="button" className={cn(itemCls, 'xl:hidden')} aria-expanded={mobileOpen} aria-controls="main-menu"
        onClick={() => setMobileOpen((o) => !o)}>
        {mobileOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />} Menu
      </button>
      <ul id="main-menu" data-testid="menu-list"
        className={cn(
          'max-xl:absolute max-xl:inset-x-0 max-xl:top-full max-xl:z-40 max-xl:flex-col max-xl:gap-0.5 max-xl:border-b max-xl:border-line max-xl:bg-white max-xl:px-4 max-xl:py-3 max-xl:shadow-md',
          'xl:flex xl:flex-row xl:flex-nowrap xl:items-center xl:gap-0.5',
          mobileOpen ? 'flex' : 'hidden',
        )}>
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
    </nav>
  );
}
