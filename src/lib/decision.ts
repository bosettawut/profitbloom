/**
 * ProfitBloom decision engine — "รู้ก่อนรับงาน ว่างานนี้จะเหลือกำไรจริงเท่าไร".
 *
 * Plain business rules + arithmetic, no AI. Every number the UI shows comes from here so the
 * Job Health Check, Quote Health Check, Scenario Simulator and Post-Event Review always agree.
 *
 * Terms (as used in the product vision deck):
 *   cost      total estimated cost of the job
 *   heading   a group of cost items the shop names itself, with its own markup
 *   price     selling price = the sum of every heading's cost × (1 + its markup)
 *   profit    price − cost
 *   margin    profit ÷ price   (NOT profit ÷ cost — that is the markup)
 */

import { jobPricing } from '../../shared/quote-math.js';

export type BuiltInCategory = 'material' | 'rental' | 'labor' | 'owner_labor' | 'transport' | 'teardown' | 'other';
/** a built-in category, or one the shop added in its settings ('c12') */
export type CostCategory = BuiltInCategory | `c${number}`;

const BUILT_IN_CATEGORIES: Array<{ id: CostCategory; label: string }> = [
  { id: 'material', label: 'ดอกไม้/วัสดุ' },
  { id: 'rental', label: 'เช่าอุปกรณ์/พร็อพ' },
  { id: 'labor', label: 'ค่าแรง' },
  { id: 'owner_labor', label: 'ค่าแรงเจ้าของ' },
  { id: 'transport', label: 'ขนส่ง/รถ' },
  { id: 'teardown', label: 'เก็บงาน/ขนส่งกลับ' },
  { id: 'other', label: 'อื่น ๆ' },
];
/** The categories to choose from: the built-in ones, with the shop's own just before "อื่น ๆ". */
export let COST_CATEGORIES = BUILT_IN_CATEGORIES;
/** Called with the signed-in shop's own categories (none when signed out). */
export function setShopCategories(own: Array<{ id: string; name: string }>) {
  COST_CATEGORIES = [...BUILT_IN_CATEGORIES.slice(0, -1), ...own.map((c) => ({ id: c.id as CostCategory, label: c.name })), BUILT_IN_CATEGORIES[BUILT_IN_CATEGORIES.length - 1]];
}
export const categoryLabel = (c: CostCategory | '') => COST_CATEGORIES.find((x) => x.id === c)?.label ?? 'อื่น ๆ';

export interface Rules {
  /** below this margin the job is High Risk (deck: RULE 1, Margin < 20%) */
  highRiskMargin: number;
  /** lowest margin worth accepting; also the bottom of the recommended price range */
  minMargin: number;
  /** comfortable margin; top of the recommended price range */
  goodMargin: number;
  /** usual deposit the shop asks for */
  depositPct: number;
  /** usual wage per team member per day, for quick checks and simulations */
  dailyWage: number;
  /** cost of one extra vehicle, for simulations */
  vehicleCost: number;
  /** actual labour above estimate by more than this % is a Labor Overrun (deck: RULE 3) */
  laborOverrunPct: number;
}

export const DEFAULT_RULES: Rules = {
  highRiskMargin: 20,
  minMargin: 25,
  goodMargin: 35,
  depositPct: 30,
  dailyWage: 800,
  vehicleCost: 2500,
  laborOverrunPct: 15,
};

export const withDefaults = (r?: Partial<Rules> | null): Rules => ({ ...DEFAULT_RULES, ...(r ?? {}) });

export interface JobCost {
  name: string;
  category: CostCategory;
  quantity: number;
  price: number;
  /** the heading it sits under; unplanned extras have none */
  groupId?: number | null;
  actual?: number | null;
  isExtra?: boolean;
}

/** a heading of costs with its own markup on cost, in % */
export interface JobGroup {
  id: number;
  name: string;
  markup: number;
}

