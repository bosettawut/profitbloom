import React, { useEffect, useState } from 'react';
import { Lightbulb, Plus, Trash2 } from 'lucide-react';
import type { CostGroup, CostItem, Project } from '../../lib/api';
import { toJob } from '../../lib/job';
import {
  categoryCost,
  categoryLabel,
  COST_CATEGORIES,
  fmt,
  marginToMarkup,
  markupToMargin,
  repriced,
  type CostCategory,
  type health,
  type learnings,
  type Rules,
} from '../../lib/decision';

interface Props {
  draft: Project;
  patch: (p: Partial<Project>) => void;
  rules: Rules;
  h: ReturnType<typeof health>;
  lessons: ReturnType<typeof learnings>;
}

const input = 'pb-input !py-2';
let tempId = -1;

/** a new heading; it gets a real id when the job is saved */
export function blankGroup(markup: number, name = ''): CostGroup {
  return { id: tempId--, name, markup };
}

export function blankItem(category: CostCategory = 'material', groupId: number | null = null): CostItem {
  return {
    id: tempId--,
    groupId,
    name: '',
    category,
    quantity: 1,
    price: 0,
    total: 0,
    actual: null,
    isExtra: false,
  };
}

/** A number field for derived values (price ↔ margin): keeps what the user types and commits on blur / Enter. */
function CommitNumber({ value, onCommit, disabled, ...rest }: { value: number; onCommit: (v: number) => void; disabled?: boolean; min?: string; max?: string; step?: string; 'aria-label'?: string }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    if (text.trim() !== '' && Number.isFinite(Number(text))) onCommit(Number(text));
    else setText(String(value));
  };
  return (
    <input
      {...rest}
      className={input}
      type="number"
      inputMode="decimal"
      disabled={disabled}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** A job condition read off the cost items: whether anything is planned in a category, and how much. */
function FromCategory({ label, hint, amount, saidYes, onAdd }: { label: string; hint: string; amount: number; saidYes: boolean; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-line last:border-0">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
      {amount > 0 || saidYes ? (
        <span className="px-3 py-1.5 text-xs rounded-full bg-emerald-50 text-emerald-700 font-medium shrink-0 whitespace-nowrap">ใส่แล้ว{amount > 0 ? ` ฿${fmt(amount)}` : ''}</span>
      ) : (
        <button type="button" onClick={onAdd} className="px-3 py-1.5 rounded-full bg-[#F1F0F5] text-xs text-ink hover:bg-[#E8E6EF] shrink-0 whitespace-nowrap">
          ยังไม่ใส่ · เพิ่มรายการ
        </button>
      )}
    </div>
  );
}

export function CostsStage({ draft, patch, rules, h, lessons }: Props) {
  const items = draft.costItems.filter((i) => !i.isExtra);
  const groups = draft.costGroups;
  const job = toJob(draft);
  const newGroup = () => blankGroup(marginToMarkup(rules.goodMargin), groups.length === 0 ? 'รายการต้นทุน' : '');
  const setItem = (id: number, change: Partial<CostItem>) =>
    patch({
      costItems: draft.costItems.map((i) => {
        if (i.id !== id) return i;
        const next = { ...i, ...change };
        return { ...next, total: next.quantity * next.price };
      }),
    });
  /** adds an item under a heading; with no heading named it goes under the last one (made on the spot if the job has none) */
  const addItem = (groupId: number | null, category: CostCategory = 'material', name = '', price = 0) => {
    const made = groupId === null && groups.length === 0 ? newGroup() : null;
    const target = groupId ?? made?.id ?? groups[groups.length - 1].id;
    patch({ costGroups: made ? [made] : groups, costItems: [...draft.costItems, { ...blankItem(category, target), name, price, total: price }] });
  };
  const removeItem = (id: number) => patch({ costItems: draft.costItems.filter((i) => i.id !== id) });
  const addGroup = () => {
    const g = newGroup();
    patch({ costGroups: [...groups, g], costItems: [...draft.costItems, blankItem('material', g.id)] });
  };
  const setGroup = (id: number, change: Partial<CostGroup>) => patch({ costGroups: groups.map((g) => (g.id === id ? { ...g, ...change } : g)) });
  const removeGroup = (g: CostGroup) => {
    const inside = items.filter((i) => i.groupId === g.id);
    if (inside.some((i) => i.name.trim() || i.quantity * i.price > 0) && !window.confirm(`ลบหัวข้อ "${g.name || 'ไม่มีชื่อ'}" พร้อมรายการข้างใน ${inside.length} รายการ ใช่หรือไม่?`)) return;
    patch({ costGroups: groups.filter((x) => x.id !== g.id), costItems: draft.costItems.filter((i) => i.isExtra || i.groupId !== g.id) });
  };

  // the job's own margin and price are the sum of its headings; changing either here moves every heading
  const margin = h.margin;
  const setMargin = (m: number) => {
    const markup = marginToMarkup(Math.min(95, Math.max(0, m)));
    patch({ profitMargin: markup, costGroups: groups.map((g) => ({ ...g, markup })) });
  };
  const setPrice = (price: number) => {
    if (h.cost <= 0) return;
    const r = repriced(job, price);
    patch({ profitMargin: r.profitMargin, costGroups: r.groups });
  };
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className="space-y-5">
      {lessons.length > 0 && (
        <div className="rounded-2xl bg-violet-50 px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#5A42C6]">
            <Lightbulb className="w-4 h-4" /> บทเรียนจากงานที่ผ่านมา
          </p>
          <ul className="mt-2 space-y-2">
            {lessons.map((l) => {
              const base = items.filter((i) => i.category === l.category).reduce((s, i) => s + i.quantity * i.price, 0);
              const buffer = Math.round((base * l.overrunPct) / 100);
              return (
                <li key={l.category} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink">
                  <span>
                    {categoryLabel(l.category)} เกินงบเฉลี่ย {l.overrunPct.toFixed(0)}% ({l.jobs} งาน)
                  </span>
                  {buffer > 0 && (
                    <button type="button" onClick={() => addItem(null, 'other', `เผื่อ${categoryLabel(l.category)}เกินงบ ${l.overrunPct.toFixed(0)}%`, buffer)} className="text-xs font-medium text-[#5A42C6] hover:underline">
                      + เผื่อไว้ {fmt(buffer)} บาท
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Cost items, heading by heading */}
      <div className="pb-card p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base md:text-lg font-semibold text-ink">รายการต้นทุน</h3>
            <p className="text-xs text-ink-muted">แบ่งต้นทุนเป็นหัวข้อ แต่ละหัวข้อตั้ง Margin ของตัวเองได้</p>
          </div>
          <button type="button" onClick={addGroup} className="pb-btn-secondary !py-2 shrink-0">
            <Plus className="w-4 h-4" /> เพิ่มหัวข้อ
          </button>
        </div>

        <div className="space-y-4">
          {groups.length === 0 && <p className="text-sm text-ink-muted py-6 text-center">ยังไม่มีหัวข้อ กด "เพิ่มหัวข้อ" เพื่อเริ่ม</p>}
          {groups.map((g) => {
            const inside = items.filter((i) => i.groupId === g.id);
            const sums = h.headings.find((x) => x.id === g.id);
            return (
              <section key={g.id} aria-label={g.name || 'หัวข้อ'} className="rounded-2xl border border-line p-3 md:p-4">
                <div className="grid grid-cols-[1fr_5.5rem_auto] gap-2 md:gap-3 items-end mb-3">
                  <div className="min-w-0">
                    <label className="pb-label">ชื่อหัวข้อ</label>
                    <input className={`${input} font-medium`} aria-label="ชื่อหัวข้อ" value={g.name} placeholder="เช่น ซุ้มดอกไม้" onChange={(e) => setGroup(g.id, { name: e.target.value })} />
                  </div>
                  <div>
                    <label className="pb-label">Margin (%)</label>
                    <CommitNumber min="0" max="95" step="0.1" aria-label="Margin ของหัวข้อ" value={Number(markupToMargin(g.markup).toFixed(1))} onCommit={(m) => setGroup(g.id, { markup: marginToMarkup(Math.min(95, Math.max(0, m))) })} />
                  </div>
                  <button type="button" onClick={() => removeGroup(g)} aria-label="ลบหัวข้อ" title="ลบหัวข้อ" className="p-2 mb-0.5 rounded-full text-ink-muted hover:text-rose-600 hover:bg-rose-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="hidden xl:grid grid-cols-[1.6fr_1fr_0.6fr_0.9fr_0.9fr_auto] gap-3 px-1 pb-2 text-xs font-medium text-ink-muted">
                  <span>รายการ</span><span>หมวด</span><span>จำนวน</span><span>ราคา/หน่วย</span><span className="text-right">รวม</span><span className="w-8" />
                </div>
                <div className="space-y-3 xl:space-y-2">
                  {inside.length === 0 && <p className="text-sm text-ink-muted py-3 text-center">ยังไม่มีรายการในหัวข้อนี้</p>}
                  {inside.map((i) => (
                    <div key={i.id} className="grid grid-cols-2 sm:grid-cols-[1.5fr_0.8fr_1fr_0.8fr] xl:grid-cols-[1.6fr_1fr_0.6fr_0.9fr_0.9fr_auto] gap-2 xl:gap-3 items-center rounded-2xl xl:rounded-none bg-[#F7F6FA] xl:bg-transparent p-3 xl:p-0">
                      <input className={`${input} col-span-2 sm:col-span-4 xl:col-span-1`} aria-label="ชื่อรายการ" value={i.name} placeholder="เช่น ดอกกุหลาบขาว" onChange={(e) => setItem(i.id, { name: e.target.value })} />
                      <div>
                        <span className="xl:hidden block text-[11px] text-ink-muted mb-1">หมวด</span>
                        <select className={input} aria-label="หมวด" value={i.category} onChange={(e) => setItem(i.id, { category: e.target.value as CostCategory })}>
                          {COST_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <span className="xl:hidden block text-[11px] text-ink-muted mb-1">จำนวน</span>
                        <input className={input} type="number" min="0" inputMode="decimal" aria-label="จำนวน" value={i.quantity} onChange={(e) => setItem(i.id, { quantity: num(e.target.value) })} />
                      </div>
                      <div>
                        <span className="xl:hidden block text-[11px] text-ink-muted mb-1">ราคา/หน่วย</span>
                        <input className={input} type="number" min="0" inputMode="decimal" aria-label="ราคาต่อหน่วย" value={i.price} onChange={(e) => setItem(i.id, { price: num(e.target.value) })} />
                      </div>
                      {/* on small screens the total and the delete button share a cell */}
                      <div className="flex items-end justify-between gap-2 xl:contents">
                        <div><span className="xl:hidden block text-[11px] text-ink-muted mb-1">รวม</span><p className="text-sm font-semibold text-ink xl:text-right py-2 xl:py-0">฿{fmt(i.quantity * i.price)}</p></div>
                        <button type="button" onClick={() => removeItem(i.id)} aria-label="ลบรายการ" className="justify-self-end p-2 rounded-full text-ink-muted hover:text-rose-600 hover:bg-rose-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                  <button type="button" onClick={() => addItem(g.id)} className="inline-flex items-center gap-1 font-medium text-[#673AB7] hover:text-[#35235e]">
                    <Plus className="w-4 h-4" /> เพิ่มรายการ
                  </button>
                  <p className="text-ink-muted">
                    ต้นทุน <span className="font-semibold text-ink">฿{fmt(sums?.cost ?? 0)}</span> · ราคาขาย <span className="font-semibold text-ink">฿{fmt(sums?.price ?? 0)}</span>
                  </p>
                </div>
              </section>
            );
          })}
        </div>
        <div className="mt-5 pt-4 border-t border-line flex flex-wrap justify-between gap-2 text-sm">
          <span className="text-ink-muted">ต้นทุนรวม</span>
          <span className="font-semibold text-ink">฿{fmt(h.cost)}</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Conditions */}
        <div className="pb-card p-5 md:p-6">
          <h3 className="text-base md:text-lg font-semibold text-ink mb-4">เงื่อนไขงาน</h3>
          <div className="grid grid-cols-2 gap-3 mb-2">
            {[
              ['วันเซ็ตอัพ', 'setupDays', draft.setupDays],
              ['วันงาน', 'eventDays', draft.eventDays],
              ['จำนวนทีมงาน (คน)', 'teamSize', draft.teamSize],
              ['ค่าแรงคิดกี่วัน', 'laborDays', draft.laborDays],
            ].map(([label, key, value]) => (
              <div key={key as string}>
                <label className="pb-label">{label as string}</label>
                <input
                  className={input}
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={value === null ? '' : (value as number)}
                  placeholder="—"
                  onChange={(e) => patch({ [key as string]: e.target.value === '' ? (key === 'setupDays' || key === 'eventDays' ? 0 : null) : Number(e.target.value) } as Partial<Project>)}
                />
              </div>
            ))}
          </div>
          <FromCategory label="ค่าแรงเจ้าของ" hint='นับจากรายการในหมวด "ค่าแรงเจ้าของ"' amount={categoryCost(job, 'owner_labor')} saidYes={draft.ownerLabor === true} onAdd={() => addItem(null, 'owner_labor', 'ค่าแรงเจ้าของ')} />
          <FromCategory label="ค่าเก็บงานและขนส่งกลับ" hint='นับจากรายการในหมวด "เก็บงาน/ขนส่งกลับ"' amount={categoryCost(job, 'teardown')} saidYes={draft.teardown === true} onAdd={() => addItem(null, 'teardown', 'เก็บงานและขนส่งกลับ')} />
        </div>

        {/* Pricing */}
        <div className="pb-card p-5 md:p-6">
          <h3 className="text-base md:text-lg font-semibold text-ink mb-4">ราคาเสนอ</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="pb-label">งบที่ลูกค้าเสนอ (บาท)</label>
              <input className={input} type="number" min="0" inputMode="decimal" value={draft.budget || ''} placeholder="ไม่ทราบ" onChange={(e) => patch({ budget: num(e.target.value) })} />
            </div>
            <div>
              <label className="pb-label">มัดจำ (%)</label>
              <input className={input} type="number" min="0" max="100" inputMode="decimal" value={draft.depositPct} onChange={(e) => patch({ depositPct: num(e.target.value) })} />
            </div>
            <div>
              <label className="pb-label">Margin (%)</label>
              <CommitNumber min="0" max="95" step="0.1" aria-label="Margin" value={Number(margin.toFixed(1))} onCommit={setMargin} />
            </div>
            <div>
              <label className="pb-label">ราคาขาย (บาท)</label>
              <CommitNumber min="0" aria-label="ราคาขาย" value={Math.round(h.price)} disabled={h.cost <= 0} onCommit={setPrice} />
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Margin รวมของทั้งงาน = กำไร ÷ ราคาขาย · แก้ Margin ที่นี่จะตั้งทุกหัวข้อให้เท่ากัน แก้ราคาขายจะปรับทุกหัวข้อตามสัดส่วน</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              [`Margin ขั้นต่ำ ${rules.minMargin}%`, rules.minMargin],
              [`Margin ที่ดี ${rules.goodMargin}%`, rules.goodMargin],
            ].map(([label, m]) => (
              <button key={label as string} type="button" onClick={() => setMargin(m as number)} className="px-3 py-1.5 rounded-full bg-[#F1F0F5] text-xs text-ink hover:bg-[#E8E6EF]">
                ตั้งราคาที่ {label as string}
              </button>
            ))}
            {draft.budget > 0 && h.cost > 0 && (
              <button type="button" onClick={() => setPrice(draft.budget)} className="px-3 py-1.5 rounded-full bg-[#F1F0F5] text-xs text-ink hover:bg-[#E8E6EF]">
                ตั้งราคาเท่างบลูกค้า
              </button>
            )}
          </div>
          <div className="mt-5 pt-4 border-t border-line space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-ink-muted">ต้นทุนรวม</span><span className="text-ink">฿{fmt(h.cost)}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">กำไร</span><span className="text-emerald-600 font-medium">฿{fmt(h.profit)}</span></div>
            <div className="flex justify-between text-base"><span className="font-semibold text-ink">ราคาเสนอขาย</span><span className="font-semibold text-ink">฿{fmt(h.price)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
