import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { KeyLegend, QueueRow, type Reason } from '@/components';
import { cn } from '@/lib/cn';

export interface DeskItem {
  key: string;
  title: string;
  reference: ReactNode;
  amount: ReactNode;
  reasons: Reason[];
  score: ReactNode;
}

export interface DeskTab<T> { id: string; label: string; filter: (item: T) => boolean }

/** Keys the desk reacts to; each gets the selected item. */
export type DeskKeys<T> = Partial<Record<'r' | 'b' | 'o' | 'a', (item: T) => void>>;

/** True while typing or while a dialog is open: shortcut keys must not fire then. */
function keysBlocked(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return true;
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

/** The officer/approver desk: ranked queue on the left (tabs, rows, key legend), the selected item on the right.
 *  J/K move the selection; the other keys come from the page. */
export function Desk<T>({ items, toRow, tabs, keys, legend, panel, empty, rowTestId, queueLabel }: {
  items: T[] | undefined;
  toRow: (item: T) => DeskItem;
  tabs: DeskTab<T>[];
  keys: DeskKeys<T>;
  legend: { k: string[]; label: string }[];
  panel: (item: T, rank: number) => ReactNode;
  empty: ReactNode;
  rowTestId?: string;
  queueLabel: string;
}) {
  const [tab, setTab] = useState(tabs[0]?.id ?? '');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const listId = useId();
  const filter = tabs.find((t) => t.id === tab)?.filter ?? (() => true);
  const visible = useMemo(() => (items ?? []).filter(filter), [items, filter]);
  const index = Math.max(0, visible.findIndex((i) => toRow(i).key === selectedKey));
  const selected = visible[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keysBlocked(e) || !visible.length) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const next = visible[Math.min(visible.length - 1, Math.max(0, index + (k === 'j' ? 1 : -1)))];
        const nextKey = toRow(next).key;
        setSelectedKey(nextKey);
        document.getElementById(`${listId}-${nextKey}`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      const run = keys[k as keyof DeskKeys<T>];
      if (run && selected) { e.preventDefault(); run(selected); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, index, selected, keys, toRow, listId]);

  return (
    <div className="mt-[22px] flex flex-wrap items-start gap-[22px]">
      <section aria-label={queueLabel} className="min-w-0 flex-[1_1_420px] overflow-hidden rounded-[14px] border border-border bg-white lg:max-w-[520px]">
        <div role="tablist" aria-label="Filter the queue" className="flex flex-wrap gap-1 border-b border-hairline bg-subtle p-2.5">
          {tabs.map((t) => {
            const n = (items ?? []).filter(t.filter).length;
            const on = t.id === tab;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => { setTab(t.id); setSelectedKey(null); }}
                className={cn('rounded-[8px] border px-3 py-1.5 text-[0.84375rem]', on ? 'border-border bg-white font-semibold' : 'border-transparent text-muted hover:text-ink')}>
                {t.label} · {n}
              </button>
            );
          })}
        </div>
        {items === undefined && <p className="p-4 text-sm text-muted">Loading…</p>}
        {items !== undefined && visible.length === 0 && <div className="p-6">{empty}</div>}
        <ul role="listbox" aria-label={queueLabel} aria-activedescendant={selected ? `${listId}-${toRow(selected).key}` : undefined}>
          {visible.map((item, i) => {
            const row = toRow(item);
            return (
              <QueueRow key={row.key} id={`${listId}-${row.key}`} testId={rowTestId} rank={i + 1} title={row.title} reference={row.reference} amount={row.amount}
                reasons={row.reasons} score={row.score} selected={i === index} onSelect={() => setSelectedKey(row.key)} />
            );
          })}
        </ul>
        <KeyLegend keys={legend} />
      </section>
      <section aria-label="Selected item" aria-live="polite" className="min-w-0 flex-[2_1_560px] rounded-[14px] border border-border bg-white p-5 sm:p-[26px]">
        {selected ? panel(selected, index + 1) : <p className="text-muted">Pick an item on the left to see why it is here and what to do.</p>}
      </section>
    </div>
  );
}
