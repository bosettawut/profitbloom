// Checks the decision engine against the worked examples in the product vision deck.
// Run: node --test tests/decision.test.ts   (Node strips the TypeScript types itself)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTakeJob,
  DEFAULT_RULES,
  conditionCost,
  conditionItems,
  hasOwnerLabor,
  hasTeardown,
  health,
  learnings,
  marginToMarkup,
  markupToMargin,
  numbers,
  remargined,
  repriced,
  review,
  risks,
  simulate,
  type Job,
} from '../src/lib/decision.ts';

const job = (over: Partial<Job> = {}): Job => ({
  costItems: [],
  profitMargin: 0,
  budget: 0,
  depositPct: 50,
  setupDays: 1,
  eventDays: 1,
  laborDays: 2,
  teamSize: 4,
  ownerLabor: true,
  teardown: true,
  ...over,
});
const item = (name: string, category: any, amount: number, groupId: number | null = null, actual: number | null = null) => ({
  name, category, quantity: 1, price: amount, groupId, actual,
});
/** markup that turns `cost` into `price` */
const markup = (cost: number, price: number) => (price / cost - 1) * 100;
const near = (a: number, b: number, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('margin is profit ÷ price, not the markup (slide 7: 280,000 / 205,000 → 26.8%)', () => {
  const j = job({ costItems: [item('รวม', 'material', 205000)], profitMargin: markup(205000, 280000) });
  const n = numbers(j);
  near(n.price, 280000);
  near(n.profit, 75000);
  near(n.margin, 26.8, 0.05);
  near(markupToMargin(30), 23.08, 0.01); // a 30% markup is only a 23% margin
});

test('Job Health Check: break-even and recommended range (slide 5: 238,000 → 315,000–365,000)', () => {
  const h = health(job({ costItems: [item('รวม', 'material', 238000)], profitMargin: markup(238000, 445000) }), DEFAULT_RULES);
  near(h.breakEven, 238000);
  near(h.recommended[0], 317333, 1); // 238,000 ÷ (1 − 25%)
  near(h.recommended[1], 366154, 1); // 238,000 ÷ (1 − 35%)
  near(h.margin, 46.5, 0.1);
  assert.equal(h.level, 'good');
});

test('Scenario Simulator (slide 6: 350,000 → 300,000, margin 46% → 37%, profit −50,000, max cost 180,000 at 40%)', () => {
  const cost = 350000 * 0.54; // 46% margin
  const j = job({ costItems: [item('รวม', 'material', cost)], profitMargin: markup(cost, 350000) });
  const r = simulate(j, { budgetCutPct: (50000 / 350000) * 100, materialUpPct: 0, extraTeam: 0, extraSetupDays: 0, extraVehicles: 0 }, { ...DEFAULT_RULES, goodMargin: 40 });
  near(r.after.price, 300000);
  near(r.before.margin, 46, 0.01);
  near(r.after.margin, 37, 0.01);
  near(r.profitChange, -50000);
  near(r.maxCostForTarget, 180000);
  assert.match(r.advice, /ยังรับได้ แต่ควรลดต้นทุนอีก 9,000 บาท/);
});

test('Scenario Simulator: margin under the shop minimum is called out as risky, not "still OK"', () => {
  const j = job({ costItems: [item('รวม', 'material', 65400)], profitMargin: markup(65400, 125769) });
  const r = simulate(j, { budgetCutPct: 33.33, materialUpPct: 0, extraTeam: 0, extraSetupDays: 0, extraVehicles: 0 }, DEFAULT_RULES);
  assert.ok(r.after.margin > 20 && r.after.margin < 25, String(r.after.margin));
  assert.match(r.advice, /^เสี่ยง — Margin ต่ำกว่าขั้นต่ำ 25%/);
});

test('Scenario Simulator adds team, setup day, vehicles and material price rises', () => {
  const j = job({ costItems: [item('ดอกไม้', 'material', 10000)], profitMargin: 100, teamSize: 2, setupDays: 1, eventDays: 1 });
  const r = simulate(j, { budgetCutPct: 0, materialUpPct: 20, extraTeam: 1, extraSetupDays: 1, extraVehicles: 1 }, DEFAULT_RULES);
  near(r.added.material, 2000);
  near(r.added.team, 1 * 2 * 800); // 1 person × 2 days
  near(r.added.setup, 1 * 3 * 800); // 1 day × 3 people
  near(r.added.vehicles, 2500);
});

test('Quote Health Check finds the risks on slide 7', () => {
  const j = job({
    costItems: [item('ดอกไม้', 'material', 150000), item('ทีม', 'labor', 40000), item('รถ', 'transport', 15000)],
    profitMargin: markup(205000, 280000),
    depositPct: 30,
    ownerLabor: false,
    teardown: false,
    setupDays: 2,
    eventDays: 1,
    laborDays: 1,
  });
  const ids = risks(j, DEFAULT_RULES).map((r) => r.id);
  for (const id of ['owner-labor', 'teardown', 'labor-days']) assert.ok(ids.includes(id), `missing ${id}: ${ids}`);
  assert.ok(risks(j, DEFAULT_RULES).find((r) => r.id === 'labor-days')!.title.includes('1 วัน แต่ Timeline 3 วัน'));
});

test('RULE 1 (slide 10): margin under 20% is High Risk', () => {
  const j = job({ costItems: [item('รวม', 'material', 100000)], profitMargin: markup(100000, 120000) }); // 16.7%
  const r = risks(j, DEFAULT_RULES).find((x) => x.id === 'margin-high-risk');
  assert.ok(r);
  assert.equal(r!.severity, 'high');
  assert.equal(health(j, DEFAULT_RULES).level, 'risk');
});

test('Cash to set aside = every cost of the job less the deposit (no "paid before" ticks, no warning of its own)', () => {
  const j = job({ costItems: [item('ดอกไม้', 'material', 60000), item('ทีม', 'labor', 40000)], profitMargin: 50, depositPct: 30 }); // price 150,000, deposit 45,000
  near(numbers(j).cashRequired, 55000);
  near(numbers({ ...j, depositPct: 100 }).cashRequired, 0); // never negative
  assert.ok(!risks(j, DEFAULT_RULES).some((r) => r.id === 'cash-flow'));
});

test('Headings: each has its own margin and the job price is their sum', () => {
  const j = job({
    groups: [{ id: 1, name: 'ดอกไม้', markup: marginToMarkup(40) }, { id: 2, name: 'ค่าแรง', markup: marginToMarkup(20) }, { id: 3, name: 'ว่าง', markup: 100 }],
    costItems: [item('กุหลาบ', 'material', 60000, 1), item('ทีม', 'labor', 40000, 2), { ...item('หน้างาน', 'other', 0), actual: 500, isExtra: true }],
    profitMargin: 999, // ignored once every item has a heading
  });
  const n = numbers(j);
  near(n.cost, 100000);
  near(n.headings[0].price, 100000);
  near(n.headings[1].price, 50000);
  near(n.headings[0].margin, 40, 1e-9);
  near(n.headings[2].price, 0);
  near(n.price, 150000);
  near(n.margin, 100 / 3, 1e-9);
  // warnings stay at job level: 33.3% overall is fine even though one heading is at 20%
  assert.ok(!risks(j, DEFAULT_RULES).some((r) => r.id.startsWith('margin')));
});

test('Headings: moving the job to a new price keeps every heading\'s share, never below cost', () => {
  const j = job({
    groups: [{ id: 1, name: 'ดอกไม้', markup: marginToMarkup(40) }, { id: 2, name: 'ค่าแรง', markup: marginToMarkup(20) }],
    costItems: [item('กุหลาบ', 'material', 60000, 1), item('ทีม', 'labor', 40000, 2)],
  });
  const r = repriced(j, 120000);
  const n = numbers({ ...j, groups: r.groups });
  near(n.price, 120000, 1e-6);
  near(n.headings[0].price, 80000, 1e-6);
  near(n.headings[1].price, 40000, 1e-6);
  near(r.profitMargin, 20, 1e-9);
  near(numbers({ ...j, groups: repriced(j, 50000).groups }).price, 100000, 1e-6);
});

test('Headings: a new overall margin is shared out, so headings with different margins stay different', () => {
  const j = job({
    groups: [{ id: 1, name: 'รายการต้นทุน', markup: marginToMarkup(35) }, { id: 2, name: 'test', markup: marginToMarkup(14) }],
    costItems: [item('ดอกไม้และวัสดุ', 'material', 10000, 1), item('ค่าแรงทีมงาน', 'labor', 10000, 1), item('ขนส่ง', 'transport', 100, 1), item('ดอกไม้', 'material', 10000, 2)],
  });
  const before = numbers(j);
  near(before.margin, 29.26, 0.01);
  const r = remargined(j, 35);
  const n = numbers({ ...j, groups: r.groups });
  near(n.margin, 35, 1e-9);
  near(n.price, 30100 / 0.65, 1e-6);
  // both headings went up, and each still has the share of the price it had before
  near(n.headings[0].margin, 40.27, 0.01);
  near(n.headings[1].margin, 20.97, 0.01);
  near(n.headings[0].price / n.price, before.headings[0].price / before.price, 1e-12);
  near(r.profitMargin, (n.price / 30100 - 1) * 100, 1e-9);
  // the same as typing the price that gives 35%
  assert.deepEqual(r, repriced(j, 30100 / 0.65));
});

test('Headings: lowering the overall margin never takes a heading below its cost', () => {
  const j = job({
    groups: [{ id: 1, name: 'ก', markup: marginToMarkup(35) }, { id: 2, name: 'ข', markup: marginToMarkup(14) }, { id: 3, name: 'ว่าง', markup: marginToMarkup(5) }],
    costItems: [item('ดอกไม้', 'material', 20100, 1), item('ทีม', 'labor', 10000, 2)],
  });
  const n = numbers({ ...j, groups: remargined(j, 10).groups });
  near(n.margin, 10, 1e-9);
  // the 14% heading cannot give up enough, so it stops at its cost and the other one covers the rest
  near(n.headings[1].price, 10000, 1e-6);
  near(n.headings[1].margin, 0, 1e-9);
  near(n.headings[0].price, 30100 / 0.9 - 10000, 1e-6);
  assert.ok(remargined(j, 10).groups.every((g) => g.markup >= 0));
  // all the way down: every heading at its cost
  const flat = numbers({ ...j, groups: remargined(j, 0).groups });
  near(flat.price, 30100, 1e-6);
  near(flat.headings[0].margin, 0, 1e-9);
});

test('Headings: with equal margins, or nothing costed yet, every heading takes the overall margin', () => {
  const equal = job({
    groups: [{ id: 1, name: 'ก', markup: marginToMarkup(35) }, { id: 2, name: 'ข', markup: marginToMarkup(35) }],
    costItems: [item('ดอกไม้', 'material', 7000, 1), item('ทีม', 'labor', 3000, 2)],
  });
  for (const g of remargined(equal, 25).groups) near(markupToMargin(g.markup), 25, 1e-9);
  const empty = job({ groups: [{ id: 1, name: 'ก', markup: marginToMarkup(35) }, { id: 2, name: 'ข', markup: marginToMarkup(14) }] });
  const r = remargined(empty, 30);
  for (const g of r.groups) near(markupToMargin(g.markup), 30, 1e-9);
  near(r.profitMargin, marginToMarkup(30), 1e-9);
  // out-of-range margins are held to 0–95
  near(numbers({ ...equal, groups: remargined(equal, 120).groups }).margin, 95, 1e-9);
  near(numbers({ ...equal, groups: remargined(equal, -5).groups }).margin, 0, 1e-9);
});

test('Job conditions come from the cost categories', () => {
  const base = job({ ownerLabor: null, teardown: null, costItems: [item('ดอกไม้', 'material', 1000), item('ทีม', 'labor', 1000), item('รถ', 'transport', 500)] });
  const ids = (j: any) => risks(j, DEFAULT_RULES).map((r) => r.id);
  assert.ok(ids(base).includes('owner-labor') && ids(base).includes('teardown'));
  const filled = { ...base, costItems: [...base.costItems, item('ค่าแรงตัวเอง', 'owner_labor', 3000), item('เก็บงาน', 'teardown', 2000)] };
  assert.ok(!ids(filled).includes('owner-labor') && !ids(filled).includes('teardown'));
  assert.equal(hasOwnerLabor(filled), true);
  assert.equal(hasTeardown(base), false);
  // a zero-baht line does not count, and a "yes" saved before the categories existed still does
  assert.ok(ids({ ...base, costItems: [...base.costItems, item('ค่าแรงตัวเอง', 'owner_labor', 0)] }).includes('owner-labor'));
  assert.ok(!ids({ ...base, ownerLabor: true, teardown: true }).some((id) => id === 'owner-labor' || id === 'teardown'));
});

test('Job conditions are also recognised by what a row is called, whatever its category', () => {
  const base = job({ ownerLabor: null, teardown: null, costItems: [item('ดอกไม้', 'material', 1000), item('ทีม', 'labor', 1000), item('รถ', 'transport', 500)] });
  const ids = (j: any) => risks(j, DEFAULT_RULES).map((r) => r.id);
  const withRows = (...rows: ReturnType<typeof item>[]) => ({ ...base, costItems: [...base.costItems, ...rows] });

  // the owner's labour typed as an ordinary labour row
  const owner = withRows(item('ค่าแรงเจ้าของ', 'labor', 3000));
  assert.equal(hasOwnerLabor(owner), true);
  assert.equal(conditionCost(owner, 'owner_labor'), 3000);
  assert.ok(!ids(owner).includes('owner-labor') && ids(owner).includes('teardown'));
  // spaces in the name, more words around it, and no category chosen at all
  assert.equal(hasOwnerLabor(withRows(item('ค่าแรง เจ้าของ (2 วัน)', 'other', 1500))), true);
  assert.equal(hasOwnerLabor(withRows(item('ค่าแรงเจ้าของ', 'other', 1500))), true);

  // teardown by either of its words
  assert.equal(hasTeardown(withRows(item('เก็บงานหลังเลิก', 'labor', 800))), true);
  assert.equal(hasTeardown(withRows(item('รถขนส่งกลับร้าน', 'transport', 1200))), true);
  assert.equal(conditionCost(withRows(item('เก็บงาน', 'labor', 800), item('ขนส่งกลับ', 'transport', 1200), item('รื้อถอน', 'teardown', 500)), 'teardown'), 2500);

  // near misses do not count
  assert.equal(hasOwnerLabor(withRows(item('ค่าแรงทีมงาน', 'labor', 3000))), false);
  assert.equal(hasTeardown(withRows(item('ขนส่งไปงาน', 'transport', 1200))), false);

  // a row that is named but has no amount is listed, yet the condition is not met
  const empty = withRows(item('ค่าแรงเจ้าของ', 'labor', 0));
  assert.equal(conditionItems(empty, 'owner_labor').length, 1);
  assert.equal(hasOwnerLabor(empty), false);
  assert.ok(ids(empty).includes('owner-labor'));

  // an owner's-labour row under another category also answers "is there any labour at all"
  const onlyOwner = job({ ownerLabor: null, teardown: null, costItems: [item('ดอกไม้', 'material', 1000), item('ค่าแรงเจ้าของ', 'other', 2000)] });
  assert.ok(!ids(onlyOwner).includes('no-labor'));
});

test('RULE 3 (slide 10) + Post-Event Review (slide 9: expected 98,000 → actual 61,500, lost 36,500)', () => {
  const cost = 280000 - 98000;
  const j = job({
    costItems: [
      { ...item('ดอกไม้', 'material', 100000), actual: 112000 },
      { ...item('ทีม', 'labor', 50000), actual: 58500 },
      { ...item('รถขนส่ง', 'transport', 32000), actual: 38000 },
      { name: 'ซื้อของหน้างาน', category: 'other', quantity: 0, price: 0, actual: 10000, isExtra: true },
    ],
    profitMargin: markup(cost, 280000),
  });
  const r = review(j, DEFAULT_RULES);
  near(r.expectedProfit, 98000);
  near(r.actualProfit, 61500);
  near(r.lost, 36500);
  assert.deepEqual(r.overruns.map((o) => [o.name, Math.round(o.diff)]), [
    ['ดอกไม้', 12000],
    ['ซื้อของหน้างาน', 10000],
    ['ทีม', 8500],
    ['รถขนส่ง', 6000],
  ]);
  near(r.laborOverrunPct, 17);
  assert.equal(r.laborOverrun, true); // 17% > 15%
});

test('Can I Take This Job?: take / adjust / risky', () => {
  const base = { budget: 100000, materials: 30000, rentals: 5000, teamSize: 3, workDays: 2, dailyWage: 800, ownerLabor: 3000, transport: 3000, teardownIncluded: true, depositPct: 50 };
  assert.equal(canTakeJob(base, DEFAULT_RULES).verdict, 'take'); // cost 45,800 → margin 54%
  assert.equal(canTakeJob({ ...base, ownerLabor: 0 }, DEFAULT_RULES).verdict, 'adjust'); // owner labour missing
  const tight = canTakeJob({ ...base, budget: 58000 }, DEFAULT_RULES); // margin 21% (between 20 and 25)
  assert.equal(tight.verdict, 'adjust');
  near(tight.minPrice, 45800 / 0.75, 1);
  assert.equal(canTakeJob({ ...base, budget: 50000 }, DEFAULT_RULES).verdict, 'risky'); // margin 8%
});

test('Learning loop: average overrun per category from reviewed jobs', () => {
  const a = job({ costItems: [{ ...item('ดอกไม้', 'material', 100), actual: 112 }, { ...item('ทีม', 'labor', 100), actual: 100 }] });
  const b = job({ costItems: [{ ...item('ดอกไม้', 'material', 100), actual: 108 }] });
  const l = learnings([a, b]);
  assert.equal(l.length, 1);
  assert.equal(l[0].category, 'material');
  near(l[0].overrunPct, 10);
  assert.equal(l[0].jobs, 2);
});

test('A job taken at an agreed price: the price stands and the margin follows from the costs', () => {
  const groups = [{ id: 1, name: 'ดอกไม้', markup: 80 }, { id: 2, name: 'ทีมงาน', markup: 10 }];
  const item = (groupId: number, price: number) => ({ name: 'x', category: 'material' as const, quantity: 1, price, groupId });

  // no costs yet: the price is known, the profit is not
  const empty = job({ agreedPrice: 45000, groups, costItems: [item(1, 0), item(2, 0)] });
  assert.equal(numbers(empty).price, 45000);
  assert.equal(health(empty, DEFAULT_RULES).score, 0);
  assert.ok(risks(empty, DEFAULT_RULES).some((r) => r.id === 'uncosted' && r.severity === 'high'));

  // costs of 30,000: still 45,000, whatever markups the headings carry; each heading gets its share
  const costed = job({ agreedPrice: 45000, groups, costItems: [item(1, 20000), item(2, 10000)] });
  const n = numbers(costed);
  assert.equal(n.price, 45000);
  assert.equal(n.profit, 15000);
  assert.ok(Math.abs(n.margin - 33.333) < 0.01);
  assert.deepEqual(n.headings.map((h) => Math.round(h.price)), [30000, 15000]);
  assert.ok(!risks(costed, DEFAULT_RULES).some((r) => r.id === 'uncosted'));

  // costs above the price: a loss, not a higher price
  const loss = numbers(job({ agreedPrice: 45000, groups, costItems: [item(1, 40000), item(2, 10000)] }));
  assert.equal(loss.price, 45000);
  assert.equal(loss.profit, -5000);
});
