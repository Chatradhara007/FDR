import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
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
}

type Dir = 'asc' | 'desc';

export function Table<T>({ columns, rows, rowKey, loading, emptyTitle = 'Nothing here yet', emptyDescription, onRowClick, caption }: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  onRowClick?: (row: T) => void;
  caption?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows ?? [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a); const vb = get(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * factor;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    // Long tables scroll inside a frame so the sticky header stays in view; short ones just grow.
    <div className={cn('overflow-x-auto rounded-lg border border-slate-200 bg-surface', (rows?.length ?? 0) > 15 && 'max-h-[calc(100vh-10rem)] overflow-y-auto')}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const SortIcon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('px-3 py-2 text-xs font-semibold text-slate-600', c.align === 'right' ? 'text-right' : 'text-left', c.className)}
                >
                  {c.sortValue ? (
                    <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 rounded hover:text-slate-900">
                      {c.header}
                      <SortIcon className={cn('size-3.5', active ? 'text-slate-700' : 'text-slate-400')} aria-hidden />
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading
            ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i} aria-hidden>
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-2.5"><div className="h-4 animate-pulse rounded bg-slate-100" /></td>
                  ))}
                </tr>
              ))
            : sorted.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && 'cursor-pointer hover:bg-primary-50/50')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-3 py-2.5 text-slate-800', c.align === 'right' && 'whitespace-nowrap text-right tabular-nums', c.className)}>
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
  );
}
