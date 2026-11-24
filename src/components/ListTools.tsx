import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';

/** which column a list is ordered by, and which way */
export interface Sort {
  key: string;
  dir: 'asc' | 'desc';
}

/** clicking a column again flips its direction; a new column starts in the direction that reads naturally for it */
export const nextSort = (current: Sort, key: string, firstDir: Sort['dir'] = 'asc'): Sort =>
  current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir };

/** orders a copy of the rows by a value picked from each row; empty values always sink to the bottom */
export function sortRows<T>(rows: T[], value: (row: T) => string | number, dir: Sort['dir']): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1;
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'th', { numeric: true }));
  });
}

interface SortHeaderProps {
  label: string;
  sortKey: string;
  sort: Sort;
  onSort: (key: string, firstDir: Sort['dir']) => void;
  align?: 'left' | 'right';
  /** numbers and dates read best biggest/newest first */
  firstDir?: Sort['dir'];
  /** extra classes for the heading cell, e.g. to show the column on wide screens only */
  className?: string;
}

/** A table heading that sorts by its column when clicked. */
export function SortHeader({ label, sortKey, sort, onSort, align = 'left', firstDir = 'asc', className = '' }: SortHeaderProps) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`px-2 2xl:px-3 py-3 font-medium whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'} ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey, firstDir)}
        className={`inline-flex items-center gap-1 hover:text-[#673AB7] ${active ? 'text-[#673AB7]' : 'text-ink'} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Icon className={`w-3.5 h-3.5 ${active ? '' : 'text-ink-muted'}`} />
      </button>
    </th>
  );
}

export const PAGE_SIZES = [10, 25, 50];

/** Cuts a list into pages. Going back to page 1 whenever `resetKey` changes (a new search, filter or sort). */
export function usePaged<T>(rows: T[], resetKey: string) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  useEffect(() => setPage(1), [resetKey, pageSize]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: current, pages, pageSize, total: rows.length, start, setPage, setPageSize };
}

interface PaginationProps {
  paged: ReturnType<typeof usePaged>;
  /** what the rows are, e.g. "โปรเจ็กต์" */
  unit: string;
}

/** "แสดง 1–10 จาก 34" with previous/next and a rows-per-page choice. */
export function Pagination({ paged, unit }: PaginationProps) {
  if (paged.total === 0) return null;
  const { page, pages, start, pageSize, total } = paged;
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6 md:mb-8 text-sm text-ink-muted">
      <p>
        แสดง {start + 1}–{Math.min(start + pageSize, total)} จาก {total} {unit}
      </p>
      <div className="flex items-stretch gap-2">
        <select
          aria-label="จำนวนต่อหน้า"
          className="bg-white rounded-full px-3 py-1 text-sm text-ink outline-none shadow-card"
          value={pageSize}
          onChange={(e) => paged.setPageSize(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n} ต่อหน้า</option>
          ))}
        </select>
        <button type="button" onClick={() => paged.setPage(page - 1)} disabled={page <= 1} aria-label="หน้าก่อนหน้า" className="pb-btn-secondary !px-3 !py-2 disabled:opacity-40">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="flex items-center text-ink whitespace-nowrap">หน้า {page} / {pages}</span>
        <button type="button" onClick={() => paged.setPage(page + 1)} disabled={page >= pages} aria-label="หน้าถัดไป" className="pb-btn-secondary !px-3 !py-2 disabled:opacity-40">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface DateRangeProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** which date is being filtered, e.g. "วันที่จัดงาน" */
  label: string;
}

/** Two date boxes: from – to. Either can be left empty. */
export function DateRange({ from, to, onChange, label }: DateRangeProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <input type="date" aria-label={`${label} ตั้งแต่`} title={`${label} ตั้งแต่`} className="pb-input text-ink-muted min-w-0 lg:w-44" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
      <span className="text-ink-muted shrink-0">–</span>
      <input type="date" aria-label={`${label} ถึง`} title={`${label} ถึง`} className="pb-input text-ink-muted min-w-0 lg:w-44" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
    </div>
  );
}

/** is an ISO date inside the range? an empty bound is open; a row without a date only passes when no range is set */
export const inDateRange = (iso: string, from: string, to: string) => {
  if (!from && !to) return true;
  if (!iso) return false;
  return (!from || iso >= from) && (!to || iso <= to);
};
