import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { EmptyState, ErrorState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  className?: string;
}

type Dir = 'asc' | 'desc';

/**
 * Data table: hairline row dividers, no grid or zebra, sticky small-caps header, sortable headers.
 * Opt-in: `serial` adds a "Sl. No." column, `search` a filter box (matched against the given text),
 * `pageSize` pagination with "Showing 1 to 10 of 60 entries".
 */
export function Table<T>({ columns, rows, rowKey, loading, error, onRetry, emptyTitle = 'No records found', emptyDescription, onRowClick, caption, serial, search, pageSize, rowTestId }: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Query error: the table shows the shared error state instead of rows. */
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  onRowClick?: (row: T) => void;
  caption?: string;
  serial?: boolean;
  search?: (row: T) => string;
  pageSize?: number;
  rowTestId?: string;
}) {
  const searchId = useId();
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

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
      {search && (
        <div className="mb-2 flex justify-end">
          <label htmlFor={searchId} className="flex items-center gap-2 text-sm text-muted">
            Search:
            <span className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input id={searchId} type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                className="h-9 w-56 rounded-[8px] border border-border bg-white pr-2 pl-8 text-sm" />
            </span>
          </label>
        </div>
      )}
      {/* Wide tables scroll inside this frame; the page itself never scrolls sideways. */}
      <div className={cn('relative overflow-x-auto rounded-[14px] border border-border bg-surface', (visible.length ?? 0) > 15 && 'max-h-[calc(100vh-10rem)] overflow-y-auto')}>
        <table className="gov-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10">
            <tr>
              {serial && <th scope="col" className="w-16 text-right!">Sl. No.</th>}
              {columns.map((c) => {
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
                      <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 font-bold uppercase tracking-[0.05em] text-muted hover:text-ink">
                        {c.header}
                        <SortIcon className={cn('size-3.5', active ? 'text-ink' : 'text-muted/70')} aria-hidden />
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
                    {columns.map((c) => (
                      <td key={c.key}><div className="h-4 animate-pulse rounded bg-chip" /></td>
                    ))}
                  </tr>
                ))
              : visible.map((row, i) => (
                  <tr
                    key={rowKey(row)}
                    data-testid={rowTestId}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && 'cursor-pointer')}
                  >
                    {serial && <td className="num">{start + i + 1}</td>}
                    {columns.map((c) => (
                      <td key={c.key} className={cn(c.align === 'right' && 'num', c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
        {loading && <span className="sr-only">Loading…</span>}
        {!loading && !!error && <ErrorState error={error} onRetry={onRetry} />}
        {!loading && !error && sorted.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
      </div>
      {pageSize && !loading && sorted.length > 0 && (
        <nav aria-label="Table pages" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
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
      className={cn('h-9 min-w-9 rounded-[8px] border px-2 text-sm', active ? 'border-ink bg-ink text-white' : 'border-border bg-white text-ink hover:bg-subtle', disabled && 'cursor-not-allowed text-muted opacity-60')}>
      {children}
    </button>
  );
}

/** Server-side paging under a table: "Page 2 of 5" with Previous / Next. Renders nothing for a single page. */
export function Pager({ page, pages, onPage, total, noun }: { page: number; pages: number; onPage: (p: number) => void; total?: number; noun?: string }) {
  if (pages <= 1 && total === undefined) return null;
  return (
    <nav aria-label="Pages" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
      <span className="tabular-nums">{total !== undefined ? `${total.toLocaleString('en-IN')} ${noun ?? 'entries'}` : ''}</span>
      {pages > 1 && (
        <span className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
          <span className="tabular-nums text-ink">Page {page} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
        </span>
      )}
    </nav>
  );
}
