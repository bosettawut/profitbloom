import React, { useRef, useState } from 'react';
import type { CostItem } from '../../lib/api';
import { fmt } from '../../lib/decision';

/** a planned row that holds something (a name or an amount) but has no category chosen */
export const lacksCategory = (i: CostItem) => !i.isExtra && !i.category && (i.name.trim() !== '' || i.quantity * i.price > 0);

/** how many rows the dialog names before it says "and N more" */
const SHOWN = 6;

/**
 * Before the costs are left behind (the next step of the new-project form, saving a job): when filled-in
 * rows still have no category, lists them and asks whether to go back and choose or to carry on.
 *
 * `ask` resolves to true (carry on, or there was nothing to ask) or false (go back and choose).
 * `goOn` is the wording of the carry-on button.
 */
export function useCategoryPrompt() {
  const [open, setOpen] = useState<{ rows: CostItem[]; goOn: string } | null>(null);
  const answer = useRef<(value: boolean) => void>(() => {});

  const ask = (items: CostItem[], goOn = 'ไปต่อ'): Promise<boolean> => {
    const rows = items.filter(lacksCategory);
    if (rows.length === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      answer.current = (value) => {
        setOpen(null);
        resolve(value);
      };
      setOpen({ rows, goOn });
    });
  };

  const node = open ? (
    <div className="fixed inset-0 z-50 bg-[#221A33]/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => answer.current(false)}>
      <div role="dialog" aria-modal="true" aria-label="ยังไม่ได้เลือกหมวด" className="bg-white rounded-[24px] shadow-soft-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-ink mb-1">ยังไม่ได้เลือกหมวด</h3>
        <p className="text-sm text-ink-muted mb-4">รายการต่อไปนี้ยังไม่ได้เลือกหมวด ถ้ายังไม่เลือก ระบบจะนับเป็นหมวด {'"อื่น\u00A0ๆ"'} ไปก่อน</p>
        <ul className="rounded-2xl bg-[#F7F6FA] p-4 text-sm space-y-2">
          {open.rows.slice(0, SHOWN).map((i) => (
            <li key={i.id} className="flex justify-between gap-4">
              <span className={`min-w-0 break-words ${i.name.trim() ? 'font-medium text-ink' : 'text-ink-muted'}`}>{i.name.trim() || 'รายการที่ยังไม่มีชื่อ'}</span>
              <span className="shrink-0 text-ink-muted">฿{fmt(i.quantity * i.price)}</span>
            </li>
          ))}
          {open.rows.length > SHOWN && <li className="text-ink-muted">และอีก {open.rows.length - SHOWN} รายการ</li>}
        </ul>
        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-6">
          <button type="button" onClick={() => answer.current(false)} className="pb-btn-secondary">กลับไปเลือกหมวด</button>
          <button type="button" onClick={() => answer.current(true)} className="pb-btn-primary">{open.goOn}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, node };
}
