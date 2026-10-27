import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { NavItem } from '@/lib/nav';

type Option = { key: string; label: string; hint?: string; go: string };

/** Ctrl+K: jump to any page in the menu, or look up a Ref. No. in the register. */
export function CommandPalette({ open, onClose, links, canSearchRegister }: { open: boolean; onClose: () => void; links: (NavItem & { group?: string })[]; canSearchRegister: boolean }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    setQ(''); setIndex(0);
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => input.current?.focus());
    return () => previous?.focus();
  }, [open]);

  const options = useMemo<Option[]>(() => {
    const term = q.trim().toLowerCase();
    const pages = links
      .filter((l) => !term || `${l.group ?? ''} ${l.label}`.toLowerCase().includes(term))
      .map((l) => ({ key: l.to, label: l.label, hint: l.group, go: l.to }));
    const ref = canSearchRegister && term ? [{ key: 'ref', label: `Search the register for “${q.trim()}”`, hint: 'Ref. No. / institution', go: `/register?q=${encodeURIComponent(q.trim())}` }] : [];
    return [...pages, ...ref];
  }, [q, links, canSearchRegister]);

  if (!open) return null;
  const choose = (o: Option | undefined) => { if (!o) return; onClose(); navigate(o.go); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(options[index]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-24" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search the portal" className="fade-in w-full max-w-xl border border-line bg-white">
        <div className="flex items-center gap-2 border-b border-line bg-strip px-3">
          <Search className="size-4 text-navy" aria-hidden />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIndex(0); }} onKeyDown={onKey}
            role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={options[index] ? `${listId}-${index}` : undefined}
            placeholder="Type a page name or a Ref. No." aria-label="Search" className="h-11 flex-1 bg-transparent text-sm outline-none" />
          <kbd className="border border-slate-400 px-1 text-xs">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" className="max-h-80 overflow-y-auto py-1">
          {options.map((o, i) => (
            <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === index}
              onMouseEnter={() => setIndex(i)} onClick={() => choose(o)}
              className={cn('flex cursor-pointer items-center justify-between border-l-4 px-3 py-2 text-sm', i === index ? 'border-saffron bg-primary-50 text-navy' : 'border-transparent text-slate-800')}>
              <span className="font-semibold">{o.label}</span>
              {o.hint && <span className="text-xs text-slate-600">{o.hint}</span>}
            </li>
          ))}
          {options.length === 0 && <li className="px-3 py-3 text-sm text-slate-700">No matching page.</li>}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
