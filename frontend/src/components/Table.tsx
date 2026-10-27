import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Search } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  className?: string;
  /** Secondary column: hidden until switched on from the "Columns" menu. */
  optional?: boolean;
}

type Dir = 'asc' | 'desc';

/**
 * Ledger table: hairline row dividers, roomy rows, sticky header, sortable headers.
 * Columns marked `optional` stay hidden behind a "Columns" toggle.
 * Opt-in: `serial` adds a "Sl. No." column, `search` a filter box (matched against the given text),
 * `pageSize` pagination with "Showing 1 to 10 of 60 entries".
 */
export function Table<T>({ columns, rows, rowKey, loading, emptyTitle = 'No records found', emptyDescription, onRowClick, caption, serial, search, pageSize }: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  onRowClick?: (row: T) => void;
  caption?: string;
  serial?: boolean;
  search?: (row: T) => string;
  pageSize?: number;
}) {
  const searchId = useId();
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const optional = columns.filter((c) => c.optional);
  const cols = columns.filter((c) => !c.optional || shown[c.key]);

  const filtered = useMemo(() => {
    const all = rows ?? [];
    const q = query.trim().toLowerCase();
    return search && q ? all.filter((r) => search(r).toLowerCase().includes(q)) : all;
  }, [rows, query, search]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const get = col.sortValue;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = get(a); const vb = get(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * factor;
    });
  }, [filtered, sort, columns]);

  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pages - 1);
  const start = pageSize ? current * pageSize : 0;
  const visible = pageSize ? sorted.slice(start, start + pageSize) : sorted;

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div className="min-w-0">
      {(search || optional.length > 0) && (
        <div className="flex flex-wrap items-center justify-end gap-3 px-1 pb-3">
          {search && (
            <label htmlFor={searchId} className="relative">
              <span className="sr-only">Search</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <input id={searchId} type="search" placeholder="Search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                className="h-10 w-60 rounded-lg border border-[#cbd5e1] bg-white pr-3 pl-9 text-sm" />
            </label>
          )}
          {optional.length > 0 && (
            <details className="relative">
              <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm text-ink hover:bg-strip">
                <Columns3 className="size-4" aria-hidden /> Columns
              </summary>
              <div className="absolute right-0 z-20 mt-1 min-w-48 rounded-xl border border-line bg-white p-2 shadow-md">
                {optional.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-strip">
                    <input type="checkbox" checked={!!shown[c.key]} onChange={(e) => setShown((m) => ({ ...m, [c.key]: e.target.checked }))} />
                    {c.header}
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {/* Wide tables scroll inside this frame; the page itself never scrolls sideways. */}
      <div className={cn('table-frame overflow-x-auto rounded-xl border border-line bg-surface', (visible.length ?? 0) > 15 && 'max-h-[calc(100vh-10rem)] overflow-y-auto')}>
        <table className="gov-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              {serial && <th scope="col" className="w-16 text-right!">Sl. No.</th>}
              {cols.map((c) => {
                const active = sort?.key === c.key;
                const SortIcon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('whitespace-nowrap', c.align === 'right' && 'text-right!', c.className)}
                  >
                    {c.sortValue ? (
                      <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 font-semibold tracking-wide uppercase hover:text-slate-900">
                        {c.header}
                        <SortIcon className={cn('size-3.5', active ? 'text-ink' : 'text-slate-400')} aria-hidden />
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} aria-hidden>
                    {serial && <td />}
                    {cols.map((c) => (
                      <td key={c.key}><div className="h-4 animate-pulse rounded bg-strip" /></td>
                    ))}
                  </tr>
                ))
              : visible.map((row, i) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && 'cursor-pointer')}
                  >
                    {serial && <td className="num">{start + i + 1}</td>}
                    {cols.map((c) => (
                      <td key={c.key} className={cn(c.align === 'right' && 'num', c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
        {loading && <span className="sr-only">Loading…</span>}
        {!loading && sorted.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
      </div>
      {pageSize && !loading && sorted.length > 0 && (
        <nav aria-label="Table pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-slate-600">
          <p aria-live="polite">Showing {start + 1} to {start + visible.length} of {sorted.length} entries</p>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <PageButton disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</PageButton>
              {Array.from({ length: pages }, (_, p) => (
                <PageButton key={p} active={p === current} onClick={() => setPage(p)} label={`Page ${p + 1}`}>{p + 1}</PageButton>
              ))}
              <PageButton disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Next</PageButton>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}

function PageButton({ children, onClick, disabled, active, label }: { children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-current={active ? 'page' : undefined}
      className={cn('h-9 min-w-9 rounded-lg px-2 text-sm', active ? 'bg-ink text-white' : 'text-ink hover:bg-strip', disabled && 'cursor-not-allowed text-slate-400 hover:bg-transparent')}>
      {children}
    </button>
  );
}
