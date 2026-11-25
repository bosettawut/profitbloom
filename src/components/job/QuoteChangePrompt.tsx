import React, { useRef, useState } from 'react';
import type { QuoteChange } from '../../lib/api';
import { fmt } from '../../lib/decision';

/**
 * A job's quote follows the job: its lines and price (a tied quote), the customer's details, the job's name and the
 * event date. When the customer already has that quote (sent) or has agreed to it (approved), a save that would
 * change it is held back, and this asks whether to go ahead, showing what would change: saying yes saves the job and
 * the quote changes with it; saying no saves nothing.
 *
 * `ask` resolves to true (go ahead) or false (do not save). `from` says where it is asked: on saving the job
 * ('job', the usual case), or on the quote's own page when the shop asks for the quote to be brought into line ('quote').
 */
export function useQuoteChangePrompt() {
  const [open, setOpen] = useState<(QuoteChange & { from: 'job' | 'quote' }) | null>(null);
  const answer = useRef<(value: boolean) => void>(() => {});

  const ask = (change: QuoteChange, from: 'job' | 'quote' = 'job'): Promise<boolean> =>
    new Promise((resolve) => {
      answer.current = (value) => {
        setOpen(null);
        resolve(value);
      };
      setOpen({ ...change, from });
    });

  const node = open ? (
    <div className="fixed inset-0 z-50 bg-[#221A33]/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => answer.current(false)}>
      <div role="dialog" aria-modal="true" aria-label="ยืนยันการแก้ใบเสนอราคา" className="bg-white rounded-[24px] shadow-soft-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-ink mb-1">
          ใบเสนอราคา {open.code} {open.status === 'approved' ? 'ลูกค้าอนุมัติแล้ว' : 'ส่งให้ลูกค้าแล้ว'}
        </h3>
        <p className="text-sm text-ink-muted mb-4">
          {open.from === 'job' ? 'ถ้าบันทึกการแก้ไขนี้ ใบเสนอราคาจะเปลี่ยนตามโปรเจ็กต์ทันที จะแก้จริงหรือไม่' : 'รายการและราคาในใบนี้จะเปลี่ยนตามโปรเจ็กต์ทันที จะอัปเดตจริงหรือไม่'}
        </p>
        <div className="rounded-2xl bg-[#F7F6FA] p-4 text-sm space-y-2">
          {/* the customer, the job's name or the event date, as the quote has it now and as it will read */}
          {(open.details ?? []).map((d) => (
            <div key={d.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-ink-muted">{d.label}</span>
              <span className="font-semibold text-ink break-words text-right">
                {d.from || '-'} <span aria-hidden className="text-ink-muted font-normal">→</span><span className="sr-only"> เป็น </span> {d.to || '-'}
              </span>
            </div>
          ))}
          {open.lines !== false &&
            (open.price === open.newPrice ? (
              <p className="text-ink">ราคาในใบเท่าเดิม <span className="font-semibold">฿{fmt(open.price)}</span> แต่รายการในใบจะเปลี่ยนตามหัวข้อของโปรเจ็กต์</p>
            ) : (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-ink-muted">ราคาในใบ (ก่อน VAT)</span>
                <span className="font-semibold text-ink whitespace-nowrap">
                  ฿{fmt(open.price)} <span aria-hidden className="text-ink-muted font-normal">→</span><span className="sr-only"> เป็น </span> ฿{fmt(open.newPrice)}
                </span>
              </div>
            ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-6">
          <button type="button" onClick={() => answer.current(false)} className="pb-btn-secondary">{open.from === 'job' ? 'ไม่แก้' : 'ไม่อัปเดต'}</button>
          <button type="button" onClick={() => answer.current(true)} className="pb-btn-primary">{open.from === 'job' ? 'แก้และอัปเดตใบเสนอราคา' : 'อัปเดตใบเสนอราคา'}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, node };
}
