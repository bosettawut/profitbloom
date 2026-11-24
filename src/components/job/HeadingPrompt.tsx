import React, { useRef, useState } from 'react';
import type { CostGroup } from '../../lib/api';

/** where a new row should go: under an existing heading, or under a new one with this name */
export type HeadingChoice = { groupId: number } | { newName: string };

/** what a heading is called in a list; one without a name is told apart by its place */
export const headingLabel = (g: CostGroup, index: number) => g.name.trim() || `หัวข้อที่ ${index + 1} (ยังไม่มีชื่อ)`;

const option = 'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm cursor-pointer';

/**
 * Asks which heading a row the app is about to add (the owner's labour, teardown) belongs under,
 * or whether to start a new heading for it, in which case the heading's name is asked for too.
 *
 * `ask` resolves to the choice, or to null when the dialog was closed without one.
 */
export function useHeadingPrompt() {
  const [open, setOpen] = useState<{ item: string; groups: CostGroup[] } | null>(null);
  const [picked, setPicked] = useState<number | 'new' | null>(null);
  const [name, setName] = useState('');
  const answer = useRef<(value: HeadingChoice | null) => void>(() => {});

  const ask = (item: string, groups: CostGroup[]): Promise<HeadingChoice | null> =>
    new Promise((resolve) => {
      answer.current = (value) => {
        setOpen(null);
        resolve(value);
      };
      // a job with no heading yet can only get a new one
      setPicked(groups.length === 0 ? 'new' : null);
      setName('');
      setOpen({ item, groups });
    });

  const ready = picked === 'new' ? name.trim() !== '' : picked !== null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    answer.current(picked === 'new' ? { newName: name.trim() } : { groupId: picked as number });
  };

  const node = open ? (
    <div className="fixed inset-0 z-50 bg-[#221A33]/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => answer.current(null)}>
      <form role="dialog" aria-modal="true" aria-label="เลือกหัวข้อของรายการ" className="bg-white rounded-[24px] shadow-soft-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="text-lg font-semibold text-ink mb-1">เพิ่ม "{open.item}" ไว้ที่หัวข้อไหน</h3>
        <p className="text-sm text-ink-muted mb-4">เลือกหัวข้อที่มีอยู่ หรือสร้างหัวข้อใหม่</p>
        <div className="space-y-2">
          {open.groups.map((g, n) => (
            <label key={g.id} className={`${option} ${picked === g.id ? 'border-[#673AB7] bg-violet-50' : 'border-line'}`}>
              <input type="radio" name="heading" className="w-4 h-4 shrink-0 accent-[#673AB7]" checked={picked === g.id} onChange={() => setPicked(g.id)} />
              <span className={`min-w-0 break-words ${g.name.trim() ? 'font-medium text-ink' : 'text-ink-muted'}`}>{headingLabel(g, n)}</span>
            </label>
          ))}
          <label className={`${option} ${picked === 'new' ? 'border-[#673AB7] bg-violet-50' : 'border-line'}`}>
            <input type="radio" name="heading" className="w-4 h-4 shrink-0 accent-[#673AB7]" checked={picked === 'new'} onChange={() => setPicked('new')} />
            <span className="font-medium text-ink">สร้างหัวข้อใหม่</span>
          </label>
          {picked === 'new' && (
            <div className="pt-1">
              <label className="pb-label" htmlFor="new-heading-name">ชื่อหัวข้อ</label>
              <input id="new-heading-name" autoFocus className="pb-input pb-input-sm" aria-label="ชื่อหัวข้อใหม่" maxLength={200} value={name} placeholder="เช่น ทีมงาน" onChange={(e) => setName(e.target.value)} />
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-6">
          <button type="button" onClick={() => answer.current(null)} className="pb-btn-secondary">ยกเลิก</button>
          <button type="submit" disabled={!ready} className="pb-btn-primary">เพิ่มรายการ</button>
        </div>
      </form>
    </div>
  ) : null;

  return { ask, node };
}
