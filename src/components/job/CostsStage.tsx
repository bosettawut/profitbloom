import React, { useEffect, useState } from 'react';
import { Lightbulb, Plus, Trash2 } from 'lucide-react';
import type { CostGroup, CostItem, Project } from '../../lib/api';
import { toJob } from '../../lib/job';
import { lacksCategory } from './CategoryPrompt';
import { useHeadingPrompt } from './HeadingPrompt';
import {
  categoryLabel,
  conditionCost,
  conditionItems,
  COST_CATEGORIES,
  fmt,
  marginToMarkup,
  markupToMargin,
  overBudget,
  remargined,
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
  /** grey hints for the name box of particular rows (by item id), in place of the usual one */
  nameHints?: Record<number, string>;
}

const input = 'pb-input pb-input-sm';
/** below the wide table layout these boxes are narrow: less padding at the sides leaves room for the figures */
const narrow = 'max-xl:!px-2';
let tempId = -1;

/** A draft brought back after a refresh carries temporary ids made before it: new ones must start below them. */
export function reserveTempIds(ids: number[]) {
  tempId = Math.min(tempId, ...ids.map((id) => id - 1));
}

/** a new heading; it gets a real id when the job is saved */
export function blankGroup(markup: number, name = ''): CostGroup {
  return { id: tempId--, name, markup, discountType: 'percent', discount: 0 };
}

