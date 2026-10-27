import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { MenuEntry, NavItem } from '@/lib/nav';

/** Pill: muted text; active = ink background, white text, bold (plus aria-current, never colour alone). */
const pill = 'flex h-9 w-full items-center gap-1 rounded-[8px] px-3.5 text-[0.90625rem] whitespace-nowrap lg:w-auto';
const idle = 'text-muted hover:bg-chip hover:text-ink';
const active = 'bg-ink font-semibold text-white';

function Group({ label, items, path, onNavigate }: { label: string; items: NavItem[]; path: string; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const isActive = items.some((i) => path === i.to);

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
        className={cn(pill, isActive ? active : idle)}>
        {label}
        <ChevronDown className={cn('size-4', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul id={id} className="z-40 mt-1 min-w-52 rounded-[10px] border border-border bg-white p-1 lg:absolute lg:top-full lg:left-0 lg:shadow-lg">
          {items.map((item, i) => (
            <li key={item.to}>
              <NavLink to={item.to} end ref={(el) => { links.current[i] = el; }} onKeyDown={(e) => onItemKey(e, i)}
                onClick={() => { setOpen(false); onNavigate(); }}
                className={({ isActive: a }) => cn('block rounded-[8px] px-3 py-2 text-sm', a ? 'bg-teal-tint font-semibold text-ink' : 'text-ink hover:bg-subtle focus-visible:bg-subtle')}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Role-aware nav pills with small dropdown groups. Below 1024 px the list opens from the header's "Menu" button. */
export function NavPills({ entries, mobileOpen, onNavigate }: { entries: MenuEntry[]; mobileOpen: boolean; onNavigate: () => void }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" data-testid="menu-bar"
      className={cn('print:hidden lg:block', mobileOpen ? 'order-last block w-full basis-full border-t border-hairline py-2' : 'hidden')}>
      <ul id="main-menu" data-testid="menu-list" className="flex flex-col gap-1 lg:flex-row lg:flex-nowrap lg:items-center lg:gap-1.5">
        {entries.map((e) =>
          e.kind === 'link' ? (
            <li key={e.item.to}>
              <NavLink to={e.item.to} end onClick={onNavigate} className={({ isActive: a }) => cn(pill, a ? active : idle)}>{e.item.label}</NavLink>
            </li>
          ) : (
            <Group key={e.label} label={e.label} items={e.items} path={pathname} onNavigate={onNavigate} />
          ),
        )}
      </ul>
    </nav>
  );
}
