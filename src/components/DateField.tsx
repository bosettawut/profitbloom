import React, { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
/** the Thai (Buddhist) year */
const be = (d: Date) => d.getFullYear() + 543;

const pad = (n: number) => String(n).padStart(2, '0');
/** a day as the app stores it, YYYY-MM-DD, in local time */
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string | undefined) => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};
/** "25 พ.ย. 2569" */
export const thaiShortDate = (iso: string) => {
  const d = fromIso(iso);
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${be(d)}` : '';
};

interface DateFieldProps {
  /** YYYY-MM-DD, or '' for none */
  value: string;
  onChange: (value: string) => void;
  /** what the date is, read out for the box (e.g. "วันที่จัดงาน") */
  label: string;
  /** the earliest and latest day that can be chosen, YYYY-MM-DD */
  min?: string;
  max?: string;
  /** extra classes for the box, e.g. pb-input-sm or a width */
  className?: string;
  /** shown in the box while it holds no date */
  placeholder?: string;
  /** a "clear" button, for a date that may be left empty */
  clearable?: boolean;
}

/**
 * A date box. With a mouse or trackpad it opens the app's own calendar: larger than the browser's, in Thai with the
 * Buddhist year, and in the app's colours (Safari's own calendar cannot be made any bigger). On a touch screen it is
 * the device's own date picker, which is already large and familiar. Both are on the page, and CSS shows the one that
 * suits the pointer; they hold the same value.
 */
export function DateField({ value, onChange, label, min, max, className = '', placeholder = 'เลือกวันที่', clearable = true }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = fromIso(value);
  const today = new Date();
  const earliest = fromIso(min);
  const latest = fromIso(max);
  // the years the year list offers: around today, and always the chosen day's and the limits' own
  const years = [today.getFullYear() - 10, today.getFullYear() + 5, selected?.getFullYear(), earliest?.getFullYear(), latest?.getFullYear()].filter((y): y is number => !!y);
  const choose = (d: Date | undefined) => {
    if (!d) return;
    onChange(toIso(d));
    setOpen(false);
  };
  const disabled = [earliest && { before: earliest }, latest && { after: latest }].filter(Boolean) as Array<{ before: Date } | { after: Date }>;
  const todayAllowed = (!earliest || toIso(today) >= toIso(earliest)) && (!latest || toIso(today) <= toIso(latest));

  return (
    <>
      <input
        type="date"
        aria-label={label}
        title={label}
        className={`pb-input ${className} pointer-fine:hidden`}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button type="button" aria-label={label} title={label} className={`pb-input ${className} hidden pointer-fine:flex items-center justify-between gap-2 text-left`}>
            <span className={`truncate ${value ? 'text-ink' : 'text-ink-muted'}`}>{value ? thaiShortDate(value) : placeholder}</span>
            <CalendarDays className="w-[1.1em] h-[1.1em] text-ink-muted shrink-0" aria-hidden />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label={`ปฏิทินเลือก${label}`}
            className="z-[60] bg-white rounded-2xl border border-line shadow-soft-xl p-3 text-ink"
          >
            <DayPicker
              mode="single"
              selected={selected}
              defaultMonth={selected ?? (latest && latest < today ? latest : today)}
              onSelect={choose}
              showOutsideDays
              fixedWeeks
              captionLayout="dropdown-buttons"
              fromYear={Math.min(...years)}
              toYear={Math.max(...years)}
              disabled={disabled}
              formatters={{
                formatCaption: (m) => `${MONTHS[m.getMonth()]} ${be(m)}`,
                formatMonthCaption: (m) => MONTHS[m.getMonth()],
                formatYearCaption: (y) => String(be(y)),
                formatWeekdayName: (d) => WEEKDAYS[d.getDay()],
              }}
              labels={{
                labelPrevious: () => 'เดือนก่อน',
                labelNext: () => 'เดือนถัดไป',
                labelMonthDropdown: () => 'เดือน',
                labelYearDropdown: () => 'ปี (พ.ศ.)',
              }}
              classNames={{
                vhidden: 'sr-only',
                caption: 'flex items-center justify-between gap-2 mb-2',
                caption_dropdowns: 'flex items-center gap-1',
                dropdown_month: 'relative inline-flex items-center',
                dropdown_year: 'relative inline-flex items-center',
                dropdown: 'absolute inset-0 w-full opacity-0 cursor-pointer appearance-none',
                caption_label: 'flex items-center gap-1 rounded-xl px-2 py-1.5 text-base font-semibold hover:bg-[#F1F0F5]',
                dropdown_icon: 'w-4 h-4 text-ink-muted',
                nav: 'flex items-center gap-1',
                nav_button: 'w-10 h-10 inline-flex items-center justify-center rounded-full text-ink hover:bg-[#F1F0F5] disabled:opacity-30',
                table: 'border-collapse',
                head_cell: 'w-10 h-8 text-sm font-medium text-ink-muted',
                cell: 'p-0.5 text-center',
                day: 'w-10 h-10 inline-flex items-center justify-center rounded-full text-base hover:bg-[#F1F0F5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#673AB7]/50 disabled:pointer-events-none',
                day_today: 'font-semibold text-[#673AB7] ring-1 ring-inset ring-[#673AB7]/40',
                day_selected: '!bg-[#673AB7] !text-white font-semibold hover:!bg-[#5b32a3]',
                day_outside: 'text-ink-muted/50',
                day_disabled: 'text-ink-muted/30',
              }}
              components={{
                IconLeft: () => <ChevronLeft className="w-5 h-5" />,
                IconRight: () => <ChevronRight className="w-5 h-5" />,
                IconDropdown: () => <ChevronDown className="w-4 h-4 text-ink-muted" />,
                // the number on the day, and its whole date for a screen reader
                DayContent: ({ date }) => (
                  <>
                    <span aria-hidden>{date.getDate()}</span>
                    <span className="sr-only">{`${date.getDate()} ${MONTHS[date.getMonth()]} ${be(date)}`}</span>
                  </>
                ),
              }}
            />
            <div className="flex items-center justify-between gap-2 border-t border-line pt-2 mt-2">
              <button type="button" onClick={() => choose(today)} disabled={!todayAllowed} className="px-3 py-1.5 rounded-full text-sm font-medium text-[#673AB7] hover:bg-[#F1F0F5] disabled:opacity-40">
                วันนี้
              </button>
              {clearable && value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="px-3 py-1.5 rounded-full text-sm font-medium text-ink-muted hover:bg-[#F1F0F5] hover:text-ink"
                >
                  ล้างวันที่
                </button>
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </>
  );
}