export interface Job {
  costItems: JobCost[];
  /** every planned cost item sits under one of these; a job without any is priced at `profitMargin` as a whole */
  groups?: JobGroup[];
  /** markup on cost for the job as a whole, in % (stored as `profitMargin` for historical reasons) */
  profitMargin: number;
  /** what the client said they can spend; 0 = not given */
  budget: number;
  depositPct: number;
  setupDays: number;
  eventDays: number;
  laborDays: number | null;
  teamSize: number | null;
  /** the owner said their own labour is in the costs; an item in the "ค่าแรงเจ้าของ" category says so too */
  ownerLabor: boolean | null;
  /** same for teardown and the trip back, and the "เก็บงาน/ขนส่งกลับ" category */
  teardown: boolean | null;
  /** the price settled with the client (a job made from an accepted quote): fixed, so the margin follows from the costs */
  agreedPrice?: number | null;
}

export type Severity = 'high' | 'medium' | 'low';
export interface Risk {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

const estimate = (i: JobCost) => (i.isExtra ? 0 : i.quantity * i.price);

export const markupToMargin = (markup: number) => (markup <= -100 ? 0 : (markup / (100 + markup)) * 100);
export const marginToMarkup = (margin: number) => (margin >= 100 ? 10000 : (margin / (100 - margin)) * 100);
/** selling price that gives `margin`% on `cost` */
export const priceForMargin = (cost: number, margin: number) => (margin >= 100 ? Infinity : cost / (1 - margin / 100));

export function numbers(job: Job) {
  const worked = jobPricing(job.costItems, job.groups, job.profitMargin);
  const agreed = job.agreedPrice ?? null;
  const cost = worked.cost;
  // an agreed price stands whatever the costs are; each heading takes the share of it that its costs are of the total
  const price = agreed ?? worked.price;
  const priced = agreed === null ? worked.headings : worked.headings.map((g) => ({ ...g, price: cost > 0 ? agreed * (g.cost / cost) : 0, markup: cost > 0 ? (agreed / cost - 1) * 100 : 0 }));
  const profit = price - cost;
  const margin = price > 0 ? (profit / price) * 100 : 0;
  const deposit = price * (job.depositPct / 100);
  // what the shop has to find itself: every cost of the job, less the deposit the client pays up front
  const cashRequired = Math.max(0, cost - deposit);
  const headings = priced.map((g) => ({ ...g, profit: g.price - g.cost, margin: markupToMargin(g.markup) }));
  return { cost, price, profit, margin, cashRequired, deposit, headings };
}

/** money planned under one category, e.g. the owner's own labour */
export const categoryCost = (job: Job, c: CostCategory) => job.costItems.filter((i) => i.category === c).reduce((s, i) => s + estimate(i), 0);
/** job conditions are read off the cost categories; a "yes" given before those categories existed still counts */
export const hasOwnerLabor = (job: Job) => job.ownerLabor === true || categoryCost(job, 'owner_labor') > 0;
export const hasTeardown = (job: Job) => job.teardown === true || categoryCost(job, 'teardown') > 0;

/**
 * Each heading's markup after moving the whole job to `price`: every heading keeps its share of the
 * price. A job is never priced below its cost, and neither is a heading: one that would be is held at
 * its cost and the other headings make up the difference.
 */
export function repriced(job: Job, price: number): { groups: JobGroup[]; profitMargin: number } {
  const n = numbers(job);
  const groups = job.groups ?? [];
  const target = Math.max(price, n.cost);
  const profitMargin = n.cost > 0 ? (target / n.cost - 1) * 100 : job.profitMargin;
  if (!(n.cost > 0) || !(n.price > 0)) return { groups, profitMargin };
  // what the headings have to add up to: all of the price, unless some items sit outside every heading
  const headTarget = target * (n.headings.reduce((s, h) => s + h.price, 0) / n.price);
  const held = new Set<number>();
  let k = 1;
  for (;;) {
    const free = n.headings.filter((h) => !held.has(h.id));
    const freePrice = free.reduce((s, h) => s + h.price, 0);
    const heldCost = n.headings.reduce((s, h) => s + (held.has(h.id) ? h.cost : 0), 0);
    k = freePrice > 0 ? (headTarget - heldCost) / freePrice : 1;
    const under = free.filter((h) => h.cost > 0 && h.price * k < h.cost * (1 - 1e-9));
    if (under.length === 0) break;
    for (const h of under) held.add(h.id);
  }
  return { groups: groups.map((g) => ({ ...g, markup: held.has(g.id) ? 0 : Math.max(0, (1 + g.markup / 100) * k * 100 - 100) })), profitMargin };
}

/**
 * Each heading's markup after moving the whole job to `margin`%: the same as moving it to the price
 * that gives that margin, so headings with different margins stay different and the job as a whole
 * lands on the margin asked for. With nothing costed yet there is no price to share out, and every
 * heading takes the margin itself.
 */
export function remargined(job: Job, margin: number): { groups: JobGroup[]; profitMargin: number } {
  const target = Math.min(95, Math.max(0, margin));
  const n = numbers(job);
  if (n.cost > 0 && n.price > 0) return repriced(job, priceForMargin(n.cost, target));
  const markup = marginToMarkup(target);
  return { groups: (job.groups ?? []).map((g) => ({ ...g, markup })), profitMargin: markup };
}

/** Every rule that can flag a job before the quote goes out (Quote Health Check). */
export function risks(job: Job, rules: Rules): Risk[] {
  const n = numbers(job);
  const out: Risk[] = [];
  const timeline = job.setupDays + job.eventDays;
  const has = (c: CostCategory) => categoryCost(job, c) > 0;

  if (job.agreedPrice != null && n.cost === 0)
    out.push({ id: 'uncosted', severity: 'high', title: 'ยังไม่ได้ใส่ต้นทุน', detail: `งานนี้ตกลงราคากับลูกค้าแล้ว ${fmt(n.price)} บาท ใส่ต้นทุนของแต่ละรายการ ระบบถึงจะบอกกำไรได้` });
  else if (job.costItems.filter((i) => !i.isExtra).length === 0)
    out.push({ id: 'no-costs', severity: 'high', title: 'ยังไม่มีรายการต้นทุน', detail: 'ใส่ต้นทุนอย่างน้อยหนึ่งรายการ ระบบถึงจะคำนวณกำไรได้' });
  if (n.price > 0 && n.margin < rules.highRiskMargin)
    out.push({ id: 'margin-high-risk', severity: 'high', title: `Margin ${n.margin.toFixed(1)}% ต่ำกว่า ${rules.highRiskMargin}% — เสี่ยงสูง`, detail: `ราคาที่ควรเสนออย่างน้อย ${fmt(priceForMargin(n.cost, rules.minMargin))} บาท (Margin ${rules.minMargin}%)` });
  else if (n.price > 0 && n.margin < rules.minMargin)
    out.push({ id: 'margin-low', severity: 'medium', title: `Margin ${n.margin.toFixed(1)}% ต่ำกว่าเป้า ${rules.minMargin}%`, detail: `ขยับราคาเป็น ${fmt(priceForMargin(n.cost, rules.minMargin))} บาท จะได้ Margin ตามเป้า` });
  if (!hasOwnerLabor(job))
    out.push({ id: 'owner-labor', severity: 'medium', title: 'ยังไม่ได้ใส่ค่าแรงเจ้าของ', detail: 'เวลาของคุณคือต้นทุน ถ้าไม่คิด กำไรที่เห็นจะสูงกว่าความจริง — เพิ่มรายการในหมวด "ค่าแรงเจ้าของ"' });
  if (!hasTeardown(job))
    out.push({ id: 'teardown', severity: 'medium', title: 'ไม่มีค่าเก็บงานและขนส่งกลับ', detail: 'งานส่วนใหญ่ต้องรื้อถอนและขนของกลับหลังงาน — เพิ่มรายการในหมวด "เก็บงาน/ขนส่งกลับ"' });
  if (job.laborDays !== null && job.laborDays < timeline)
    out.push({ id: 'labor-days', severity: 'medium', title: `ค่าแรงคิด ${job.laborDays} วัน แต่ Timeline ${timeline} วัน`, detail: `รวมวันเซ็ตอัพ ${job.setupDays} วัน + วันงาน ${job.eventDays} วัน ค่าแรงควรครอบคลุมทุกวัน` });
  if (!has('labor') && !has('owner_labor'))
    out.push({ id: 'no-labor', severity: 'medium', title: 'ยังไม่มีรายการค่าแรง', detail: 'ใส่ค่าแรงทีมงาน (และค่าแรงตัวเอง) เป็นต้นทุนของงาน' });
  if (!has('transport') && !has('teardown'))
    out.push({ id: 'no-transport', severity: 'low', title: 'ยังไม่มีค่าขนส่ง', detail: 'ค่ารถ ค่าน้ำมัน และค่าทางด่วน มักถูกลืมใส่' });
  if (job.budget > 0 && n.price > job.budget)
    out.push({ id: 'over-budget', severity: 'low', title: `ราคาสูงกว่างบลูกค้า ${fmt(n.price - job.budget)} บาท`, detail: `ลูกค้ามีงบ ${fmt(job.budget)} บาท — ลองใช้หน้าจำลองสถานการณ์ เพื่อดูว่าลดได้แค่ไหน` });
  return out;
}

/** Job Health Check: one score + the four numbers the owner needs before saying yes. */
export function health(job: Job, rules: Rules) {
  const n = numbers(job);
  const list = risks(job, rules);
  let score = 100;
  // a price with no costs against it says nothing about profit yet
  if (n.price <= 0 || (job.agreedPrice != null && n.cost === 0)) score = 0;
  else if (n.margin < 0) score -= 60;
  else if (n.margin < rules.highRiskMargin) score -= 45;
  else if (n.margin < rules.minMargin) score -= 25;
  else if (n.margin < rules.goodMargin) score -= 10;
  for (const r of list) {
    if (r.id.startsWith('margin') || r.id === 'no-costs' || r.id === 'uncosted') continue; // already counted above
    score -= r.severity === 'high' ? 15 : r.severity === 'medium' ? 6 : 3;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: 'good' | 'watch' | 'risk' = score >= 75 ? 'good' : score >= 50 ? 'watch' : 'risk';
  return {
    ...n,
    score,
    level,
    label: level === 'good' ? 'สุขภาพกำไรดี' : level === 'watch' ? 'ต้องระวัง' : 'เสี่ยง',
    breakEven: n.cost,
    recommended: [priceForMargin(n.cost, rules.minMargin), priceForMargin(n.cost, rules.goodMargin)] as const,
    risks: list,
  };
}

// ---------- Can I Take This Job? ----------

export interface QuickAnswers {
  budget: number;
  materials: number;
  rentals: number;
  teamSize: number;
  workDays: number;
  dailyWage: number;
  ownerLabor: number;
  transport: number;
  teardownIncluded: boolean;
  depositPct: number;
}

/** Turns the 10 quick answers into a job priced at the client's budget. */
export function quickJob(a: QuickAnswers): Job {
  const all: JobCost[] = [
    { name: 'ดอกไม้และวัสดุ', category: 'material', quantity: 1, price: a.materials },
    { name: 'เช่าอุปกรณ์/พร็อพ', category: 'rental', quantity: 1, price: a.rentals },
    { name: `ค่าแรงทีม ${a.teamSize} คน × ${a.workDays} วัน`, category: 'labor', quantity: a.teamSize * a.workDays, price: a.dailyWage },
    { name: 'ค่าแรงเจ้าของ', category: 'owner_labor', quantity: 1, price: a.ownerLabor },
    // one figure covers the trip there and, when included, teardown and the trip back
    { name: a.teardownIncluded ? 'ขนส่งไป-กลับ และเก็บงาน' : 'ขนส่ง', category: 'transport', quantity: 1, price: a.transport },
  ];
  const items = all.filter((i) => i.quantity * i.price > 0);
  const cost = items.reduce((s, i) => s + i.quantity * i.price, 0);
  return {
    costItems: items,
    profitMargin: cost > 0 ? (a.budget / cost - 1) * 100 : 0,
    budget: a.budget,
    depositPct: a.depositPct,
    setupDays: Math.max(0, a.workDays - 1),
    eventDays: a.workDays > 0 ? 1 : 0,
    laborDays: a.workDays,
    teamSize: a.teamSize,
    ownerLabor: a.ownerLabor > 0,
    teardown: a.teardownIncluded,
  };
}

export type Verdict = 'take' | 'adjust' | 'risky';
export function canTakeJob(a: QuickAnswers, rules: Rules) {
  const job = quickJob(a);
  const n = numbers(job);
  const minPrice = priceForMargin(n.cost, rules.minMargin);
  const reasons: string[] = [];
  reasons.push(`ต้นทุนรวมโดยประมาณ ${fmt(n.cost)} บาท (ดอกไม้/วัสดุ ${fmt(a.materials)} + เช่า ${fmt(a.rentals)} + ค่าแรงทีม ${a.teamSize}×${a.workDays}×${fmt(a.dailyWage)} + ค่าแรงเจ้าของ ${fmt(a.ownerLabor)} + ขนส่ง ${fmt(a.transport)})`);
  reasons.push(`ที่งบ ${fmt(a.budget)} บาท จะเหลือกำไร ${fmt(n.profit)} บาท → Margin = ${fmt(n.profit)} ÷ ${fmt(a.budget)} = ${n.margin.toFixed(1)}%`);
  reasons.push(`เงินสดที่ต้องสำรองเอง ${fmt(n.cashRequired)} บาท = ต้นทุน ${fmt(n.cost)} − มัดจำ ${a.depositPct}% (${fmt(n.deposit)} บาท)`);
  if (a.ownerLabor <= 0) reasons.push('ยังไม่ได้คิดค่าแรงเจ้าของ — กำไรจริงจะน้อยกว่านี้');
  if (!a.teardownIncluded) reasons.push('ยังไม่รวมค่าเก็บงานและขนส่งกลับ');

  // what to change before saying yes, most important first
  const fixes: string[] = [];
  if (n.margin < rules.minMargin) fixes.push(`เสนอราคาอย่างน้อย ${fmt(minPrice)} บาท (Margin ${rules.minMargin}%)`);
  if (a.ownerLabor <= 0) fixes.push('ใส่ค่าแรงของคุณเองเป็นต้นทุน');
  if (!a.teardownIncluded) fixes.push('รวมค่าเก็บงานและขนส่งกลับในค่าขนส่ง');

  let verdict: Verdict;
  if (n.cost <= 0 || a.budget <= 0) verdict = 'risky';
  else if (n.margin < rules.highRiskMargin) verdict = 'risky';
  else if (n.margin < rules.minMargin || a.ownerLabor <= 0 || !a.teardownIncluded) verdict = 'adjust';
  else verdict = 'take';

  return { job, ...n, minPrice, verdict, reasons, fixes };
}

// ---------- Scenario Simulator ----------

export interface Scenario {
  /** client cuts the price by this % */
  budgetCutPct: number;
  /** flower/material cost goes up by this % */
  materialUpPct: number;
  extraTeam: number;
  extraSetupDays: number;
  extraVehicles: number;
}
export const NO_SCENARIO: Scenario = { budgetCutPct: 0, materialUpPct: 0, extraTeam: 0, extraSetupDays: 0, extraVehicles: 0 };

export function simulate(job: Job, s: Scenario, rules: Rules) {
  const before = numbers(job);
  const team = job.teamSize ?? 0;
  const days = job.setupDays + job.eventDays;
  const materialCost = job.costItems.filter((i) => i.category === 'material').reduce((t, i) => t + estimate(i), 0);
  const added = {
    material: materialCost * (s.materialUpPct / 100),
    team: s.extraTeam * days * rules.dailyWage,
    setup: s.extraSetupDays * (team + s.extraTeam) * rules.dailyWage,
    vehicles: s.extraVehicles * rules.vehicleCost,
  };
  const cost = before.cost + added.material + added.team + added.setup + added.vehicles;
  const price = before.price * (1 - s.budgetCutPct / 100);
  const profit = price - cost;
  const margin = price > 0 ? (profit / price) * 100 : 0;
  // the margin the owner wants to protect is their "good" margin from the business rules
  const target = rules.goodMargin;
  const maxCostForTarget = price * (1 - target / 100);
  const cutForTarget = Math.max(0, cost - maxCostForTarget);
  const cutForMin = Math.max(0, cost - price * (1 - rules.minMargin / 100));
  let advice: string;
  if (margin < rules.highRiskMargin) advice = `ไม่ควรรับในเงื่อนไขนี้ — Margin ต่ำกว่า ${rules.highRiskMargin}% ต้องลดต้นทุนอย่างน้อย ${fmt(cutForMin)} บาท หรือคงราคาเดิม`;
  else if (margin < rules.minMargin) advice = `เสี่ยง — Margin ต่ำกว่าขั้นต่ำ ${rules.minMargin}% ต้องลดต้นทุนอย่างน้อย ${fmt(cutForMin)} บาท หรือเจรจาราคากับลูกค้า`;
  else if (margin < target) advice = `ยังรับได้ แต่ควรลดต้นทุนอีก ${fmt(cutForTarget)} บาท เพื่อรักษา Margin ${target}%`;
  else advice = `รับได้ — Margin ยังสูงกว่า ${target}%`;
  return { before, after: { cost, price, profit, margin }, added, profitChange: profit - before.profit, target, maxCostForTarget, advice };
}

// ---------- Estimated vs Actual / Post-Event Review ----------

export function review(job: Job, rules: Rules) {
  const n = numbers(job);
  const actualOf = (i: JobCost) => (i.actual ?? null) !== null ? (i.actual as number) : estimate(i);
  const actualCost = job.costItems.reduce((s, i) => s + actualOf(i), 0);
  const actualProfit = n.price - actualCost;
  const lines = job.costItems
    .map((i) => ({ name: i.name || categoryLabel(i.category), category: i.category, estimate: estimate(i), actual: actualOf(i), isExtra: !!i.isExtra }))
    .map((l) => ({ ...l, diff: l.actual - l.estimate }));
  const overruns = lines.filter((l) => l.diff > 0.5).sort((a, b) => b.diff - a.diff);
  const savings = lines.filter((l) => l.diff < -0.5);
  const laborEst = lines.filter((l) => l.category === 'labor').reduce((s, l) => s + l.estimate, 0);
  const laborAct = lines.filter((l) => l.category === 'labor').reduce((s, l) => s + l.actual, 0);
  const laborOverrunPct = laborEst > 0 ? ((laborAct - laborEst) / laborEst) * 100 : 0;
  const recorded = job.costItems.some((i) => i.actual !== null && i.actual !== undefined) || job.costItems.some((i) => i.isExtra);
  return {
    quoted: n.price,
    expectedCost: n.cost,
    expectedProfit: n.profit,
    actualCost,
    actualProfit,
    actualMargin: n.price > 0 ? (actualProfit / n.price) * 100 : 0,
    lost: n.profit - actualProfit,
    overruns,
    savings,
    laborOverrunPct,
    laborOverrun: laborOverrunPct > rules.laborOverrunPct,
    recorded,
  };
}

/** Average overrun per category across jobs the owner chose to learn from. */
export function learnings(jobs: Job[]) {
  const per: Partial<Record<CostCategory, { est: number; act: number; jobs: number }>> = {};
  for (const job of jobs) {
    const seen = new Set<CostCategory>();
    for (const i of job.costItems) {
      const a = per[i.category] ?? (per[i.category] = { est: 0, act: 0, jobs: 0 });
      a.est += estimate(i);
      a.act += (i.actual ?? null) !== null ? (i.actual as number) : estimate(i);
      seen.add(i.category);
    }
    for (const c of seen) per[c]!.jobs++;
  }
  return (Object.entries(per) as Array<[CostCategory, { est: number; act: number; jobs: number }]>)
    .filter(([, v]) => v.est > 0)
    .map(([category, v]) => ({ category, overrunPct: ((v.act - v.est) / v.est) * 100, jobs: v.jobs }))
    .filter((l) => l.overrunPct >= 3)
    .sort((a, b) => b.overrunPct - a.overrunPct);
}

export function fmt(n: number) {
  return Math.round(n).toLocaleString('th-TH');
}