/** an empty row: its category is left for the user to choose unless the caller already knows it */
export function blankItem(category: CostCategory | '' = '', groupId: number | null = null): CostItem {
  return {
    id: tempId--,
    groupId,
    name: '',
    category,
    quantity: 1,
    unit: '',
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
    // the box shows a rounded figure: left as it was, it must not push that rounding back into the job
    if (text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) !== value) onCommit(Number(text));
    // back to the current value; when the commit goes through, the new value arrives right after and replaces it
    setText(String(value));
  };
  return (
    <input
      {...rest}
      className={input}
      type="number"
      inputMode="decimal"
      // emptied and left, this box goes back to its last value (see commit), so it must not be refilled with 0
      data-keep-empty
      disabled={disabled}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** A job condition read off the cost items: whether a row stands for it (by category or by name), and how much is planned. */
function FromCategory({ label, hint, amount, listed, saidYes, onAdd }: { label: string; hint: string; amount: number; listed: boolean; saidYes: boolean; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-line last:border-0">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
      {amount > 0 || saidYes ? (
        <span className="px-3 py-1.5 text-xs rounded-full bg-emerald-50 text-emerald-700 font-medium shrink-0 whitespace-nowrap">ใส่แล้ว{amount > 0 ? ` ฿${fmt(amount)}` : ''}</span>
      ) : listed ? (
        // the row is there but has no amount yet: adding another would only repeat it
        <span className="px-3 py-1.5 text-xs rounded-full bg-rose-50 text-rose-600 font-medium shrink-0 whitespace-nowrap">ยังไม่ใส่ราคา</span>
      ) : (
        <button type="button" onClick={onAdd} className="px-3 py-1.5 rounded-full bg-rose-50 text-xs text-rose-600 font-medium hover:bg-rose-100 shrink-0 whitespace-nowrap">
          ยังไม่ใส่ · เพิ่มรายการ
        </button>
      )}
    </div>
  );
}

export function CostsStage({ draft, patch, rules, h, lessons, nameHints }: Props) {
  const items = draft.costItems.filter((i) => !i.isExtra);
  const groups = draft.costGroups;
  const job = toJob(draft);
  /** a job made from an accepted quote: the price is fixed, so margins are shown but not set here */
  const agreed = draft.agreedPrice ?? null;
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
  const addItem = (groupId: number | null, category: CostCategory | '' = '', name = '', price = 0) => {
    const made = groupId === null && groups.length === 0 ? newGroup() : null;
    const target = groupId ?? made?.id ?? groups[groups.length - 1].id;
    patch({ costGroups: made ? [made] : groups, costItems: [...draft.costItems, { ...blankItem(category, target), name, price, total: price }] });
  };
  const removeItem = (id: number) => patch({ costItems: draft.costItems.filter((i) => i.id !== id) });
  const addGroup = () => {
    const g = newGroup();
    patch({ costGroups: [...groups, g], costItems: [...draft.costItems, blankItem('', g.id)] });
  };
  const setGroup = (id: number, change: Partial<CostGroup>) => patch({ costGroups: groups.map((g) => (g.id === id ? { ...g, ...change } : g)) });
  const headingPrompt = useHeadingPrompt();
  /** a row the app adds for a known purpose (the owner's labour, teardown): the user says which heading it goes under, or names a new heading for it */
  const addUnderChosenHeading = async (category: CostCategory, name: string) => {
    const choice = await headingPrompt.ask(name, groups);
    if (!choice) return;
    if ('groupId' in choice) return addItem(choice.groupId, category, name);
    const g = { ...newGroup(), name: choice.newName };
    patch({ costGroups: [...groups, g], costItems: [...draft.costItems, { ...blankItem(category, g.id), name }] });
  };
  /** a heading's discount: a share of its price can be at most all of it; switching to a share brings a larger figure down to 100 */
  const setDiscount = (g: CostGroup, change: { discount?: number; discountType?: 'percent' | 'baht' }) => {
    const discountType = change.discountType ?? g.discountType ?? 'percent';
    const discount = Math.max(0, change.discount ?? g.discount ?? 0);
    setGroup(g.id, { discountType, discount: discountType === 'percent' ? Math.min(100, discount) : discount });
  };
  const removeGroup = (g: CostGroup) => {
    const inside = items.filter((i) => i.groupId === g.id);
    if (inside.some((i) => i.name.trim() || i.quantity * i.price > 0) && !window.confirm(`ลบหัวข้อ "${g.name || 'ไม่มีชื่อ'}" พร้อมรายการข้างใน ${inside.length} รายการ ใช่หรือไม่?`)) return;
    patch({ costGroups: groups.filter((x) => x.id !== g.id), costItems: draft.costItems.filter((i) => i.isExtra || i.groupId !== g.id) });
  };

  // the job's own margin and price are the sum of its headings; changing either here moves every heading
  const margin = h.margin;
  const setMargin = (m: number) => {
    const r = remargined(job, m);
    patch({ profitMargin: r.profitMargin, costGroups: r.groups });
  };
  const setPrice = (price: number) => {
    if (h.cost <= 0) return;
    const r = repriced(job, price);
    patch({ profitMargin: r.profitMargin, costGroups: r.groups });
  };
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const budgetGap = overBudget(h.price, draft.budget);

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
            const discounted = !!sums && sums.off > 0;
            const belowCost = !!sums && discounted && sums.cost > 0 && sums.price < sums.cost - 0.005;
            return (
              <section key={g.id} aria-label={g.name || 'หัวข้อ'} className="rounded-2xl border border-line p-3 md:p-4">
                {/* on a phone the name and the delete button share the first line, the discount and the margin the second */}
                <div className="grid grid-cols-[1fr_5rem] md:grid-cols-[1fr_auto_5.5rem_auto] gap-2 md:gap-3 items-end mb-3">
                  <div className="min-w-0 order-1 md:order-none">
                    <label className="pb-label">ชื่อหัวข้อ</label>
                    <input className={`${input} font-medium`} aria-label="ชื่อหัวข้อ" value={g.name} placeholder="เช่น ซุ้มดอกไม้" onChange={(e) => setGroup(g.id, { name: e.target.value })} />
                  </div>
                  {/* taken off the price the margin gives, for the whole heading: a share of it, or an amount */}
                  <div className="min-w-0 order-3 md:order-none">
                    <label className="pb-label">ส่วนลด</label>
                    <div className="flex gap-2">
                      <input className={`${input} min-w-0 flex-1 max-md:max-w-[9rem] max-md:!px-2.5 md:flex-none md:!w-24`} type="number" min="0" inputMode="decimal" aria-label="ส่วนลดของหัวข้อ" disabled={agreed !== null} value={g.discount || ''} placeholder="0" onChange={(e) => setDiscount(g, { discount: num(e.target.value) })} />
                      <select className={`${input} !w-[4.75rem] md:!w-[5.25rem] shrink-0 max-md:!pl-2.5`} aria-label="หน่วยของส่วนลด" disabled={agreed !== null} value={g.discountType ?? 'percent'} onChange={(e) => setDiscount(g, { discountType: e.target.value as 'percent' | 'baht' })}>
                        <option value="percent">%</option>
                        <option value="baht">บาท</option>
                      </select>
                    </div>
                  </div>
                  <div className="order-4 md:order-none">
                    <label className="pb-label">Margin (%)</label>
                    <CommitNumber min="0" max="95" step="0.1" aria-label="Margin ของหัวข้อ" disabled={agreed !== null} value={Number(markupToMargin(agreed === null ? g.markup : sums?.markup ?? 0).toFixed(1))} onCommit={(m) => setGroup(g.id, { markup: marginToMarkup(Math.min(95, Math.max(0, m))) })} />
                  </div>
                  <button type="button" onClick={() => removeGroup(g)} aria-label="ลบหัวข้อ" title="ลบหัวข้อ" className="order-2 md:order-none justify-self-end md:justify-self-auto p-2 mb-0.5 rounded-full text-ink-muted hover:text-rose-600 hover:bg-rose-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="hidden xl:grid grid-cols-[1.4fr_1.2fr_0.55fr_0.7fr_0.85fr_0.9fr_auto] gap-3 px-1 pb-2 text-xs font-medium text-ink-muted">
                  <span>รายการ</span><span>หมวด</span><span>จำนวน</span><span>หน่วย</span><span>ราคา/หน่วย</span><span className="text-right">รวม</span><span className="w-8" />
                </div>
                <div className="space-y-3 xl:space-y-2">
                  {inside.length === 0 && <p className="text-sm text-ink-muted py-3 text-center">ยังไม่มีรายการในหัวข้อนี้</p>}
                  {inside.map((i) => (
                    <div key={i.id} className="grid grid-cols-2 sm:grid-cols-[1.6fr_0.6fr_0.7fr_0.9fr_1fr] xl:grid-cols-[1.4fr_1.2fr_0.55fr_0.7fr_0.85fr_0.9fr_auto] gap-2 xl:gap-3 items-center rounded-2xl xl:rounded-none bg-[#F7F6FA] xl:bg-transparent p-3 xl:p-0">
                      <input className={`${input} col-span-2 sm:col-span-5 xl:col-span-1`} aria-label="ชื่อรายการ" value={i.name} placeholder={nameHints?.[i.id] ?? 'เช่น ดอกกุหลาบขาว'} onChange={(e) => setItem(i.id, { name: e.target.value })} />
                      {/* on a phone the category sits under the three number boxes, beside the total */}
                      <div className="order-1 sm:order-none">
                        <span className="xl:hidden block text-xs text-ink-muted mb-1">หมวด</span>
                        {/* nothing is chosen for the user; a row that holds something shows this in red until a category is picked (a reminder: a dialog asks about it, but it does not stop saving) */}
                        <select className={`${input} ${i.category ? '' : lacksCategory(i) ? '!border-rose-400 !text-rose-600' : '!text-[#8C879D]'}`} aria-label="หมวด" aria-invalid={lacksCategory(i) || undefined} value={i.category} onChange={(e) => setItem(i.id, { category: e.target.value as CostCategory })}>
                          <option value="" disabled>เลือกหมวด</option>
                          {COST_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2 grid grid-cols-[2.5fr_3.3fr_3.4fr] gap-2 sm:contents">
                        <div>
                          <span className="xl:hidden block text-xs text-ink-muted mb-1">จำนวน</span>
                          <input className={`${input} ${narrow}`} type="number" min="0" inputMode="decimal" aria-label="จำนวน" value={i.quantity} onChange={(e) => setItem(i.id, { quantity: num(e.target.value) })} />
                        </div>
                        <div>
                          <span className="xl:hidden block text-xs text-ink-muted mb-1">หน่วย</span>
                          <input className={`${input} ${narrow}`} aria-label="หน่วย" maxLength={30} value={i.unit ?? ''} placeholder="เช่น ดอก" onChange={(e) => setItem(i.id, { unit: e.target.value })} />
                        </div>
                        <div>
                          <span className="xl:hidden block text-xs text-ink-muted mb-1">ราคา/หน่วย</span>
                          <input className={`${input} ${narrow}`} type="number" min="0" inputMode="decimal" aria-label="ราคาต่อหน่วย" value={i.price} onChange={(e) => setItem(i.id, { price: num(e.target.value) })} />
                        </div>
                      </div>
                      {/* on small screens the total and the delete button share a cell */}
                      <div className="order-2 sm:order-none flex items-end justify-between gap-2 xl:contents">
                        <div><span className="xl:hidden block text-xs text-ink-muted mb-1">รวม</span><p className="text-sm font-semibold text-ink xl:text-right py-2 xl:py-0">฿{fmt(i.quantity * i.price)}</p></div>
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
                    ต้นทุน <span className="font-semibold text-ink">฿{fmt(sums?.cost ?? 0)}</span>
                    {discounted && <> · ลด <span className="font-semibold text-ink">฿{fmt(sums.off)}</span></>} · ราคาขาย{' '}
                    <span className={`font-semibold ${belowCost ? 'text-rose-600' : 'text-ink'}`}>฿{fmt(sums?.price ?? 0)}</span>
                    {/* with a discount the heading earns less than its Margin box says: show what is left, and say so when it sells under cost */}
                    {discounted && <span className={belowCost ? 'font-medium text-rose-600' : ''}> ({belowCost ? 'ต่ำกว่าทุน' : `Margin หลังลด ${sums.netMargin.toFixed(1)}%`})</span>}
                  </p>
                </div>
              </section>
            );
          })}
        </div>
        {/* on a phone the headings make a long list: a second button at its end saves scrolling back up */}
        {groups.length > 0 && (
          <button type="button" onClick={addGroup} className="pb-btn-secondary !py-2 w-full mt-4 md:hidden">
            <Plus className="w-4 h-4" /> เพิ่มหัวข้อ
          </button>
        )}
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
          <FromCategory label="ค่าแรงเจ้าของ" hint='นับจากรายการในหมวดนี้ หรือที่ชื่อมีคำว่า "ค่าแรงเจ้าของ"' amount={conditionCost(job, 'owner_labor')} listed={conditionItems(job, 'owner_labor').length > 0} saidYes={draft.ownerLabor === true} onAdd={() => addUnderChosenHeading('owner_labor', 'ค่าแรงเจ้าของ')} />
          <FromCategory label="ค่าเก็บงานและขนส่งกลับ" hint='นับจากรายการในหมวด "เก็บงาน/ขนส่งกลับ" หรือที่ชื่อมีคำว่า "เก็บงาน" / "ขนส่งกลับ"' amount={conditionCost(job, 'teardown')} listed={conditionItems(job, 'teardown').length > 0} saidYes={draft.teardown === true} onAdd={() => addUnderChosenHeading('teardown', 'เก็บงานและขนส่งกลับ')} />
        </div>

        {/* Pricing */}
        <div className="pb-card p-5 md:p-6">
          <h3 className="text-base md:text-lg font-semibold text-ink mb-4">ราคาเสนอ</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="pb-label">Margin (%)</label>
              <CommitNumber min="0" max="95" step="0.1" aria-label="Margin" disabled={agreed !== null} value={Number(margin.toFixed(1))} onCommit={setMargin} />
            </div>
            <div>
              <label className="pb-label">ราคาขาย (บาท)</label>
              <CommitNumber min="0" aria-label="ราคาขาย" value={Math.round(h.price)} disabled={agreed !== null || h.cost <= 0} onCommit={setPrice} />
            </div>
          </div>
          {agreed !== null ? (
            <p className="mt-2 text-xs text-ink-muted">ราคาขายยึดตามใบเสนอราคาที่ลูกค้าตกลงแล้ว ฿{fmt(agreed)} จึงแก้ที่นี่ไม่ได้ · Margin คำนวณจากต้นทุนที่กรอก</p>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">Margin รวมของทั้งงาน = กำไร ÷ ราคาขาย · แก้ Margin หรือราคาขายที่นี่ ระบบจะปรับทุกหัวข้อตามสัดส่วนเดิม ให้ทั้งงานได้ตามที่กรอก</p>
          )}
          <div className={`mt-4 flex flex-wrap gap-2 ${agreed !== null ? 'hidden' : ''}`}>
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
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="pb-label">งบที่ลูกค้าเสนอ (บาท)</label>
              <input className={input} type="number" min="0" inputMode="decimal" value={draft.budget || ''} placeholder="ไม่ทราบ" onChange={(e) => patch({ budget: num(e.target.value) })} />
              {/* with a budget and a price to compare: says at once whether the price fits the client's budget */}
              {budgetGap !== null && (
                <p role="status" className={`mt-1.5 text-xs font-medium ${budgetGap > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {budgetGap > 0 ? `เกินงบลูกค้า ฿${fmt(budgetGap)}` : budgetGap === 0 ? 'พอดีงบลูกค้า' : `อยู่ในงบลูกค้า เหลือ ฿${fmt(-budgetGap)}`}
                </p>
              )}
            </div>
            <div>
              <label className="pb-label">มัดจำ (%)</label>
              <input className={input} type="number" min="0" max="100" inputMode="decimal" value={draft.depositPct} onChange={(e) => patch({ depositPct: num(e.target.value) })} />
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-line space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-ink-muted">ต้นทุนรวม</span><span className="text-ink">฿{fmt(h.cost)}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">กำไร</span><span className={`font-medium ${h.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{h.profit < 0 ? '−' : ''}฿{fmt(Math.abs(h.profit))}</span></div>
            <div className="flex justify-between text-base"><span className="font-semibold text-ink">ราคาเสนอขาย</span><span className="font-semibold text-ink">฿{fmt(h.price)}</span></div>
            {draft.depositPct > 0 && (
              <div className="flex justify-between"><span className="text-ink-muted">มัดจำ ({draft.depositPct}%)</span><span className="text-ink">฿{fmt(h.deposit)}</span></div>
            )}
          </div>
        </div>
      </div>
      {headingPrompt.node}
    </div>
  );
}
