// End-to-end API checks for ProfitBloom. Run with `npm test` (starts its own server on a throwaway database).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import pg from 'pg';

const BASE = process.env.BASE;
const PROJECT_DIR = process.env.PROJECT_DIR;
const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra });
/** straight into the test database, for a state no request can produce (rows as an older version left them) */
const sql = async (text, params = []) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows;
  } finally {
    await db.end();
  }
};

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(BASE + '/api' + url, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(cookie && { cookie }) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
  return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

const A = client(), B = client(), ADM = client(), A2 = client();
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const thisMonth = iso(new Date(today.getFullYear(), today.getMonth(), 15));
const past = iso(new Date(Date.now() - 3 * 864e5));

// --- auth
let r = await A.call('GET', '/projects');
ok('ไม่ login เรียกข้อมูลไม่ได้ (401)', r.status === 401);
r = await A.call('POST', '/auth/register', { name: '', email: 'a@x.test', password: 'password123' });
ok('สมัคร: ไม่กรอกชื่อ ถูกปฏิเสธ', r.status === 400);
r = await A.call('POST', '/auth/register', { name: 'A', email: 'not-an-email', password: 'password123' });
ok('สมัคร: อีเมลผิดรูปแบบ ถูกปฏิเสธ', r.status === 400);
r = await A.call('POST', '/auth/register', { name: 'A', email: 'a@x.test', password: 'short' });
ok('สมัคร: รหัสสั้นกว่า 8 ถูกปฏิเสธ', r.status === 400);
r = await A.call('POST', '/auth/register', { name: 'ร้านเอ', email: 'A@X.test', password: 'password123' });
ok('สมัครสำเร็จ + เริ่มที่ Free Trial + role shop', r.status === 200 && r.data.user.plan === 'trial' && r.data.user.role === 'shop', JSON.stringify(r.data));
{
  const days = (new Date(r.data.user.trialEndsAt) - Date.now()) / 864e5;
  ok('ทดลองใช้ฟรี 30 วันนับจากวันสมัคร', days > 29.9 && days <= 30, days);
}
r = await B.call('POST', '/auth/register', { name: 'B', email: 'a@x.test', password: 'password123' });
ok('สมัครซ้ำอีเมลเดิม (ตัวพิมพ์ต่างกัน) ถูกปฏิเสธ', r.status === 409);
r = await B.call('POST', '/auth/register', { name: 'ร้านบี', email: 'b@x.test', password: 'password123' });
ok('สมัครร้านที่สอง', r.status === 200);
r = await A2.call('POST', '/auth/login', { email: 'a@x.test', password: 'wrong-pass' });
ok('login รหัสผิด ถูกปฏิเสธ', r.status === 401);
r = await A2.call('POST', '/auth/login', { email: 'a@x.test', password: 'password123' });
ok('login อีกเครื่องได้', r.status === 200);

// --- projects
r = await A.call('POST', '/projects', { title: '' });
ok('สร้างโปรเจ็กต์ไม่มีชื่อ ถูกปฏิเสธ', r.status === 400);
r = await A.call('POST', '/projects', {
  title: 'งานแต่ง 1', projectType: 'งานแต่งงาน', client: 'ลูกค้า1', eventDate: thisMonth, budget: 50000, profitMargin: 25,
  costItems: [{ name: 'ดอกไม้', quantity: 10, price: 100 }, { name: 'ค่าแรง', quantity: 1, price: 1000 }],
});
const p1 = r.data;
ok('สร้างโปรเจ็กต์ + รหัส WD-ปี-001', r.status === 201 && /^WD-\d{4}-001$/.test(p1.code), p1?.code);
ok('ต้นทุนรวมถูกต้อง (2,000)', p1.costItems.reduce((s, i) => s + i.total, 0) === 2000);
r = await A.call('POST', '/projects', { title: 'งานแต่ง 2', projectType: 'งานแต่งงาน', client: 'ลูกค้า2' });
ok('รหัสโปรเจ็กต์ถัดไปเป็น 002', r.data.code.endsWith('-002'), r.data.code);
const p2 = r.data;
r = await A.call('POST', '/projects', { title: 'งานอื่น', projectType: 'อื่นๆ', costItems: [{ name: 'x', quantity: -5, price: -10 }] });
ok('ประเภทอื่นๆ ได้รหัส EV + จำนวน/ราคาติดลบถูกปรับเป็น 0', r.data.code.startsWith('EV-') && r.data.costItems[0].quantity === 0 && r.data.costItems[0].price === 0, JSON.stringify(r.data.costItems));

// decision-engine data round-trips
r = await A.call('POST', '/projects', {
  title: 'งานทดสอบเงื่อนไข', projectType: 'งานแต่งงาน', profitMargin: 50, depositPct: 45, setupDays: 2, eventDays: 1, laborDays: 3, teamSize: 4,
  ownerLabor: true, teardown: false,
  costItems: [
    { name: 'ดอกไม้', category: 'material', quantity: 1, price: 1000 },
    { name: 'ทีม', category: 'labor', quantity: 2, price: 800, actual: 1900 },
    { name: 'แปลก', category: 'hacker', quantity: 1, price: 10 },
  ],
});
{
  const d = r.data;
  ok('บันทึกเงื่อนไขงาน (มัดจำ/วันเซ็ตอัพ/ทีม/ค่าแรงเจ้าของ/เก็บงาน)', d.depositPct === 45 && d.setupDays === 2 && d.laborDays === 3 && d.teamSize === 4 && d.ownerLabor === true && d.teardown === false, JSON.stringify(d));
  ok('บันทึกหมวดและต้นทุนจริง และไม่มีช่อง "จ่ายก่อนงาน" แล้ว', d.costItems[1].category === 'labor' && d.costItems[1].actual === 1900 && !('paidBefore' in d.costItems[1]), JSON.stringify(d.costItems[1]));
  ok('ไม่ได้ส่งหัวข้อมา → ทุกรายการอยู่ในหัวข้อเดียว ที่ markup ของงาน', d.costGroups.length === 1 && d.costGroups[0].markup === 50 && d.costItems.every((i) => i.groupId === d.costGroups[0].id), JSON.stringify(d.costGroups));
  ok('หมวดที่ไม่มีอยู่จริงถูกปรับเป็น material', d.costItems[2].category === 'material');
  ok('ไม่ได้ส่งหน่วยมา → หน่วยว่าง', d.costItems.every((i) => i.unit === ''), JSON.stringify(d.costItems.map((i) => i.unit)));
  {
    const u = await A.call('POST', '/projects', {
      title: 'งานทดสอบหน่วย', profitMargin: 50,
      costItems: [
        { name: 'กุหลาบ', category: 'material', quantity: 200, unit: '  ดอก  ', price: 25 },
        { name: 'ยังไม่เลือกหมวด', category: '', quantity: 1, unit: 'x'.repeat(50), price: 10 },
        { name: 'ไม่ส่งหมวด', quantity: 3, unit: 7, price: 10 },
      ],
    });
    const [a, b, c] = u.data.costItems;
    ok('หน่วยของรายการถูกบันทึก (ตัดช่องว่างหัวท้าย) และไม่กระทบยอดรวม', u.status === 201 && a.unit === 'ดอก' && a.total === 5000, JSON.stringify(a));
    ok('หน่วยยาวเกิน 30 ตัวอักษรถูกตัด หน่วยที่ไม่ใช่ข้อความกลายเป็นว่าง', b.unit.length === 30 && c.unit === '', `${b.unit.length} / ${JSON.stringify(c.unit)}`);
    ok('หมวดว่าง (ยังไม่เลือก) ถูกเก็บเป็นว่าง ส่วนที่ไม่ได้ส่งหมวดมายังเป็น material', b.category === '' && c.category === 'material', `${JSON.stringify(b.category)} / ${c.category}`);
    const again = await A.call('PUT', `/projects/${u.data.id}`, { costGroups: u.data.costGroups, costItems: u.data.costItems.map((i) => (i.name === 'กุหลาบ' ? { ...i, unit: 'กำ' } : i)) });
    ok('แก้หน่วยแล้วบันทึก → ได้หน่วยใหม่ รายการอื่นคงเดิม', again.data.costItems[0].unit === 'กำ' && again.data.costItems[1].category === '' && again.data.costItems.length === 3, JSON.stringify(again.data.costItems.map((i) => [i.unit.slice(0, 5), i.category])));
    await A.call('DELETE', `/projects/${u.data.id}`);
  }
  r = await A.call('PUT', `/projects/${d.id}`, { costItems: [...d.costItems, { name: 'ซื้อหน้างาน', category: 'other', quantity: 0, price: 0, actual: 500, isExtra: true }], reviewApplied: true });
  ok('เพิ่มค่าใช้จ่ายนอกแผน + บันทึกบทเรียน', r.data.costItems.at(-1).isExtra === true && r.data.reviewApplied === true && !!r.data.reviewedAt, JSON.stringify(r.data.costItems.at(-1)));
  ok('ค่าใช้จ่ายนอกแผนไม่อยู่ในหัวข้อ รายการเดิมยังอยู่ในหัวข้อเดิม', r.data.costItems.at(-1).groupId === null && r.data.costGroups.length === 1 && r.data.costItems.slice(0, 3).every((i) => i.groupId === r.data.costGroups[0].id), JSON.stringify(r.data.costItems.map((i) => i.groupId)));
  r = await A.call('PUT', `/projects/${d.id}`, { notes: 'x' });
  ok('แก้ช่องอื่น เงื่อนไขงานไม่หาย', r.data.depositPct === 45 && r.data.ownerLabor === true && r.data.costItems.length === 4);
  await A.call('DELETE', `/projects/${d.id}`);
}
r = await A.call('PUT', '/account', { name: 'ร้านเอ', rules: { minMargin: 30, goodMargin: 40, highRiskMargin: 15, dailyWage: 900, bogus: 1 } });
ok('บันทึกกติกาธุรกิจของร้าน', r.data.user.rules.minMargin === 30 && r.data.user.rules.dailyWage === 900 && !('bogus' in r.data.user.rules), JSON.stringify(r.data.user.rules));
r = await A.call('PUT', '/account', { name: 'ร้านเอ', rules: { minMargin: 40, goodMargin: 30 } });
ok('กติกาขัดกันเอง (ขั้นต่ำ > ที่ดี) ถูกปฏิเสธ', r.status === 400);
r = await B.call('GET', '/auth/me');
ok('กติกาของร้าน A ไม่กระทบร้าน B', Object.keys(r.data.user.rules).length === 0);

// isolation
r = await B.call('GET', `/projects/${p1.id}`);
ok('ร้าน B อ่านโปรเจ็กต์ของ A ไม่ได้', r.status === 404);
r = await B.call('PUT', `/projects/${p1.id}`, { title: 'hacked' });
ok('ร้าน B แก้โปรเจ็กต์ของ A ไม่ได้', r.status === 404);
r = await B.call('DELETE', `/projects/${p1.id}`);
ok('ร้าน B ลบโปรเจ็กต์ของ A ไม่ได้', r.status === 404);
r = await B.call('GET', '/projects');
ok('รายการโปรเจ็กต์ของ B ไม่มีของ A', r.data.length === 0);
r = await B.call('POST', '/quotes', { clientName: 'x', projectId: p1.id });
ok('ร้าน B ผูกใบเสนอราคากับโปรเจ็กต์ของ A ไม่ได้', r.status === 404);

r = await A.call('PUT', `/projects/${p1.id}`, { notes: 'แก้ไขหมายเหตุ' });
ok('แก้บางช่อง ข้อมูลอื่น + รายการต้นทุนยังอยู่', r.data.notes === 'แก้ไขหมายเหตุ' && r.data.costItems.length === 2 && r.data.title === 'งานแต่ง 1');
r = await A.call('PUT', `/projects/${p1.id}`, { status: 'bogus' });
ok('สถานะที่ไม่มีอยู่จริงไม่ถูกบันทึก', r.data.status === 'draft');

// --- quotes
r = await A.call('POST', '/quotes', { clientName: '' });
ok('ใบเสนอราคาไม่มีชื่อลูกค้า ถูกปฏิเสธ', r.status === 400);
// a quote made for a job follows the job: what it lists and what it comes to are the job's, not the caller's
r = await A.call('POST', '/quotes', {
  projectId: p1.id, clientName: 'ลูกค้า1', projectTitle: 'งานแต่ง 1', validUntil: iso(new Date(Date.now() + 10 * 864e5)),
  taxRate: 7, discountRate: 10, items: [{ description: 'แพ็กดอกไม้', quantity: 2, unitPrice: 1000 }],
});
const q1 = r.data;
ok('ใบเสนอราคาของโปรเจ็กต์ตามโปรเจ็กต์: ได้หัวข้อละบรรทัดในราคาโปรเจ็กต์ (2,000 + 25% = 2,500) รายการและส่วนลดที่ส่งมาไม่ถูกใช้',
  r.status === 201 && q1.followsProject === true && q1.lockedPrice === 2500 && q1.discountRate === 0 && q1.items.length === 1 && q1.items[0].description === 'รายการต้นทุน' && q1.items[0].unitPrice === 2500,
  JSON.stringify([r.status, q1.followsProject, q1.lockedPrice, q1.discountRate, q1.items]));
ok('สร้างใบเสนอราคา + รหัส QT', r.status === 201 && /^QT-\d{4}-001$/.test(q1.code), q1?.code);
ok('ยอดรวม: 2,500 + VAT 7% = 2,675', q1.totalAmount === 2675 && q1.vatMode === 'exclusive', q1.totalAmount);
ok('ใบบอกว่าตามโปรเจ็กต์ไหน และตรงกับโปรเจ็กต์อยู่', q1.job?.id === p1.id && q1.job.code === p1.code && q1.job.price === 2500 && q1.job.inStep === true, JSON.stringify(q1.job));
r = await A.call('POST', '/quotes', { projectId: p1.id, clientName: 'ลูกค้า1', items: [{ description: 'อีกใบ', quantity: 1, unitPrice: 2500 }] });
ok('โปรเจ็กต์หนึ่งมีใบเสนอราคาที่ผูกไว้ใบเดียว: สร้างใบที่สองถูกปฏิเสธ และบอกรหัสใบเดิม', r.status === 400 && r.data.error.includes(q1.code), JSON.stringify(r.data));
r = await A.call('GET', `/projects/${p1.id}`);
ok('สร้างใบเสนอราคา → โปรเจ็กต์เป็น "สร้างใบเสนอราคาแล้ว" และบอกใบที่ผูกไว้', r.data.status === 'quote_created' && r.data.quote?.id === q1.id && r.data.quote.code === q1.code && r.data.quote.status === 'draft', JSON.stringify([r.data.status, r.data.quote]));
r = await A.call('GET', '/projects');
ok('รายการโปรเจ็กต์บอกใบที่ผูกไว้ด้วย', r.data.find((x) => x.id === p1.id)?.quote?.code === q1.code);
r = await A.call('PUT', `/quotes/${q1.id}`, { status: 'sent' });
r = await A.call('GET', `/projects/${p1.id}`);
ok('ส่งใบเสนอราคา → โปรเจ็กต์ "รอการอนุมัติ"', r.data.status === 'pending', r.data.status);
r = await A.call('PUT', `/quotes/${q1.id}`, { status: 'approved' });
r = await A.call('GET', `/projects/${p1.id}`);
ok('อนุมัติใบเสนอราคา → โปรเจ็กต์ "อนุมัติแล้ว"', r.data.status === 'approved', r.data.status);
r = await A.call('PUT', `/quotes/${q1.id}`, { notes: 'แก้หมายเหตุ' });
ok('แก้ใบเสนอราคาโดยไม่ส่งสถานะ สถานะเดิมยังอยู่', r.data.status === 'approved' && r.data.items.length === 1);
r = await B.call('GET', `/quotes/${q1.id}`);
ok('ร้าน B อ่านใบเสนอราคาของ A ไม่ได้', r.status === 404);
r = await B.call('PUT', `/quotes/${q1.id}`, { status: 'rejected' });
ok('ร้าน B แก้ใบเสนอราคาของ A ไม่ได้', r.status === 404);

// --- numbers: one run per shop, per kind and per year (the year as it is in Thailand); a number is never handed out twice
{
  const bangkok = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(new Date()));
  const n = (code) => Number(code.split('-').pop());
  ok('ปีในเลขเอกสารเป็นปีตามเวลาไทย', q1.code.startsWith(`QT-${bangkok}-`) && p1.code.startsWith(`WD-${bangkok}-`), [q1.code, p1.code].join());
  const bq = (await B.call('POST', '/quotes', { clientName: 'ลูกค้าร้านบี' })).data;
  ok('ร้านอื่นมีเลขของตัวเอง เริ่มที่ 001', bq.code === `QT-${bangkok}-001`, bq.code);
  const a1 = (await A.call('POST', '/quotes', { clientName: 'ลูกค้าเลขที่' })).data;
  const a2 = (await A.call('POST', '/quotes', { clientName: 'ลูกค้าเลขที่' })).data;
  await A.call('DELETE', `/quotes/${a2.id}`);
  const a3 = (await A.call('POST', '/quotes', { clientName: 'ลูกค้าเลขที่' })).data;
  ok('ลบใบเสนอราคาใบล่าสุดแล้ว ใบถัดไปไม่ใช้เลขที่ลบไปซ้ำ', n(a2.code) === n(a1.code) + 1 && n(a3.code) === n(a2.code) + 1, [a1.code, a2.code, a3.code].join(' → '));
  const w1 = (await A.call('POST', '/projects', { title: 'งานเลขที่', projectType: 'งานแต่งงาน' })).data;
  await A.call('DELETE', `/projects/${w1.id}`);
  const w2 = (await A.call('POST', '/projects', { title: 'งานเลขที่ 2', projectType: 'งานแต่งงาน' })).data;
  const e1 = (await A.call('POST', '/projects', { title: 'งานหมั้นเลขที่', projectType: 'งานหมั้น' })).data;
  ok('ลบโปรเจ็กต์ล่าสุดแล้ว โปรเจ็กต์ถัดไปก็ข้ามเลขที่ลบไป และแต่ละประเภทงานรันเลขของตัวเอง', n(w2.code) === n(w1.code) + 1 && w2.code.startsWith(`WD-${bangkok}-`) && e1.code === `EN-${bangkok}-001`, [w1.code, w2.code, e1.code].join(' · '));
  const bq2 = (await B.call('POST', '/quotes', { clientName: 'ลูกค้าร้านบี' })).data;
  ok('เลขของร้าน B ไม่ถูกกระทบจากร้าน A (002)', bq2.code === `QT-${bangkok}-002`, bq2.code);
  for (const q of [a1, a3]) await A.call('DELETE', `/quotes/${q.id}`);
  for (const p of [w2, e1]) await A.call('DELETE', `/projects/${p.id}`);
  for (const q of [bq, bq2]) await B.call('DELETE', `/quotes/${q.id}`);
}

r = await A.call('POST', '/quotes', { clientName: 'หมดอายุ', validUntil: past, status: 'sent' });
ok('ใบเสนอราคาเลยวันหมดอายุ แสดงเป็น "หมดอายุ"', r.data.status === 'expired', r.data.status);
const qExp = r.data;
r = await A.call('PUT', `/quotes/${qExp.id}`, { status: 'approved' });
ok('ใบที่หมดอายุยังอนุมัติได้', r.data.status === 'approved');

// --- quote arithmetic: whole baht, VAT modes, locked price
{
  const make = (body) => A.call('POST', '/quotes', { clientName: 'ลูกค้าคำนวณ', ...body });
  r = await make({ taxRate: 7, discountRate: 10, items: [{ description: 'a', quantity: 2, unitPrice: 1000 }] });
  ok('บวก VAT: 2,000 -10% +7% = 1,926', r.data.totalAmount === 1926, r.data.totalAmount);
  const plain = r.data;
  r = await make({ taxRate: 7, rounding: 'baht', items: [{ description: 'a', quantity: 3, unitPrice: 33.33 }, { description: 'b', quantity: 1, unitPrice: 10.5 }] });
  ok('กติกาเดิม (ใบเก่า) ปัดบาทเต็มทุกยอด: 99.99→100, 10.50→11, VAT 7% ของ 111 = 8, รวม 119', r.data.items[0].total === 100 && r.data.items[1].total === 11 && r.data.totalAmount === 119, JSON.stringify([r.data.items.map((i) => i.total), r.data.totalAmount]));
  r = await make({ taxRate: 7, vatMode: 'inclusive', items: [{ description: 'a', quantity: 1, unitPrice: 10700 }] });
  ok('ถอด VAT จากยอดรวม: ลูกค้าจ่าย 10,700 เท่าเดิม', r.data.totalAmount === 10700 && r.data.vatMode === 'inclusive', r.data.totalAmount);
  r = await make({ taxRate: 7, vatMode: 'none', items: [{ description: 'a', quantity: 1, unitPrice: 10700 }] });
  ok('ไม่มี VAT: ยอดรวม = ยอดรายการ', r.data.totalAmount === 10700 && r.data.vatMode === 'none');
  r = await make({ vatMode: 'bogus', items: [] });
  ok('รูปแบบ VAT ที่ไม่รู้จัก → ใช้ค่าเริ่มต้นของร้าน', r.data.vatMode === 'exclusive', r.data.vatMode);
  ok('ใบเสนอราคาที่ไม่ผูกโปรเจ็กต์ ไม่ล็อกราคา', r.data.lockedPrice === null);

  r = await A.call('PUT', '/account', { name: 'ร้านเอ', vatMode: 'inclusive' });
  ok('ตั้งค่าเริ่มต้น VAT ของร้านได้', r.data.user.vatMode === 'inclusive', r.data.user?.vatMode);
  r = await make({ items: [{ description: 'a', quantity: 1, unitPrice: 107 }] });
  ok('ใบเสนอราคาใหม่ใช้ค่าเริ่มต้น VAT ของร้าน', r.data.vatMode === 'inclusive' && r.data.totalAmount === 107, r.data.vatMode);
  r = await A.call('GET', `/quotes/${plain.id}`);
  ok('เปลี่ยนค่าเริ่มต้นของร้าน ไม่กระทบใบเสนอราคาเดิม', r.data.vatMode === 'exclusive' && r.data.totalAmount === 1926);
  ok('ร้านอื่นยังใช้ค่าเริ่มต้นของตัวเอง', (await B.call('GET', '/auth/me')).data.user.vatMode === 'exclusive');
  r = await A.call('PUT', '/account', { name: 'ร้านเอ', vatMode: 'whatever' });
  ok('ค่าเริ่มต้น VAT ที่ไม่รู้จัก ถูกเมิน', r.data.user.vatMode === 'inclusive');
  await A.call('PUT', '/account', { name: 'ร้านเอ', vatMode: 'exclusive' });

  // --- a job and its quote are tied together
  // costs 3 × 333.33 + an extra (not in the price), markup 50% → 1,499.985 → 1,500
  r = await A.call('POST', '/projects', {
    title: 'งานผูกใบเสนอราคา', projectType: 'อื่นๆ', profitMargin: 50,
    costItems: [{ name: 'ดอกไม้', quantity: 3, price: 333.33 }, { name: 'งอก', quantity: 1, price: 0, isExtra: true, actual: 500 }],
  });
  const lp = r.data;
  ok('โปรเจ็กต์ที่ยังไม่มีใบเสนอราคา: quote เป็น null', lp.quote === null, JSON.stringify(lp.quote));
  const line = (unitPrice, quantity = 1) => [{ description: 'ดอกไม้', quantity, unitPrice }];
  r = await make({ projectId: lp.id, items: line(900) });
  const fq = r.data;
  ok('ใบของโปรเจ็กต์: ราคาเป็นบาทเต็ม (1,500) ไม่รวมรายการงอก ไม่ใช้รายการที่ส่งมา', r.status === 201 && fq.followsProject === true && fq.lockedPrice === 1500 && fq.items.length === 1 && fq.items[0].unitPrice === 1500 && fq.items[0].roundUp === true && fq.rounding === 'line' && fq.totalAmount === 1605, JSON.stringify(r.data));
  r = await A.call('PUT', `/quotes/${fq.id}`, { discountRate: 10, rounding: 'satang', items: [{ description: 'แก้เอง', quantity: 1, unitPrice: 1 }], notes: 'โน้ตใหม่', whtRate: 3 });
  ok('แก้ใบที่ผูกโปรเจ็กต์: รายการ ส่วนลด และการปัด ไม่เปลี่ยน (ต้องแก้ที่โปรเจ็กต์) ช่องอื่นของใบแก้ได้',
    r.status === 200 && r.data.items.length === 1 && r.data.items[0].description === 'รายการต้นทุน' && r.data.items[0].unitPrice === 1500 && r.data.discountRate === 0 && r.data.rounding === 'line' && r.data.notes === 'โน้ตใหม่' && r.data.withholding === 45,
    JSON.stringify([r.status, r.data.items, r.data.discountRate, r.data.rounding, r.data.notes, r.data.withholding]));
  r = await A.call('PUT', `/quotes/${fq.id}`, { whtRate: 0, vatMode: 'inclusive' });
  ok('เปลี่ยนเป็นถอด VAT: ลูกค้าจ่ายเท่าราคาโปรเจ็กต์', r.status === 200 && r.data.totalAmount === 1500, r.data.totalAmount);
  const other = (await A.call('POST', '/projects', { title: 'อีกงาน', projectType: 'อื่นๆ' })).data;
  r = await A.call('PUT', `/quotes/${fq.id}`, { projectId: other.id });
  ok('ใบที่ผูกโปรเจ็กต์ย้ายไปผูกโปรเจ็กต์อื่นไม่ได้', r.status === 200 && r.data.projectId === lp.id, r.data.projectId);
  await A.call('DELETE', `/projects/${other.id}`);

  r = await A.call('PUT', `/projects/${lp.id}`, { profitMargin: 100 });
  ok('แก้ราคาโปรเจ็กต์ตอนใบยังเป็นร่าง → บันทึกได้เลย และบอกว่าใบเสนอราคาเปลี่ยนตาม', r.status === 200 && r.data.quoteUpdated === true, JSON.stringify([r.status, r.data.quoteUpdated]));
  r = await A.call('GET', `/quotes/${fq.id}`);
  ok('ใบเสนอราคาเปลี่ยนตามโปรเจ็กต์: 3 × 333.33 × 2 = 1,999.98 → 2,000', r.data.lockedPrice === 2000 && r.data.items[0].unitPrice === 2000 && r.data.totalAmount === 2000 && r.data.job.inStep === true && r.data.notes === 'โน้ตใหม่', JSON.stringify([r.data.lockedPrice, r.data.items, r.data.totalAmount, r.data.job]));
  r = await A.call('PUT', `/projects/${lp.id}`, { notes: 'โน้ตงาน' });
  ok('บันทึกโปรเจ็กต์โดยไม่แตะต้นทุนหรือราคา → ใบเสนอราคาไม่ถูกแตะ', r.status === 200 && r.data.quoteUpdated === false, r.data.quoteUpdated);

  // the customer already has the quote: the shop is asked before a save changes it
  await A.call('PUT', `/quotes/${fq.id}`, { status: 'sent' });
  r = await A.call('PUT', `/projects/${lp.id}`, { profitMargin: 50 });
  ok('ใบส่งแล้ว: แก้ราคาโปรเจ็กต์โดยยังไม่ยืนยัน ถูกปฏิเสธ (409) พร้อมบอกใบ สถานะ ราคาเดิมและราคาใหม่',
    r.status === 409 && r.data.code === 'quote_change' && r.data.quote.id === fq.id && r.data.quote.code === fq.code && r.data.quote.status === 'sent' && r.data.quote.price === 2000 && r.data.quote.newPrice === 1500 && r.data.error.includes(fq.code),
    JSON.stringify(r.data));
  r = await A.call('GET', `/projects/${lp.id}`);
  let now = (await A.call('GET', `/quotes/${fq.id}`)).data;
  ok('ถูกปฏิเสธแล้วไม่มีอะไรถูกบันทึก: ทั้งโปรเจ็กต์และใบเสนอราคาคงเดิม', Math.round(r.data.profitMargin) === 100 && now.lockedPrice === 2000 && now.items[0].unitPrice === 2000 && now.status === 'sent', JSON.stringify([r.data.profitMargin, now.lockedPrice, now.status]));
  r = await A.call('PUT', `/projects/${lp.id}`, { profitMargin: 50, confirmQuoteChange: true });
  now = (await A.call('GET', `/quotes/${fq.id}`)).data;
  ok('ยืนยันแล้ว → บันทึกได้ ใบที่ส่งแล้วเปลี่ยนตามโปรเจ็กต์ (1,500) สถานะคงเดิม', r.status === 200 && r.data.quoteUpdated === true && now.lockedPrice === 1500 && now.items[0].unitPrice === 1500 && now.status === 'sent', JSON.stringify([r.status, r.data.quoteUpdated, now.lockedPrice, now.status]));

  await A.call('PUT', `/quotes/${fq.id}`, { status: 'approved' });
  let job = (await A.call('GET', `/projects/${lp.id}`)).data;
  ok('โปรเจ็กต์บอกสถานะของใบที่ผูกไว้', job.quote.status === 'approved' && job.quote.statusText === 'อนุมัติแล้ว', JSON.stringify(job.quote));
  r = await A.call('PUT', `/projects/${lp.id}`, { notes: 'โน้ตหลังอนุมัติ' });
  const sameCosts = await A.call('PUT', `/projects/${lp.id}`, { costGroups: job.costGroups, costItems: job.costItems });
  // what the job actually cost is filled in after the customer has agreed; it is not on the quote
  const withActual = await A.call('PUT', `/projects/${lp.id}`, { costGroups: job.costGroups, costItems: job.costItems.map((i) => (i.isExtra ? { ...i, actual: 650 } : { ...i, actual: 1100 })) });
  ok('ใบอนุมัติแล้ว: บันทึกโปรเจ็กต์ที่ไม่เปลี่ยนสิ่งที่อยู่ในใบ (โน้ต · ต้นทุนเท่าเดิม · ต้นทุนจริง) ไม่ต้องยืนยัน',
    r.status === 200 && sameCosts.status === 200 && sameCosts.data.quoteUpdated === false && withActual.status === 200 && withActual.data.quoteUpdated === false && withActual.data.costItems[0].actual === 1100,
    JSON.stringify([r.status, sameCosts.status, sameCosts.data.quoteUpdated, withActual.status, withActual.data.quoteUpdated]));
  job = withActual.data;
  const renamed = { costGroups: job.costGroups.map((g) => ({ ...g, name: 'ซุ้มดอกไม้' })), costItems: job.costItems };
  r = await A.call('PUT', `/projects/${lp.id}`, renamed);
  ok('ใบอนุมัติแล้ว: เปลี่ยนชื่อหัวข้อ (คือชื่อบรรทัดในใบ) ก็ต้องยืนยันก่อน แม้ราคาเท่าเดิม', r.status === 409 && r.data.quote.status === 'approved' && r.data.quote.price === 1500 && r.data.quote.newPrice === 1500, JSON.stringify(r.data));
  r = await A.call('PUT', `/projects/${lp.id}`, { ...renamed, confirmQuoteChange: true });
  now = (await A.call('GET', `/quotes/${fq.id}`)).data;
  ok('ยืนยันแล้ว → ชื่อบรรทัดในใบเปลี่ยนตามชื่อหัวข้อ ใบยังเป็น "อนุมัติแล้ว"', r.status === 200 && now.items[0].description === 'ซุ้มดอกไม้' && now.status === 'approved' && now.lockedPrice === 1500, JSON.stringify([r.status, now.items, now.status]));
  r = await A.call('PUT', `/projects/${lp.id}`, { status: 'completed' });
  ok('เปลี่ยนสถานะโปรเจ็กต์อย่างเดียว ไม่ถามยืนยัน', r.status === 200 && r.data.status === 'completed', r.status);
  await A.call('PUT', `/quotes/${fq.id}`, { status: 'rejected' });
  r = await A.call('PUT', `/projects/${lp.id}`, { profitMargin: 100 });
  ok('ใบที่ลูกค้าปฏิเสธ: แก้โปรเจ็กต์แล้วใบเปลี่ยนตามโดยไม่ต้องยืนยัน', r.status === 200 && r.data.quoteUpdated === true, JSON.stringify([r.status, r.data.quoteUpdated]));

  r = await A.call('POST', '/projects', { title: 'งานยังไม่มีต้นทุน', projectType: 'อื่นๆ' });
  const empty = r.data;
  r = await make({ projectId: empty.id, items: line(900) });
  const eq = r.data;
  ok('โปรเจ็กต์ที่ยังไม่มีต้นทุน: ใบยังไม่มีรายการและยังไม่มีราคา', r.status === 201 && eq.followsProject === true && eq.lockedPrice === null && eq.items.length === 0 && eq.totalAmount === 0, JSON.stringify([r.status, eq.lockedPrice, eq.items]));
  r = await A.call('PUT', `/projects/${empty.id}`, { profitMargin: 25, costGroups: [{ id: 1, name: 'ดอกไม้สด', markup: 25 }, { id: 2, name: '', markup: 100 }], costItems: [{ name: 'กุหลาบ', quantity: 1, price: 800, groupId: 1 }, { name: 'ค่าแรง', quantity: 2, price: 250, groupId: 2 }] });
  now = (await A.call('GET', `/quotes/${eq.id}`)).data;
  ok('ใส่ต้นทุนในโปรเจ็กต์ทีหลัง → ใบได้หัวข้อละบรรทัดและราคาตาม (1,000 + 1,000) หัวข้อไม่มีชื่อเป็น "หัวข้อที่ 2"',
    r.status === 200 && r.data.quoteUpdated === true && now.lockedPrice === 2000 && JSON.stringify(now.items.map((i) => [i.description, i.unitPrice])) === JSON.stringify([['ดอกไม้สด', 1000], ['หัวข้อที่ 2', 1000]]),
    JSON.stringify([r.status, r.data.quoteUpdated, now.lockedPrice, now.items]));
  await A.call('DELETE', `/quotes/${eq.id}`);
  r = await A.call('GET', `/projects/${empty.id}`);
  const again = await make({ projectId: empty.id });
  ok('ลบใบที่ผูกไว้ → โปรเจ็กต์ไม่มีใบแล้ว และสร้างใบใหม่ให้โปรเจ็กต์ได้', r.data.quote === null && again.status === 201 && again.data.followsProject === true && again.data.lockedPrice === 2000, JSON.stringify([r.data.quote, again.status, again.data.lockedPrice]));
  await A.call('DELETE', `/projects/${empty.id}`);
  now = (await A.call('GET', `/quotes/${again.data.id}`)).data;
  r = await A.call('PUT', `/quotes/${again.data.id}`, { items: line(777) });
  ok('ลบโปรเจ็กต์ → ใบยังอยู่พร้อมรายการเดิม ไม่ผูกโปรเจ็กต์แล้ว และกลับมาแก้รายการในใบได้', now.projectId === null && now.followsProject === false && now.items.length === 2 && r.status === 200 && r.data.items.length === 1 && r.data.items[0].unitPrice === 777, JSON.stringify([now.projectId, now.followsProject, now.items.length, r.status, r.data.items]));

  // --- a quote from before jobs and quotes were tied: it keeps its own lines until the job's price changes, or the shop asks
  r = await A.call('POST', '/projects', { title: 'งานของใบเก่า', projectType: 'อื่นๆ', profitMargin: 50, costItems: [{ name: 'ดอกไม้', quantity: 1, price: 1000 }] });
  const oldJob = r.data;
  const oq = (await make({ projectId: oldJob.id })).data;
  const leaveBehind = async (status) => {
    await sql(`UPDATE quote_items SET description = 'รายการที่พิมพ์เองสมัยก่อน', unit_price = 1400 WHERE quote_id = $1`, [oq.id]);
    await sql(`UPDATE quotes SET locked_price = NULL, status = $2 WHERE id = $1`, [oq.id, status]);
  };
  await leaveBehind('approved');
  now = (await A.call('GET', `/quotes/${oq.id}`)).data;
  ok('ใบเก่าที่ยังไม่ตรงกับงาน: ใบบอกว่ายังไม่ตรง พร้อมราคางานตอนนี้ (1,500) โดยรายการเดิมยังอยู่', now.followsProject === true && now.job.inStep === false && now.job.price === 1500 && now.items[0].unitPrice === 1400 && now.items[0].description === 'รายการที่พิมพ์เองสมัยก่อน', JSON.stringify([now.job, now.items]));
  job = (await A.call('GET', `/projects/${oldJob.id}`)).data;
  r = await A.call('PUT', `/projects/${oldJob.id}`, { costGroups: job.costGroups, costItems: job.costItems.map((i) => ({ ...i, actual: 900 })), notes: 'กรอกต้นทุนจริง' });
  now = (await A.call('GET', `/quotes/${oq.id}`)).data;
  ok('งานของใบเก่า: บันทึกต้นทุนจริง (ราคางานไม่เปลี่ยน) → ไม่ถามยืนยัน และใบเก่าที่อนุมัติแล้วไม่ถูกแตะ', r.status === 200 && r.data.quoteUpdated === false && r.data.costItems[0].actual === 900 && now.items[0].unitPrice === 1400 && now.status === 'approved', JSON.stringify([r.status, r.data.quoteUpdated, now.items]));
  r = await A.call('POST', `/quotes/${oq.id}/sync`);
  ok('สั่งอัปเดตใบเก่าที่อนุมัติแล้วตามโปรเจ็กต์โดยยังไม่ยืนยัน → ถูกปฏิเสธ (409) พร้อมราคาเดิม 1,400 และราคาใหม่ 1,500', r.status === 409 && r.data.code === 'quote_change' && r.data.quote.price === 1400 && r.data.quote.newPrice === 1500, JSON.stringify(r.data));
  r = await A.call('POST', `/quotes/${oq.id}/sync`, { confirmQuoteChange: true });
  ok('ยืนยันแล้ว → ใบเก่าได้รายการและราคาตามโปรเจ็กต์ สถานะคงเดิม', r.status === 200 && r.data.job.inStep === true && r.data.items.length === 1 && r.data.items[0].description === 'รายการต้นทุน' && r.data.items[0].unitPrice === 1500 && r.data.lockedPrice === 1500 && r.data.status === 'approved', JSON.stringify([r.status, r.data.job, r.data.items]));
  await leaveBehind('draft');
  r = await A.call('POST', `/quotes/${oq.id}/sync`);
  ok('ใบเก่าที่ยังเป็นร่าง: สั่งอัปเดตตามโปรเจ็กต์ได้เลย', r.status === 200 && r.data.job.inStep === true && r.data.items[0].unitPrice === 1500, JSON.stringify([r.status, r.data.items]));
  await leaveBehind('sent');
  r = await A.call('PUT', `/projects/${oldJob.id}`, { profitMargin: 100 });
  const confirmed = await A.call('PUT', `/projects/${oldJob.id}`, { profitMargin: 100, confirmQuoteChange: true });
  now = (await A.call('GET', `/quotes/${oq.id}`)).data;
  ok('ใบเก่าที่ส่งแล้ว: แก้ราคางานจริง → ถามยืนยันเหมือนใบอื่น (ราคาในใบ 1,400 → 2,000) ยืนยันแล้วใบเปลี่ยนตาม', r.status === 409 && r.data.quote.price === 1400 && r.data.quote.newPrice === 2000 && confirmed.status === 200 && confirmed.data.quoteUpdated === true && now.items[0].unitPrice === 2000 && now.job.inStep === true, JSON.stringify([r.status, r.data.quote, confirmed.status, now.items]));
  r = await B.call('POST', `/quotes/${oq.id}/sync`, { confirmQuoteChange: true });
  ok('ร้าน B สั่งอัปเดตใบเสนอราคาของ A ไม่ได้', r.status === 404, r.status);
  await A.call('DELETE', `/projects/${oldJob.id}`);

  // --- a job made from a quote is the other way round: its price is settled, and a quote for it is only held to that price
  r = await make({ taxRate: 7, status: 'approved', items: line(1500) });
  const sourceQ = r.data;
  r = await A.call('POST', `/quotes/${sourceQ.id}/project`);
  const settled = r.data;
  ok('โปรเจ็กต์ที่สร้างจากใบเสนอราคา: หน้างานเปิดใบต้นทางได้ (quote = ใบที่สร้างงานนี้ขึ้นมา)', settled.quote?.id === sourceQ.id && settled.quote.code === sourceQ.code && settled.quote.status === 'approved', JSON.stringify(settled.quote));
  r = await make({ projectId: settled.id, items: line(1500) });
  const lq = r.data;
  ok('ใบที่ไม่ได้ผูกกับโปรเจ็กต์ สั่งอัปเดตตามโปรเจ็กต์ไม่ได้ (400)', (await A.call('POST', `/quotes/${lq.id}/sync`)).status === 400);
  ok('โปรเจ็กต์ที่สร้างจากใบเสนอราคา: ใบของโปรเจ็กต์นี้ไม่ตามโปรเจ็กต์ แค่ล็อกราคาที่ตกลงไว้ (1,500)', r.status === 201 && lq.followsProject === false && lq.lockedPrice === 1500 && settled.agreedPrice === 1500, JSON.stringify([r.status, lq.followsProject, lq.lockedPrice, settled.agreedPrice, settled.quote]));
  r = await A.call('PUT', `/quotes/${lq.id}`, { items: [{ description: 'ดอกไม้', quantity: 1, unitPrice: 1000 }, { description: 'ค่าแรง', quantity: 2, unitPrice: 250 }] });
  ok('แก้รายการได้ ถ้ายอดรวมยังเท่าราคาที่ล็อก', r.status === 200 && r.data.items.length === 2 && r.data.totalAmount === 1605, r.data.totalAmount);
  r = await A.call('PUT', `/quotes/${lq.id}`, { items: line(1400) });
  ok('แก้รายการจนยอดไม่เท่าราคาที่ล็อก ถูกปฏิเสธ', r.status === 400 && r.data.error.includes('1,400') && r.data.error.includes('1,500'), JSON.stringify(r.data));
  r = await A.call('PUT', `/quotes/${lq.id}`, { discountRate: 10 });
  ok('ใส่ส่วนลดจนยอดไม่เท่าราคาที่ล็อก ถูกปฏิเสธ', r.status === 400);
  r = await A.call('PUT', `/quotes/${lq.id}`, { discountRate: 25, items: line(2000) });
  ok('ส่วนลดได้ ถ้ายอดหลังหักส่วนลดเท่าราคาที่ล็อก (2,000 -25%)', r.status === 200 && r.data.totalAmount === 1605, r.data.totalAmount);
  r = await A.call('PUT', `/quotes/${lq.id}`, { vatMode: 'inclusive' });
  ok('เปลี่ยนเป็นถอด VAT: ลูกค้าจ่ายเท่าราคาที่ล็อก', r.status === 200 && r.data.totalAmount === 1500, r.data.totalAmount);
  await A.call('PUT', `/projects/${settled.id}`, { profitMargin: 100 });
  r = await A.call('PUT', `/quotes/${lq.id}`, { notes: 'x', status: 'sent' });
  ok('ราคาโปรเจ็กต์เปลี่ยนทีหลัง ราคาที่ล็อกในใบเสนอราคาไม่เปลี่ยน', r.status === 200 && r.data.lockedPrice === 1500, r.data.lockedPrice);
  // rounding: each line chooses to round up; discount and VAT keep the satang
  const cents = [{ description: 'a', quantity: 3, unitPrice: 33.33 }];
  const mixed = [{ description: 'ปัด', quantity: 3, unitPrice: 33.33, roundUp: true }, { description: 'ไม่ปัด', quantity: 1, unitPrice: 10.25 }];
  r = await make({ taxRate: 7, discountRate: 5, items: mixed });
  ok('ใบใหม่เลือกปัดทีละรายการ: 99.99→100 (ปัด), 10.25 คงเดิม', r.data.rounding === 'line' && r.data.items[0].total === 100 && r.data.items[0].roundUp === true && r.data.items[1].total === 10.25 && r.data.items[1].roundUp === false, JSON.stringify(r.data.items?.map((i) => [i.total, i.roundUp])));
  ok('ส่วนลดและ VAT คิดถึงสตางค์: 110.25 -5.51 = 104.74 +7.33 = 112.07', r.data.totalAmount === 112.07, r.data.totalAmount);
  const lineQ = r.data;
  r = await make({ taxRate: 7, items: [{ description: 'a', quantity: 1, unitPrice: 99.01, roundUp: true }, { description: 'b', quantity: 1, unitPrice: 10.5, roundUp: true }, { description: 'c', quantity: 2, unitPrice: 50, roundUp: true }] });
  ok('ปัดขึ้นทันทีที่มีเศษ: 99.01→100, 10.50→11, ยอดเต็ม 100 ไม่เปลี่ยน', JSON.stringify(r.data.items.map((i) => i.total)) === '[100,11,100]', JSON.stringify(r.data.items?.map((i) => i.total)));
  ok('ทุกรายการปัดแล้ว VAT ยังคิดถึงสตางค์: 211 + 14.77 = 225.77', r.data.totalAmount === 225.77, r.data.totalAmount);
  r = await A.call('PUT', `/quotes/${lineQ.id}`, { items: mixed.map((i) => ({ ...i, roundUp: !i.roundUp })) });
  ok('สลับการปัดของแต่ละรายการ: 99.99 คงเดิม, 10.25→11', r.status === 200 && r.data.items[0].total === 99.99 && r.data.items[1].total === 11, JSON.stringify(r.data.items?.map((i) => i.total)));
  r = await A.call('PUT', `/quotes/${lineQ.id}`, { notes: 'แก้อย่างอื่น' });
  ok('แก้ช่องอื่น การปัดของแต่ละรายการคงเดิม', r.data.items[0].roundUp === false && r.data.items[1].roundUp === true && r.data.rounding === 'line');
  r = await make({ taxRate: 7, discountRate: 5, rounding: 'baht', items: cents });
  ok('กติกาเดิมยังใช้ได้เมื่อระบุ: 100 -5 +VAT 7 = 102', r.data.rounding === 'baht' && r.data.totalAmount === 102, JSON.stringify([r.data.rounding, r.data.totalAmount]));
  const rq = r.data;
  r = await make({ taxRate: 7, discountRate: 5, rounding: 'satang', items: cents });
  ok('ไม่ปัดเศษ: 99.99 -5.00 = 94.99 +VAT 6.65 = 101.64', r.data.rounding === 'satang' && r.data.items[0].total === 99.99 && r.data.totalAmount === 101.64, JSON.stringify([r.data.items?.[0]?.total, r.data.totalAmount]));
  r = await A.call('PUT', `/quotes/${rq.id}`, { rounding: 'satang' });
  ok('สลับใบเดิมเป็นไม่ปัดเศษ: ยอดเปลี่ยน ราคาต่อหน่วยคงเดิม', r.status === 200 && r.data.totalAmount === 101.64 && r.data.items[0].unitPrice === 33.33, r.data.totalAmount);
  r = await A.call('PUT', `/quotes/${rq.id}`, { notes: 'แก้อย่างอื่น' });
  ok('แก้ช่องอื่น การปัดเศษของใบนั้นคงเดิม', r.data.rounding === 'satang' && r.data.totalAmount === 101.64, r.data.rounding);
  r = await A.call('GET', '/quotes');
  ok('รายการใบเสนอราคาบอกการปัดเศษและยอดที่มีสตางค์', r.data.find((q) => q.id === rq.id)?.rounding === 'satang' && r.data.find((q) => q.id === rq.id)?.totalAmount === 101.64);
  r = await A.call('PUT', `/quotes/${rq.id}`, { rounding: 'baht' });
  ok('สลับกลับเป็นบาทเต็ม', r.data.rounding === 'baht' && r.data.totalAmount === 102, r.data.totalAmount);
  r = await make({ rounding: 'bogus', items: cents });
  ok('ค่าการปัดเศษที่ไม่รู้จัก → เลือกทีละรายการ (ค่าเริ่มต้น)', r.status === 201 && r.data.rounding === 'line', r.data.rounding);
  r = await make({ taxRate: 7, vatMode: 'inclusive', rounding: 'satang', items: [{ description: 'a', quantity: 1, unitPrice: 1000 }] });
  ok('ไม่ปัดเศษ + ถอด VAT: ลูกค้าจ่าย 1,000 เท่าเดิม', r.data.totalAmount === 1000, r.data.totalAmount);
  r = await A.call('PUT', `/quotes/${lq.id}`, { rounding: 'satang', discountRate: 0, vatMode: 'exclusive', items: [{ description: 'ดอกไม้', quantity: 3, unitPrice: 499.99 }] });
  ok('ไม่ปัดเศษกับราคาที่ล็อก: 1,499.97 ไม่เท่า 1,500 ถูกปฏิเสธ', r.status === 400, r.status);
  r = await A.call('PUT', `/quotes/${lq.id}`, { rounding: 'satang', discountRate: 0, vatMode: 'exclusive', items: [{ description: 'ดอกไม้', quantity: 3, unitPrice: 499.99 }, { description: 'ปรับยอด', quantity: 1, unitPrice: 0.03 }] });
  ok('ไม่ปัดเศษกับราคาที่ล็อก: รายการรวม 1,500.00 พอดี บันทึกได้', r.status === 200 && r.data.totalAmount === 1605, JSON.stringify([r.status, r.data.totalAmount]));
  r = await A.call('PUT', `/quotes/${lq.id}`, { rounding: 'line', discountRate: 0, vatMode: 'exclusive', items: [{ description: 'ดอกไม้', quantity: 3, unitPrice: 499.99, roundUp: true }] });
  ok('เลือกปัดรายบรรทัดกับราคาที่ล็อก: 1,499.97 ปัดเป็น 1,500 ตรงราคาที่ล็อก บันทึกได้', r.status === 200 && r.data.items[0].total === 1500 && r.data.totalAmount === 1605, JSON.stringify([r.status, r.data.totalAmount]));
  r = await A.call('PUT', `/quotes/${lq.id}`, { items: [{ description: 'ดอกไม้', quantity: 3, unitPrice: 499.99, roundUp: false }] });
  ok('เอาติ๊กปัดออกจนยอดไม่เท่าราคาที่ล็อก ถูกปฏิเสธ', r.status === 400, r.status);
  r = await make({ taxRate: 7, discountRate: 5, rounding: 'satang', status: 'approved', items: cents });
  r = await A.call('POST', `/quotes/${r.data.id}/project`);
  ok('ใบเสนอราคาแบบไม่ปัดเศษ → โปรเจ็กต์ได้ราคาที่ตกลงพร้อมสตางค์ (94.99)', r.status === 201 && r.data.agreedPrice === 94.99, JSON.stringify([r.status, r.data.agreedPrice]));
  if (r.data?.id) await A.call('DELETE', `/projects/${r.data.id}`);
  // withholding tax: a % of the price without VAT, taken off what the customer transfers
  const big = [{ description: 'ค่าจัดงาน', quantity: 1, unitPrice: 10000 }];
  r = await make({ taxRate: 7, items: big });
  ok('ใบใหม่ไม่หัก ณ ที่จ่าย: ยอดชำระ = ยอดรวมสุทธิ', r.data.whtRate === 0 && r.data.withholding === 0 && r.data.payableAmount === 10700, JSON.stringify([r.data.whtRate, r.data.withholding, r.data.payableAmount]));
  const wq = r.data;
  r = await A.call('PUT', `/quotes/${wq.id}`, { whtRate: 3 });
  ok('หัก ณ ที่จ่าย 3% ของยอดก่อน VAT: 10,700 - 300 = 10,400 และยอดรวมสุทธิคงเดิม', r.status === 200 && r.data.withholding === 300 && r.data.payableAmount === 10400 && r.data.totalAmount === 10700, JSON.stringify([r.data.withholding, r.data.payableAmount, r.data.totalAmount]));
  r = await A.call('PUT', `/quotes/${wq.id}`, { notes: 'แก้อย่างอื่น' });
  ok('แก้ช่องอื่น อัตราหัก ณ ที่จ่ายคงเดิม', r.data.whtRate === 3 && r.data.payableAmount === 10400, r.data.whtRate);
  r = await A.call('PUT', `/quotes/${wq.id}`, { vatMode: 'inclusive', items: [{ description: 'ค่าจัดงาน', quantity: 1, unitPrice: 10700 }] });
  ok('ราคารวม VAT: หักจากมูลค่าก่อนภาษี 10,000 = 300 เหลือชำระ 10,400', r.data.withholding === 300 && r.data.payableAmount === 10400, JSON.stringify([r.data.withholding, r.data.payableAmount]));
  r = await A.call('PUT', `/quotes/${wq.id}`, { vatMode: 'exclusive', discountRate: 10, items: [{ description: 'ค่าจัดงาน', quantity: 3, unitPrice: 33.33 }] });
  ok('หักหลังส่วนลดและคิดถึงสตางค์: 99.99 -10.00 = 89.99 → หัก 2.70 · รวม 96.29 · ชำระ 93.59', r.data.withholding === 2.7 && r.data.totalAmount === 96.29 && r.data.payableAmount === 93.59, JSON.stringify([r.data.withholding, r.data.totalAmount, r.data.payableAmount]));
  r = await A.call('GET', '/quotes');
  ok('รายการใบเสนอราคายังแสดงยอดรวมสุทธิ และบอกยอดชำระ', r.data.find((q) => q.id === wq.id)?.totalAmount === 96.29 && r.data.find((q) => q.id === wq.id)?.payableAmount === 93.59);
  r = await A.call('PUT', `/quotes/${wq.id}`, { whtRate: 150 });
  ok('อัตราหัก ณ ที่จ่ายเกิน 100% ถูกจำกัดไว้ที่ 100 (เหมือนส่วนลด)', r.status === 200 && r.data.whtRate === 100, r.data.whtRate);
  r = await A.call('PUT', `/quotes/${wq.id}`, { whtRate: -1 });
  ok('อัตราหัก ณ ที่จ่ายติดลบ กลายเป็น 0', r.status === 200 && r.data.whtRate === 0 && r.data.withholding === 0, r.data.whtRate);
  r = await A.call('PUT', `/quotes/${wq.id}`, { whtRate: 0 });
  ok('ตั้งกลับเป็น 0 = ไม่หัก', r.status === 200 && r.data.withholding === 0 && r.data.payableAmount === r.data.totalAmount);
  r = await A.call('PUT', `/quotes/${lq.id}`, { whtRate: 3 });
  ok('หัก ณ ที่จ่ายไม่กระทบราคาที่ล็อก: ยังบันทึกได้ และหัก 3% ของ 1,500 = 45', r.status === 200 && r.data.withholding === 45 && r.data.payableAmount === 1560, JSON.stringify([r.status, r.data.withholding, r.data.payableAmount]));
  // the quote that job's page opens: the newest for it; with none left, the page offers to make one again
  job = (await A.call('GET', `/projects/${settled.id}`)).data;
  ok('โปรเจ็กต์ที่สร้างจากใบเสนอราคาและมีใบเสนอราคามากกว่าหนึ่งใบ: หน้างานเปิดใบล่าสุด', job.quote?.id === lq.id, JSON.stringify(job.quote));
  await A.call('DELETE', `/quotes/${lq.id}`);
  const backToSource = (await A.call('GET', `/projects/${settled.id}`)).data.quote;
  await A.call('DELETE', `/quotes/${sourceQ.id}`);
  job = (await A.call('GET', `/projects/${settled.id}`)).data;
  ok('ลบใบล่าสุด → กลับไปเปิดใบต้นทาง · ลบทุกใบ → ไม่มีใบให้เปิด (หน้างานกลับมีปุ่มสร้างใบเสนอราคา)', backToSource?.id === sourceQ.id && job.quote === null && job.agreedPrice === 1500, JSON.stringify([backToSource, job.quote, job.agreedPrice]));
  for (const id of [lp.id, settled.id]) await A.call('DELETE', `/projects/${id}`);
  for (const q of (await A.call('GET', '/quotes')).data) if (q.clientName === 'ลูกค้าคำนวณ') await A.call('DELETE', `/quotes/${q.id}`);
}

// --- dashboard / reports
r = await A.call('GET', '/dashboard?range=6');
// p1: cost 2000, margin 25% → sales 2500, profit 500, approved, event this month
ok('Dashboard: ยอดขายเดือนนี้ 2,500 / กำไร 500', r.data.stats.salesThisMonth === 2500 && r.data.stats.profitThisMonth === 500, JSON.stringify(r.data.stats));
ok('Dashboard: กราฟ 6 เดือน', r.data.chart.length === 6);
ok('Dashboard: โปรเจ็กต์ดำเนินการ 3', r.data.stats.activeProjects === 3, r.data.stats.activeProjects);
r = await A.call('GET', '/dashboard?range=12');
ok('Dashboard: กราฟ 12 เดือน', r.data.chart.length === 12);
r = await A.call('GET', '/reports');
ok('Reports: ยอดรวม 2,500 กำไร 500 ต้นทุน 2,000', r.data.totals.sales === 2500 && r.data.totals.profit === 500 && r.data.totals.cost === 2000, JSON.stringify(r.data.totals));
r = await B.call('GET', '/reports');
ok('Reports ของ B ไม่รวมข้อมูล A', r.data.totals.projects === 0);

// delete project with a linked quote
r = await A.call('DELETE', `/projects/${p1.id}`);
r = await A.call('GET', `/quotes/${q1.id}`);
ok('ลบโปรเจ็กต์ → ใบเสนอราคาที่ผูกไว้ยังอยู่ (ไม่ผูกโปรเจ็กต์แล้ว)', r.status === 200 && r.data.projectId === null);
r = await A.call('PUT', `/quotes/${q1.id}`, { status: 'sent' });
ok('แก้ใบเสนอราคาหลังโปรเจ็กต์ถูกลบ ไม่ error', r.status === 200, r.status);
r = await A.call('DELETE', `/quotes/${q1.id}`);
ok('ลบใบเสนอราคา', r.status === 200);
r = await A.call('GET', '/activities?limit=50');
ok('มีบันทึกกิจกรรม', r.data.length >= 5, r.data.length);

// --- account
r = await A.call('PUT', '/account', { name: 'ร้านเอ', businessName: 'ร้านดอกไม้เอ', businessLogo: 'data:text/html;base64,PHNjcmlwdD4=' });
ok('อัปโหลดโลโก้ที่ไม่ใช่รูป ถูกปฏิเสธ', r.status === 400);
r = await A.call('PUT', '/account', { name: 'ร้านเอ', businessName: 'ร้านดอกไม้เอ', businessLogo: 'data:image/png;base64,' + 'A'.repeat(500_000) });
ok('โลโก้ใหญ่เกิน ถูกปฏิเสธ', r.status === 400 || r.status === 413, r.status);
r = await A.call('PUT', '/account', { name: 'ร้านเอ', businessName: 'ร้านดอกไม้เอ', businessLogo: 'data:image/png;base64,iVBORw0KGgo=' });
ok('บันทึกชื่อร้าน + โลโก้', r.status === 200 && r.data.user.businessName === 'ร้านดอกไม้เอ' && r.data.user.businessLogo.startsWith('data:image/png'));
r = await A.call('PUT', '/account', { name: 'ร้านเอ', plan: 'enterprise', role: 'admin' });
ok('ร้านเปลี่ยนแพ็กเกจ/สิทธิ์ตัวเองไม่ได้', r.data.user.plan === 'trial' && r.data.user.role === 'shop', JSON.stringify(r.data.user));
r = await A.call('PUT', '/account', { name: 'ร้านเอ', newPassword: 'newpassword1', currentPassword: 'wrong' });
ok('เปลี่ยนรหัส: รหัสเดิมผิด ถูกปฏิเสธ', r.status === 400);
r = await A.call('PUT', '/account', { name: 'ร้านเอ', newPassword: 'newpassword1', currentPassword: 'password123' });
ok('เปลี่ยนรหัสผ่านสำเร็จ', r.status === 200);
r = await A2.call('GET', '/projects');
ok('เปลี่ยนรหัสแล้ว เครื่องอื่นถูกออกจากระบบ', r.status === 401);
r = await A.call('GET', '/projects');
ok('เครื่องที่เปลี่ยนรหัสยังใช้งานต่อได้', r.status === 200);

// --- admin
r = await A.call('GET', '/admin/shops');
ok('ร้านทั่วไปเข้าหน้าแอดมินไม่ได้ (403)', r.status === 403);
r = await ADM.call('POST', '/auth/register', { name: 'แอดมิน', email: 'admin@x.test', password: 'password123' });
execFileSync('node', ['server/make-admin.js', 'admin@x.test'], { cwd: PROJECT_DIR, env: { ...process.env } });
r = await ADM.call('GET', '/auth/me');
ok('make-admin แล้ว role = admin (ไม่ต้อง login ใหม่)', r.data.user.role === 'admin');
r = await ADM.call('GET', '/admin/shops');
ok('แอดมินเห็นร้านทั้งหมด 3 ร้าน', r.status === 200 && r.data.length === 3, r.data?.length);
const shopA = r.data.find((s) => s.email === 'a@x.test');
ok('ข้อมูลร้าน A: 2 โปรเจ็กต์ 1 ใบเสนอราคา มีโลโก้', shopA.projects === 2 && shopA.quotes === 1 && shopA.hasLogo, JSON.stringify(shopA));
ok('รายการแอดมินไม่ส่งรหัสผ่าน/โลโก้เต็ม', !('password_hash' in shopA) && !('businessLogo' in shopA));
r = await ADM.call('PUT', `/admin/shops/${shopA.id}`, { plan: 'gold' });
ok('แพ็กเกจที่ไม่มีอยู่จริง ถูกปฏิเสธ', r.status === 400);
r = await ADM.call('PUT', `/admin/shops/${shopA.id}`, { plan: 'enterprise' });
ok('ชื่อแพ็กเกจเก่า (enterprise) ใช้ไม่ได้แล้ว', r.status === 400);
r = await ADM.call('PUT', `/admin/shops/${shopA.id}`, { plan: 'pro' });
ok('แอดมินเปลี่ยนแพ็กเกจร้าน A เป็น Pro', r.data.plan === 'pro');
r = await A.call('GET', '/auth/me');
ok('ร้าน A เห็นแพ็กเกจใหม่ทันที', r.data.user.plan === 'pro');
r = await A.call('GET', '/activities?limit=1');
ok('ร้าน A มีกิจกรรม "แพ็กเกจเปลี่ยนเป็น Pro"', r.data[0].kind === 'plan_changed' && r.data[0].title.includes('Pro'), r.data[0]?.title);
const me = (await ADM.call('GET', '/auth/me')).data.user;
r = await ADM.call('PUT', `/admin/shops/${me.id}`, { disabled: true });
ok('แอดมินระงับบัญชีตัวเองไม่ได้', r.status === 400);
r = await ADM.call('PUT', `/admin/shops/${shopA.id}`, { disabled: true });
ok('แอดมินระงับร้าน A', r.data.disabled === true);
r = await A.call('GET', '/projects');
ok('ร้าน A ถูกออกจากระบบทันที', r.status === 401);
r = await A.call('POST', '/auth/login', { email: 'a@x.test', password: 'newpassword1' });
ok('ร้าน A login ไม่ได้ + มีข้อความบอกเหตุผล', r.status === 403 && r.data.error.includes('ระงับ'), r.data?.error);
r = await ADM.call('PUT', `/admin/shops/${shopA.id}`, { disabled: false });
r = await A.call('POST', '/auth/login', { email: 'a@x.test', password: 'newpassword1' });
ok('เปิดใช้งานแล้ว ร้าน A login ได้ + ข้อมูลยังอยู่', r.status === 200 && (await A.call('GET', '/projects')).data.length === 2);

// --- a job's phone number and email carried over to the customer
{
  const customer = async (id) => (await A.call('GET', `/customers/${id}`)).data;
  let r = await A.call('POST', '/customers', { name: 'คุณติดต่อ', phone: '081-000-0001' });
  const c = r.data;
  r = await A.call('POST', '/projects', { title: 'งานติดต่อ 1', customerId: c.id, client: c.name, phone: '081-000-0002', email: 'contact@x.test' });
  const job = r.data;
  let now = await customer(c.id);
  ok('เบอร์ในโปรเจ็กต์ต่างจากลูกค้า ไม่ได้สั่งอัปเดต → เบอร์ลูกค้าคงเดิม แต่อีเมลที่ลูกค้ายังไม่มีถูกเติมให้', r.status === 201 && job.phone === '081-000-0002' && now.phone === '081-000-0001' && now.email === 'contact@x.test', JSON.stringify([now.phone, now.email]));
  r = await A.call('PUT', `/projects/${job.id}`, { phone: '081-000-0003', email: 'new@x.test', updateCustomer: true });
  now = await customer(c.id);
  ok('แก้โปรเจ็กต์พร้อมสั่งอัปเดตลูกค้า → ลูกค้าได้เบอร์และอีเมลใหม่', r.status === 200 && now.phone === '081-000-0003' && now.email === 'new@x.test', JSON.stringify([now.phone, now.email]));
  r = await A.call('PUT', `/projects/${job.id}`, { phone: '', email: '', updateCustomer: true });
  now = await customer(c.id);
  ok('ลบเบอร์ในโปรเจ็กต์ → ไม่ลบเบอร์ของลูกค้า แม้สั่งอัปเดต', r.status === 200 && r.data.phone === '' && now.phone === '081-000-0003' && now.email === 'new@x.test');
  r = await A.call('POST', '/quotes', { customerId: c.id, clientName: c.name, clientPhone: '081-000-0004', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
  const quote = r.data;
  ok('ใบเสนอราคา: ไม่ได้สั่งอัปเดต → เบอร์ลูกค้าคงเดิม', r.status === 201 && (await customer(c.id)).phone === '081-000-0003');
  r = await A.call('PUT', `/quotes/${quote.id}`, { clientPhone: '081-000-0005', updateCustomer: true });
  ok('ใบเสนอราคา: สั่งอัปเดต → ลูกค้าได้เบอร์ใหม่', r.status === 200 && (await customer(c.id)).phone === '081-000-0005');
  r = await A.call('GET', `/projects/${job.id}`);
  ok('อัปเดตลูกค้าแล้ว เอกสารอื่นของลูกค้าไม่ถูกแก้', r.data.phone === '');
  r = await A.call('POST', '/projects', { title: 'งานติดต่อ 2', client: 'คุณติดต่อ', phone: '081-000-0006', updateCustomer: true });
  ok('พิมพ์ชื่อเอง (ไม่ได้เลือกจากรายชื่อ) แล้วสั่งอัปเดต → ลูกค้าชื่อเดียวกันได้เบอร์ใหม่', r.status === 201 && r.data.customerId === c.id && (await customer(c.id)).phone === '081-000-0006');
  r = await A.call('PUT', `/projects/${job.id}`, { phone: 'เบอร์มั่ว', updateCustomer: true });
  ok('เบอร์ผิดรูปแบบ → ถูกปฏิเสธ ลูกค้าไม่ถูกแก้', r.status === 400 && (await customer(c.id)).phone === '081-000-0006');
  for (const id of [job.id, r.data?.id].filter(Boolean)) await A.call('DELETE', `/projects/${id}`);
  for (const p of (await A.call('GET', '/projects')).data.filter((x) => x.title.startsWith('งานติดต่อ'))) await A.call('DELETE', `/projects/${p.id}`);
  await A.call('DELETE', `/quotes/${quote.id}`);
  await A.call('DELETE', `/customers/${c.id}`);
}

// --- a quote written on its own, accepted, then turned into a job
{
  const report = async () => (await A.call('GET', '/reports?from=2031-01-01&to=2031-12-31')).data;
  let r = await A.call('POST', '/customers', { name: 'คุณตกลง', phone: '081-000-0100' });
  const c = r.data;
  r = await A.call('POST', '/quotes', { customerId: c.id, clientName: c.name, clientPhone: '081-000-0100', clientEmail: 'ok@x.test', projectTitle: 'งานเปิดร้าน คุณตกลง', eventDate: '2031-03-10', notes: 'โทนขาว', vatMode: 'exclusive', taxRate: 7, discountRate: 10, status: 'approved',
    items: [{ description: 'ซุ้มดอกไม้', quantity: 2, unitPrice: 20000 }, { description: 'ขนส่งและติดตั้ง', quantity: 1, unitPrice: 10000 }] });
  const q = r.data;
  ok('ใบเสนอราคาเดี่ยว: ยอดหลังส่วนลด 45,000 ไม่มีโปรเจ็กต์', r.status === 201 && q.projectId === null && q.lockedPrice === null, JSON.stringify([q.projectId, q.lockedPrice, q.totalAmount]));
  ok('ร้านอื่นสร้างโปรเจ็กต์จากใบเสนอราคานี้ไม่ได้', (await B.call('POST', `/quotes/${q.id}/project`)).status === 404);

  r = await A.call('POST', `/quotes/${q.id}/project`);
  const p = r.data;
  ok('สร้างโปรเจ็กต์จากใบเสนอราคา: ดึงชื่องาน ลูกค้า เบอร์ อีเมล วันงาน หมายเหตุ และสถานะอนุมัติ', r.status === 201 && p.title === 'งานเปิดร้าน คุณตกลง' && p.client === 'คุณตกลง' && p.customerId === c.id && p.phone === '081-000-0100' && p.email === 'ok@x.test' && p.eventDate === '2031-03-10' && p.notes === 'โทนขาว' && p.status === 'approved', JSON.stringify(p).slice(0, 300));
  ok('ราคาโปรเจ็กต์ยึดตามยอดหลังส่วนลดก่อน VAT = 45,000', p.agreedPrice === 45000, p.agreedPrice);
  ok('รายการในใบเสนอราคากลายเป็นรายการต้นทุนที่รอกรอกราคาทุน อยู่ใต้หัวข้อเดียว', p.costGroups.length === 1 && p.costItems.length === 2 && p.costItems[0].name === 'ซุ้มดอกไม้' && p.costItems[0].quantity === 2 && p.costItems.every((i) => i.price === 0 && i.groupId === p.costGroups[0].id), JSON.stringify(p.costItems));
  r = await A.call('GET', `/quotes/${q.id}`);
  ok('ใบเสนอราคาถูกผูกกับโปรเจ็กต์ และล็อกราคา 45,000', r.data.projectId === p.id && r.data.lockedPrice === 45000);
  ok('สร้างซ้ำจากใบเดิมไม่ได้', (await A.call('POST', `/quotes/${q.id}/project`)).status === 400);

  let rep = await report();
  ok('ยังไม่ใส่ต้นทุน: ไม่นับในรายงานยอดขาย แต่แจ้งว่ามี 1 งาน ราคา 45,000 รออยู่', rep.sales.totals.jobs === 0 && rep.uncosted.count >= 1 && rep.uncosted.sales >= 45000, JSON.stringify([rep.sales.totals, rep.uncosted]));
  ok('ยังไม่ใส่ต้นทุน: ไม่นับในยอดซื้อรวมของลูกค้า', (await A.call('GET', `/customers/${c.id}`)).data.totalSales === 0);

  // costs go in: the price stays, the margin follows
  const withCosts = (prices) => p.costItems.map((i, n) => ({ name: i.name, category: i.category, quantity: i.quantity, price: prices[n], groupId: i.groupId }));
  r = await A.call('PUT', `/projects/${p.id}`, { costGroups: p.costGroups, costItems: withCosts([12000, 6000]) });
  const price = (x) => x.costItems.reduce((s, i) => s + i.quantity * i.price * (1 + x.costGroups.find((g) => g.id === i.groupId).markup / 100), 0);
  ok('ใส่ต้นทุน 30,000 → ราคายังเป็น 45,000 (Margin 33.3%)', r.status === 200 && r.data.agreedPrice === 45000 && Math.abs(price(r.data) - 45000) < 0.01 && Math.abs(r.data.profitMargin - 50) < 1e-6, JSON.stringify([price(r.data), r.data.profitMargin]));
  rep = await report();
  ok('ใส่ต้นทุนแล้ว: รายงานนับ ยอดขาย 45,000 ต้นทุน 30,000 กำไร 15,000', rep.sales.totals.jobs === 1 && rep.sales.totals.sales === 45000 && rep.sales.totals.cost === 30000 && rep.sales.totals.profit === 15000, JSON.stringify(rep.sales.totals));
  ok('ใส่ต้นทุนแล้ว: ยอดซื้อรวมของลูกค้า 45,000', (await A.call('GET', `/customers/${c.id}`)).data.totalSales === 45000);
  r = await A.call('PUT', `/projects/${p.id}`, { costGroups: r.data.costGroups.map((g) => ({ ...g, markup: 500 })), costItems: withCosts([12000, 6000]).map((i) => ({ ...i, groupId: r.data.costGroups[0].id })) });
  ok('ส่ง Margin ของหัวข้อมาเอง → ราคายังเป็น 45,000', Math.abs(price(r.data) - 45000) < 0.01, price(r.data));
  r = await A.call('PUT', `/projects/${p.id}`, { costGroups: r.data.costGroups, costItems: withCosts([20000, 10000]).map((i) => ({ ...i, groupId: r.data.costGroups[0].id })) });
  ok('ต้นทุน 50,000 เกินราคาที่ตกลง → ราคายัง 45,000 และรายงานแสดงขาดทุน 5,000', Math.abs(price(r.data) - 45000) < 0.01 && (await report()).sales.totals.profit === -5000, JSON.stringify([price(r.data), (await report()).sales.totals]));

  r = await A.call('PUT', `/quotes/${q.id}`, { items: [{ description: 'ซุ้มดอกไม้', quantity: 2, unitPrice: 30000 }] });
  ok('แก้ใบเสนอราคาจนยอดไม่เท่าราคาที่ตกลง → ถูกปฏิเสธ', r.status === 400 && r.data.error.includes('45,000'), JSON.stringify(r.data));
  r = await A.call('POST', '/quotes', { clientName: 'คุณว่าง', status: 'approved', items: [] });
  ok('ใบเสนอราคาที่ยังไม่มียอดเงิน → สร้างโปรเจ็กต์ไม่ได้', (await A.call('POST', `/quotes/${r.data.id}/project`)).status === 400);
  await A.call('DELETE', `/quotes/${r.data.id}`);
  r = await A.call('POST', '/quotes', { clientName: 'คุณรอ', status: 'sent', items: [{ description: 'x', quantity: 1, unitPrice: 1000 }] });
  const waiting = (await A.call('POST', `/quotes/${r.data.id}/project`)).data;
  ok('ใบเสนอราคาที่ยังแค่ "ส่งแล้ว" → โปรเจ็กต์ได้สถานะรออนุมัติ และตั้งชื่องานให้เมื่อใบไม่มีชื่องาน', waiting.status === 'pending' && waiting.title === 'งานของ คุณรอ', JSON.stringify([waiting.status, waiting.title]));
  await A.call('DELETE', `/quotes/${r.data.id}`);
  await A.call('DELETE', `/projects/${waiting.id}`);
  await A.call('DELETE', `/quotes/${q.id}`);
  await A.call('DELETE', `/projects/${p.id}`);
  for (const x of (await A.call('GET', '/customers')).data.filter((x) => ['คุณตกลง', 'คุณว่าง', 'คุณรอ'].includes(x.name))) await A.call('DELETE', `/customers/${x.id}`);
}

// --- cost categories the shop adds
{
  let r = await A.call('GET', '/auth/me');
  ok('ร้านใหม่ยังไม่มีหมวดต้นทุนของตัวเอง', Array.isArray(r.data.user.costCategories) && r.data.user.costCategories.length === 0, JSON.stringify(r.data.user.costCategories));
  ok('เพิ่มหมวดโดยไม่กรอกชื่อ → 400', (await A.call('POST', '/cost-categories', { name: '  ' })).status === 400);
  ok('เพิ่มหมวดชื่อซ้ำกับหมวดมาตรฐาน → 400', (await A.call('POST', '/cost-categories', { name: 'ค่าแรง' })).status === 400);
  r = await A.call('POST', '/cost-categories', { name: ' ค่าสถานที่ ' });
  const cat = r.data;
  ok('เพิ่มหมวด "ค่าสถานที่" ได้ และได้รหัสหมวด', r.status === 201 && /^c\d+$/.test(cat.id) && cat.name === 'ค่าสถานที่', JSON.stringify(r.data));
  ok('เพิ่มหมวดชื่อซ้ำกับหมวดของร้าน → 400', (await A.call('POST', '/cost-categories', { name: 'ค่าสถานที่' })).status === 400);
  r = await A.call('GET', '/auth/me');
  ok('หมวดใหม่มากับข้อมูลผู้ใช้', r.data.user.costCategories.length === 1 && r.data.user.costCategories[0].id === cat.id);

  r = await A.call('POST', '/projects', { title: 'งานหมวดใหม่', profitMargin: 50, costItems: [{ name: 'เช่าห้อง', category: cat.id, quantity: 1, price: 1000 }, { name: 'หมวดมั่ว', category: 'c999999', quantity: 1, price: 1 }] });
  const job = r.data;
  ok('รายการต้นทุนใช้หมวดของร้านได้ หมวดที่ไม่มีจริงกลายเป็นหมวดแรก', r.status === 201 && job.costItems[0].category === cat.id && job.costItems[1].category === 'material', JSON.stringify(job.costItems.map((i) => i.category)));
  r = await B.call('POST', '/projects', { title: 'ร้านอื่น', costItems: [{ name: 'x', category: cat.id, quantity: 1, price: 1 }] });
  ok('ร้านอื่นใช้หมวดของร้านนี้ไม่ได้', r.data.costItems[0].category === 'material');
  ok('ร้านอื่นแก้หรือลบหมวดของร้านนี้ไม่ได้', (await B.call('PUT', `/cost-categories/${cat.id}`, { name: 'x' })).status === 404 && (await B.call('DELETE', `/cost-categories/${cat.id}`)).status === 404);

  r = await A.call('PUT', `/cost-categories/${cat.id}`, { name: 'ค่าเช่าสถานที่' });
  ok('เปลี่ยนชื่อหมวดได้ รหัสเดิม', r.status === 200 && r.data.id === cat.id && r.data.name === 'ค่าเช่าสถานที่');
  ok('เปลี่ยนชื่อเป็นชื่อเดิมของตัวเองได้', (await A.call('PUT', `/cost-categories/${cat.id}`, { name: 'ค่าเช่าสถานที่' })).status === 200);
  ok('รหัสหมวดมั่ว → 404', (await A.call('PUT', '/cost-categories/abc', { name: 'x' })).status === 404 && (await A.call('DELETE', '/cost-categories/material')).status === 404);

  r = await A.call('DELETE', `/cost-categories/${cat.id}`);
  ok('ลบหมวด → บอกจำนวนรายการที่ย้าย', r.status === 200 && r.data.moved === 1, JSON.stringify(r.data));
  r = await A.call('GET', `/projects/${job.id}`);
  ok('รายการที่ใช้หมวดที่ลบ ย้ายไป "อื่น ๆ" ยอดเงินเท่าเดิม', r.data.costItems[0].category === 'other' && r.data.costItems[0].price === 1000 && r.data.costItems.length === 2);
  ok('ลบแล้วไม่มีหมวดของร้านเหลือ', (await A.call('GET', '/cost-categories')).data.length === 0);
  await A.call('DELETE', `/projects/${job.id}`);
  await B.call('DELETE', `/projects/${(await B.call('GET', '/projects')).data.find((x) => x.title === 'ร้านอื่น').id}`);
}

// --- customers
{
  r = await A.call('GET', '/customers');
  const auto = r.data.find((c) => c.name === 'ลูกค้า1');
  ok('ชื่อลูกค้าที่พิมพ์ในโปรเจ็กต์กลายเป็นลูกค้าในรายชื่อ', r.status === 200 && !!auto, JSON.stringify(r.data));
  r = await A.call('POST', '/customers', { name: '  ' });
  ok('เพิ่มลูกค้าไม่มีชื่อ ถูกปฏิเสธ', r.status === 400);
  r = await A.call('POST', '/customers', { name: 'คุณสมหญิง', phone: '0812345678', email: 'ying@x.test', lineId: '@ying', address: '1 ถนนสุขุมวิท', notes: 'ชอบสีขาว' });
  const c1 = r.data;
  ok('เพิ่มลูกค้าครบทุกช่อง', r.status === 201 && c1.lineId === '@ying' && c1.address === '1 ถนนสุขุมวิท' && c1.notes === 'ชอบสีขาว', JSON.stringify(c1));
  r = await A.call('PUT', `/customers/${c1.id}`, { phone: '0899999999' });
  ok('แก้ไขลูกค้าเฉพาะบางช่อง ช่องอื่นคงเดิม', r.status === 200 && r.data.phone === '0899999999' && r.data.name === 'คุณสมหญิง' && r.data.lineId === '@ying');

  // phone numbers: Thai 9–10 digits or international, with the usual separators; anything else is refused
  const phoneTry = async (phone) => (await A.call('PUT', `/customers/${c1.id}`, { phone })).status;
  ok('เบอร์โทรมั่ว (ยาวเกิน, สั้นเกิน, มีตัวอักษร, ไม่ขึ้นต้นด้วย 0) → 400', (await Promise.all(['0821111111111111', '08123', 'abc', '1234567890', '081-234-567x'].map(phoneTry))).every((st) => st === 400));
  ok('เบอร์โทรที่ถูกรูปแบบ → บันทึกได้', (await Promise.all(['081-234-5678', '02 123 4567', '(02) 123-4567', '+66 81 234 5678', '02-123-4567 ต่อ 12', ''].map(phoneTry))).every((st) => st === 200));
  ok('เบอร์โทรมั่วในโปรเจ็กต์ใหม่ → 400 พร้อมข้อความ', await A.call('POST', '/projects', { title: 'เบอร์ผิด', phone: '0821111111111111' }).then((x) => x.status === 400 && x.data.error.includes('เบอร์โทรศัพท์ไม่ถูกต้อง')));
  ok('เบอร์โทรมั่วในใบเสนอราคาใหม่ → 400', (await A.call('POST', '/quotes', { clientName: 'คุณเอ', clientPhone: '12', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).status === 400);
  ok('เบอร์โทรร้านมั่วในหน้าตั้งค่า → 400', (await A.call('PUT', '/account', { name: 'สมใจ', businessPhone: 'โทรมาเลย' })).status === 400);
  await A.call('PUT', `/customers/${c1.id}`, { phone: '0899999999' });

  // customer email addresses get the same treatment
  const emailTry = async (email) => (await A.call('PUT', `/customers/${c1.id}`, { email })).status;
  ok('อีเมลลูกค้ามั่ว (ไม่มี @, ไม่มีโดเมน, มีช่องว่าง, จุดซ้อน) → 400', (await Promise.all(['abc', 'a@b', 'a b@c.com', '@x.com', 'a@b..com', 'a@.com'].map(emailTry))).every((st) => st === 400));
  ok('อีเมลลูกค้าที่ถูกรูปแบบ หรือเว้นว่าง → บันทึกได้', (await Promise.all(['ying@x.test', 'first.last+tag@sub.example.co.th', ''].map(emailTry))).every((st) => st === 200));
  ok('อีเมลมั่วในโปรเจ็กต์ใหม่ → 400 พร้อมข้อความ', await A.call('POST', '/projects', { title: 'อีเมลผิด', email: 'ไม่ใช่อีเมล' }).then((x) => x.status === 400 && x.data.error.includes('อีเมลไม่ถูกต้อง')));
  ok('อีเมลมั่วในใบเสนอราคาใหม่ → 400', (await A.call('POST', '/quotes', { clientName: 'คุณเอ', clientEmail: 'a@b', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).status === 400);
  await A.call('PUT', `/customers/${c1.id}`, { email: 'ying@x.test' });
  r = await A.call('PUT', `/customers/${c1.id}`, { name: '' });
  ok('แก้ชื่อลูกค้าเป็นว่าง ถูกปฏิเสธ', r.status === 400);

  ok('ร้านอื่นดูลูกค้าไม่ได้', (await B.call('GET', `/customers/${c1.id}`)).status === 404);
  ok('ร้านอื่นแก้ลูกค้าไม่ได้', (await B.call('PUT', `/customers/${c1.id}`, { name: 'x' })).status === 404);
  ok('ร้านอื่นลบลูกค้าไม่ได้', (await B.call('DELETE', `/customers/${c1.id}`)).status === 404);
  ok('รายชื่อลูกค้าของร้านอื่นไม่มีลูกค้าร้านนี้', !(await B.call('GET', '/customers')).data.some((c) => c.id === c1.id));
  ok('ร้านอื่นผูกโปรเจ็กต์กับลูกค้าร้านนี้ไม่ได้', (await B.call('POST', '/projects', { title: 'x', customerId: c1.id })).status === 404);
  ok('รหัสลูกค้าที่ไม่ใช่ตัวเลข → 404 ไม่ใช่ 500', (await A.call('GET', '/customers/abc')).status === 404 && (await A.call('POST', '/projects', { title: 'x', customerId: 'abc' })).status === 404);

  r = await A.call('POST', '/projects', {
    title: 'งานคุณสมหญิง', projectType: 'งานวันเกิด', customerId: c1.id, client: 'คุณสมหญิง', eventDate: thisMonth, profitMargin: 50,
    costItems: [{ name: 'ดอกไม้', quantity: 1, price: 4000 }],
  });
  const cp = r.data;
  ok('สร้างโปรเจ็กต์โดยเลือกลูกค้าจากรายชื่อ', r.status === 201 && cp.customerId === c1.id, cp?.customerId);
  r = await A.call('POST', '/quotes', { clientName: 'คุณสมหญิง', projectTitle: 'งานคุณสมหญิง', items: [{ description: 'จัดดอกไม้', quantity: 1, unitPrice: 6000 }] });
  const cq = r.data;
  ok('ใบเสนอราคาที่พิมพ์ชื่อตรงกับลูกค้าเดิม ผูกกับลูกค้าคนนั้น', cq.customerId === c1.id, cq.customerId);
  await A.call('POST', '/projects', { title: 'งาน ก', projectType: 'อื่นๆ', client: ' Somchai ' });
  await A.call('POST', '/quotes', { clientName: 'somchai' });
  r = await A.call('GET', '/customers');
  const somchai = r.data.filter((c) => c.name.toLowerCase() === 'somchai');
  ok('ชื่อเดียวกันต่างตัวพิมพ์/เว้นวรรค ไม่สร้างลูกค้าซ้ำ', somchai.length === 1 && somchai[0].projectCount === 1 && somchai[0].quoteCount === 1, JSON.stringify(somchai));

  ok('ยังไม่อนุมัติ ยอดซื้อรวมเป็น 0', r.data.find((c) => c.id === c1.id).totalSales === 0);
  r = await A.call('PUT', `/projects/${cp.id}`, { status: 'approved' });
  ok('เปลี่ยนสถานะโปรเจ็กต์ ลูกค้ายังผูกอยู่', r.data.customerId === c1.id);
  r = await A.call('GET', `/customers/${c1.id}`);
  ok('หน้าลูกค้า: ยอดซื้อรวม = ราคาขายของงานที่อนุมัติ (4,000 + 50% = 6,000)', Math.abs(r.data.totalSales - 6000) < 0.001 && r.data.soldCount === 1, r.data.totalSales);
  ok('หน้าลูกค้า: เห็นโปรเจ็กต์และใบเสนอราคาของลูกค้า', r.data.projects.length === 1 && r.data.projects[0].id === cp.id && r.data.quotes.length === 1 && r.data.quotes[0].id === cq.id);

  r = await A.call('PUT', `/customers/${c1.id}`, { name: 'คุณสมหญิง ใจดี' });
  r = await A.call('GET', `/projects/${cp.id}`);
  ok('เปลี่ยนชื่อลูกค้า โปรเจ็กต์ยังผูกอยู่', r.data.customerId === c1.id);
  r = await A.call('PUT', `/projects/${cp.id}`, { client: 'คุณใหม่', phone: '0800000000' });
  ok('เปลี่ยนชื่อลูกค้าในโปรเจ็กต์ → ย้ายไปผูกลูกค้าชื่อใหม่', r.data.customerId && r.data.customerId !== c1.id, r.data.customerId);
  const moved = r.data.customerId;
  r = await A.call('PUT', `/projects/${cp.id}`, { customerId: c1.id });
  ok('เลือกลูกค้าเดิมกลับจากรายชื่อได้', r.data.customerId === c1.id);

  r = await A.call('DELETE', `/customers/${c1.id}`);
  ok('ลบลูกค้าได้', r.status === 200 && (await A.call('GET', `/customers/${c1.id}`)).status === 404);
  r = await A.call('GET', `/projects/${cp.id}`);
  ok('ลบลูกค้าแล้ว โปรเจ็กต์ยังอยู่ ชื่อลูกค้ายังอยู่ แค่ไม่ผูก', r.status === 200 && r.data.customerId === null && r.data.client === 'คุณใหม่');
  ok('ลบลูกค้าแล้ว ใบเสนอราคายังอยู่', (await A.call('GET', `/quotes/${cq.id}`)).data.customerId === null);

  // records from before the customer list existed: the link step that runs on upgrade and after the data import
  await A.call('DELETE', `/customers/${moved}`);
  const link = () => execFileSync('node', ['--input-type=module', '-e', "import { db, LINK_CUSTOMERS, close } from './server/db.js'; await db.exec(LINK_CUSTOMERS); await close();"], { cwd: PROJECT_DIR, env: { ...process.env } });
  link();
  r = await A.call('GET', '/customers');
  const back = r.data.filter((c) => c.name === 'คุณใหม่');
  const total = r.data.length;
  ok('ข้อมูลเดิมที่ยังไม่ผูกลูกค้า: สร้างลูกค้าจากชื่อ พร้อมเบอร์โทร', back.length === 1 && back[0].phone === '0800000000' && back[0].projectCount === 1, JSON.stringify(back));
  ok('ข้อมูลเดิม: ใบเสนอราคาที่ชื่อ "คุณสมหญิง" ได้ลูกค้าของตัวเอง', r.data.some((c) => c.name === 'คุณสมหญิง' && c.quoteCount === 1));
  link();
  ok('รันขั้นตอนผูกลูกค้าซ้ำ ไม่สร้างลูกค้าเพิ่ม', (await A.call('GET', '/customers')).data.length === total);

  await A.call('DELETE', `/projects/${cp.id}`);
  await A.call('DELETE', `/quotes/${cq.id}`);
}

// --- forgotten password, sign out everywhere
{
  const outbox = () => (fs.existsSync(process.env.MAIL_OUTBOX_FILE) ? fs.readFileSync(process.env.MAIL_OUTBOX_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const tokenIn = (mail) => mail.text.match(/\/reset\?token=([0-9a-f]{64})/)?.[1];
  const F = client(), OLD = client(), OTHER = client();
  await F.call('POST', '/auth/register', { name: 'ลืมรหัส', email: 'forgot@x.test', password: 'password123' });
  await OLD.call('POST', '/auth/login', { email: 'forgot@x.test', password: 'password123' });

  r = await F.call('POST', '/auth/forgot', { email: 'not-an-email' });
  ok('ลืมรหัส: อีเมลผิดรูปแบบ ถูกปฏิเสธ', r.status === 400);
  const known = await OTHER.call('POST', '/auth/forgot', { email: 'Forgot@X.test' });
  const unknown = await OTHER.call('POST', '/auth/forgot', { email: 'ghost@x.test' });
  ok('ลืมรหัส: อีเมลที่มี/ไม่มีบัญชี ตอบเหมือนกัน (เดาไม่ได้ว่าใครเป็นสมาชิก)', known.status === 200 && unknown.status === 200 && JSON.stringify(known.data) === JSON.stringify(unknown.data));
  let mails = outbox();
  ok('ลืมรหัส: ส่งอีเมลเฉพาะบัญชีที่มีอยู่ 1 ฉบับ', mails.length === 1 && mails[0].to === 'forgot@x.test', JSON.stringify(mails.map((m) => m.to)));
  const first = tokenIn(mails[0]);
  ok('อีเมลมีลิงก์ตั้งรหัสผ่านใหม่', !!first);

  r = await OTHER.call('POST', '/auth/reset/check', { token: first });
  ok('ลิงก์ที่เพิ่งส่ง ใช้ได้', r.data.valid === true);
  r = await OTHER.call('POST', '/auth/reset/check', { token: 'f'.repeat(64) });
  ok('ลิงก์ปลอม ใช้ไม่ได้', r.data.valid === false);
  r = await OTHER.call('POST', '/auth/reset', { token: 'f'.repeat(64), password: 'whatever123' });
  ok('ตั้งรหัสด้วยลิงก์ปลอม ถูกปฏิเสธ', r.status === 400);
  r = await OTHER.call('POST', '/auth/reset', { token: first, password: 'short' });
  ok('ตั้งรหัสใหม่สั้นกว่า 8 ถูกปฏิเสธ และลิงก์ยังใช้ได้', r.status === 400 && (await OTHER.call('POST', '/auth/reset/check', { token: first })).data.valid);

  await OTHER.call('POST', '/auth/forgot', { email: 'forgot@x.test' });
  mails = outbox();
  const second = tokenIn(mails.at(-1));
  ok('ขอลิงก์ใหม่ ลิงก์เก่าใช้ไม่ได้อีก', mails.length === 2 && second !== first && (await OTHER.call('POST', '/auth/reset/check', { token: first })).data.valid === false);

  r = await OTHER.call('POST', '/auth/reset', { token: second, password: 'brandnew456' });
  ok('ตั้งรหัสผ่านใหม่สำเร็จ + เข้าสู่ระบบให้เลย', r.status === 200 && r.data.user.email === 'forgot@x.test' && (await OTHER.call('GET', '/projects')).status === 200, r.status);
  ok('คำตอบไม่มีรหัสผ่านหรือ token', !JSON.stringify(r.data).includes('hash'));
  r = await OTHER.call('POST', '/auth/reset', { token: second, password: 'another789' });
  ok('ลิงก์ใช้ได้ครั้งเดียว', r.status === 400);
  ok('ตั้งรหัสใหม่แล้ว เครื่องที่ login ค้างไว้ถูกออกจากระบบ', (await OLD.call('GET', '/projects')).status === 401 && (await F.call('GET', '/projects')).status === 401);
  r = await F.call('POST', '/auth/login', { email: 'forgot@x.test', password: 'password123' });
  ok('รหัสผ่านเดิมใช้ไม่ได้แล้ว', r.status === 401);
  r = await F.call('POST', '/auth/login', { email: 'forgot@x.test', password: 'brandnew456' });
  ok('login ด้วยรหัสผ่านใหม่ได้', r.status === 200);

  for (let i = 0; i < 4; i++) await client().call('POST', '/auth/forgot', { email: 'forgot@x.test' });
  ok('ขอลิงก์ถี่ ๆ ส่งอีเมลไม่เกิน 3 ฉบับใน 15 นาที', outbox().filter((m) => m.to === 'forgot@x.test').length === 3, outbox().length);

  // a link asked for before a password change in Settings must die with the old password
  const stale = tokenIn(outbox().at(-1));
  r = await F.call('PUT', '/account', { name: 'ลืมรหัส', currentPassword: 'brandnew456', newPassword: 'settings789' });
  ok('เปลี่ยนรหัสในหน้าตั้งค่า → ลิงก์รีเซ็ตที่ค้างอยู่ใช้ไม่ได้', r.status === 200 && (await OTHER.call('POST', '/auth/reset/check', { token: stale })).data.valid === false);

  r = await client().call('POST', '/auth/logout-all');
  ok('ออกจากระบบทุกเครื่อง: ต้อง login ก่อน', r.status === 401);
  const D1 = client(), D2 = client();
  await D1.call('POST', '/auth/login', { email: 'forgot@x.test', password: 'settings789' });
  await D2.call('POST', '/auth/login', { email: 'forgot@x.test', password: 'settings789' });
  r = await D1.call('POST', '/auth/logout-all');
  ok('ออกจากระบบทุกเครื่อง: ทุกเครื่องรวมเครื่องนี้ถูกออก', r.status === 200 && (await D1.call('GET', '/projects')).status === 401 && (await D2.call('GET', '/projects')).status === 401 && (await F.call('GET', '/projects')).status === 401);
  ok('ออกจากระบบทุกเครื่อง: ไม่กระทบร้านอื่น', (await B.call('GET', '/projects')).status === 200);
  r = await D1.call('POST', '/auth/login', { email: 'forgot@x.test', password: 'settings789' });
  ok('ออกทุกเครื่องแล้ว login ใหม่ได้', r.status === 200);

  for (let i = 0; i < 11; i++) r = await D1.call('PUT', '/account', { name: 'ลืมรหัส', currentPassword: 'guess-' + i, newPassword: 'whatever123' });
  ok('เดารหัสผ่านปัจจุบันในหน้าตั้งค่าหลายครั้ง ถูกจำกัด (429)', r.status === 429, r.status);
}

// --- sales report: by month, by customer, date range
{
  const R = client();
  await R.call('POST', '/auth/register', { name: 'ร้านรายงาน', email: 'report@x.test', password: 'password123' });
  const job = (title, client, eventDate, price, status = 'approved') =>
    R.call('POST', '/projects', { title, projectType: 'อื่นๆ', client, eventDate, profitMargin: 50, status, costItems: [{ name: 'x', quantity: 1, price }] });
  await job('ม.ค. 1', 'คุณเอ', '2026-01-10', 1000);
  await job('ม.ค. 2', 'คุณบี', '2026-01-20', 2000, 'completed');
  await job('มี.ค.', 'คุณเอ', '2026-03-05', 4000);
  await job('ยังไม่ขาย', 'คุณเอ', '2026-03-06', 9000, 'draft');
  await job('ยกเลิก', 'คุณบี', '2026-03-07', 9000, 'cancelled');
  await job('ไม่มีชื่อลูกค้า', '', '2026-03-08', 100);
  r = await R.call('GET', '/reports?from=2026-01-01&to=2026-12-31');
  const s = r.data.sales;
  ok('รายงานยอดขาย: รวมเฉพาะงานที่อนุมัติ/เสร็จสิ้น (ขาย 10,650 ต้นทุน 7,100 กำไร 3,550)', s.totals.jobs === 4 && s.totals.sales === 10650 && s.totals.cost === 7100 && s.totals.profit === 3550, JSON.stringify(s.totals));
  ok('รายเดือน: ม.ค. 2 งาน 4,500 และ มี.ค. 2 งาน 6,150 เรียงตามเวลา', s.byMonth.length === 2 && s.byMonth[0].key === '2026-01' && s.byMonth[0].sales === 4500 && s.byMonth[0].jobs === 2 && s.byMonth[1].sales === 6150 && s.byMonth[0].month === 'ม.ค. 2569', JSON.stringify(s.byMonth));
  ok('รายลูกค้า: เรียงจากยอดขายมากสุด (คุณเอ 7,500 · คุณบี 3,000 · ไม่ระบุ 150)', s.byCustomer.map((c) => `${c.name}:${c.sales}`).join() === 'คุณเอ:7500,คุณบี:3000,:150', JSON.stringify(s.byCustomer));
  ok('รายลูกค้า: ต้นทุนและกำไรต่อลูกค้า (คุณเอ ต้นทุน 5,000 กำไร 2,500)', s.byCustomer[0].cost === 5000 && s.byCustomer[0].profit === 2500 && s.byCustomer[0].jobs === 2 && !!s.byCustomer[0].customerId);
  ok('ยอดรายเดือนและรายลูกค้ารวมกันเท่ายอดรวม', [s.byMonth, s.byCustomer].every((g) => g.reduce((t, x) => t + x.sales, 0) === s.totals.sales && g.reduce((t, x) => t + x.profit, 0) === s.totals.profit));
  r = await R.call('GET', '/reports?from=2026-01-15&to=2026-03-05');
  ok('กรองช่วงวันที่ (15 ม.ค.–5 มี.ค.): รวมวันขอบทั้งสองด้าน', r.data.sales.totals.jobs === 2 && r.data.sales.totals.sales === 9000, JSON.stringify(r.data.sales.totals));
  r = await R.call('GET', '/reports?from=2026-03-01');
  ok('กำหนดแค่วันเริ่ม', r.data.sales.totals.sales === 6150 && r.data.sales.to === null);
  r = await R.call('GET', '/reports?from=xx&to=2026-13-99x');
  ok('วันที่ผิดรูปแบบ → ถือว่าไม่กำหนด ไม่ error', r.status === 200 && r.data.sales.totals.jobs === 4 && r.data.sales.from === null);
  r = await R.call('GET', '/reports?from=2030-01-01&to=2030-12-31');
  ok('ช่วงที่ไม่มีงาน → ว่าง ไม่ error', r.data.sales.totals.jobs === 0 && r.data.sales.byMonth.length === 0 && r.data.totals.projects === 6);
  ok('ร้านอื่นไม่เห็นยอดขายของร้านนี้', (await B.call('GET', '/reports?from=2026-01-01&to=2026-12-31')).data.sales.jobs.every((j) => !['ม.ค. 1', 'มี.ค.'].includes(j.title)));
}

// --- a heading's discount: a share of its price or an amount, taken off the price its margin gives
{
  r = await A.call('POST', '/projects', {
    title: 'งานมีส่วนลดหัวข้อ', projectType: 'อื่นๆ',
    costGroups: [
      { id: -1, name: 'ซุ้ม', markup: 50, discountType: 'percent', discount: 20 },
      { id: -2, name: 'ทีมงาน', markup: 100, discountType: 'baht', discount: 300 },
      { id: -3, name: 'ไม่ลด', markup: 10 },
      { id: -4, name: 'ค่ามั่ว', markup: 10, discountType: 'hacker', discount: -5 },
      { id: -5, name: 'เกินร้อย', markup: 10, discountType: 'percent', discount: 250 },
    ],
    costItems: [
      { groupId: -1, name: 'กุหลาบ', category: 'material', quantity: 2, price: 3000 },
      { groupId: -1, name: 'โอเอซิส', category: 'material', quantity: 1, price: 4000 },
      { groupId: -2, name: 'ทีม', category: 'labor', quantity: 1, price: 1000 },
    ],
  });
  const d = r.data;
  ok('ส่วนลดของหัวข้อถูกบันทึกทั้งแบบ % และแบบบาท', r.status === 201 && d.costGroups.slice(0, 2).map((g) => `${g.discountType}:${g.discount}`).join() === 'percent:20,baht:300', JSON.stringify(d.costGroups));
  ok('ไม่ได้ส่งส่วนลดมา → ไม่ลด · ประเภทที่ไม่มีจริงกับค่าติดลบ → ไม่ลด · % เกิน 100 → 100', d.costGroups.slice(2).map((g) => `${g.discountType}:${g.discount}`).join() === 'percent:0,percent:0,percent:100', JSON.stringify(d.costGroups.slice(2)));
  // 10,000 +50% = 15,000 −20% = 12,000 · 1,000 +100% = 2,000 −300 = 1,700 → 13,700 on a cost of 11,000
  ok('markup รวมของงานคิดจากราคาหลังลด (13,700 จากต้นทุน 11,000)', Math.abs(d.profitMargin - (13700 / 11000 - 1) * 100) < 1e-6, d.profitMargin);
  let q = await A.call('POST', '/quotes', { projectId: d.id, clientName: 'ลูกค้าส่วนลด', vatMode: 'none', items: [{ description: 'ทั้งงาน', quantity: 1, unitPrice: 13700 }] });
  ok('ใบเสนอราคาจากงานนี้ล็อกราคาหลังลด (13,700)', q.status === 201 && q.data.lockedPrice === 13700, JSON.stringify(q.data).slice(0, 200));
  q = await A.call('POST', '/quotes', { projectId: d.id, clientName: 'ลูกค้าส่วนลด', vatMode: 'none', items: [{ description: 'ราคาก่อนลด', quantity: 1, unitPrice: 17000 }] });
  ok('ใบเสนอราคาที่ใช้ราคาก่อนลด (17,000) ถูกปฏิเสธ', q.status === 400, q.status);
  r = await A.call('PUT', `/projects/${d.id}`, { costGroups: d.costGroups.map((g) => (g.name === 'ซุ้ม' ? { ...g, discountType: 'baht', discount: 500 } : g)), costItems: d.costItems });
  ok('แก้ส่วนลดจาก 20% เป็น 500 บาท → ราคางานเป็น 16,200 และหัวข้ออื่นคงเดิม', r.status === 200 && r.data.costGroups[0].discountType === 'baht' && r.data.costGroups[0].discount === 500 && r.data.costGroups[1].discount === 300 && Math.abs(r.data.profitMargin - (16200 / 11000 - 1) * 100) < 1e-6, JSON.stringify([r.data.costGroups.slice(0, 2), r.data.profitMargin]));
  r = await A.call('PUT', `/projects/${d.id}`, { notes: 'แก้อย่างอื่น' });
  ok('แก้ช่องอื่นของงาน ส่วนลดของหัวข้อไม่หาย', r.data.costGroups[0].discount === 500 && r.data.costGroups[1].discount === 300, JSON.stringify(r.data.costGroups.slice(0, 2)));
  const rep = (await A.call('GET', '/reports')).data.sales.jobs?.find((j) => j.title === 'งานมีส่วนลดหัวข้อ');
  if (rep) ok('รายงานยอดขายใช้ราคาหลังลด', rep.sales === 16200, JSON.stringify(rep));
  await A.call('DELETE', `/projects/${d.id}`);
}

// --- cost headings: own items, own margin; the job's price is the sum
{
  r = await A.call('POST', '/projects', {
    title: 'งานแบบหัวข้อ', projectType: 'อื่นๆ', status: 'approved', eventDate: '2031-05-05',
    costGroups: [{ id: -1, name: 'ซุ้มดอกไม้', markup: 100 }, { id: -2, name: 'ทีมงาน', markup: 25 }, { id: -3, name: 'ยังว่าง', markup: 10 }],
    costItems: [
      { groupId: -1, name: 'กุหลาบ', category: 'material', quantity: 10, price: 100 },
      { groupId: -2, name: 'ค่าแรงเจ้าของ', category: 'owner_labor', quantity: 1, price: 2000 },
      { groupId: -2, name: 'เก็บงาน', category: 'teardown', quantity: 1, price: 2000 },
      { groupId: 999, name: 'ไม่มีหัวข้อ', quantity: 1, price: 500 },
    ],
  });
  const d = r.data;
  const [g1, g2, g3] = d.costGroups;
  ok('สร้างโปรเจ็กต์ 3 หัวข้อ เก็บชื่อและ markup ครบ ตามลำดับ', r.status === 201 && d.costGroups.length === 3 && g1.name === 'ซุ้มดอกไม้' && g1.markup === 100 && g2.markup === 25 && g3.name === 'ยังว่าง', JSON.stringify(d.costGroups));
  ok('รายการอยู่ใต้หัวข้อของตัวเอง', d.costItems[0].groupId === g1.id && d.costItems[1].groupId === g2.id && d.costItems[2].groupId === g2.id);
  ok('รายการที่อ้างหัวข้อที่ไม่มีอยู่ ไปอยู่หัวข้อแรก', d.costItems[3].groupId === g1.id);
  ok('หมวดใหม่ "ค่าแรงเจ้าของ" และ "เก็บงาน/ขนส่งกลับ" บันทึกได้', d.costItems[1].category === 'owner_labor' && d.costItems[2].category === 'teardown');
  // (1,000 + 500) × 2 + 4,000 × 1.25 = 8,000 on a cost of 5,500
  ok('markup รวมของงานคิดจากผลรวมทุกหัวข้อ (ราคา 8,000 ÷ ต้นทุน 5,500)', Math.abs(d.profitMargin - (8000 / 5500 - 1) * 100) < 1e-9, String(d.profitMargin));
  r = await A.call('GET', '/reports?from=2031-05-01&to=2031-05-31');
  ok('รายงานยอดขายใช้ราคารวมทุกหัวข้อ (ขาย 8,000 ต้นทุน 5,500 กำไร 2,500)', r.data.sales.totals.sales === 8000 && r.data.sales.totals.cost === 5500 && r.data.sales.totals.profit === 2500, JSON.stringify(r.data.sales?.totals));
  // (making a quote moves the job out of "approved", so the report is checked first)
  r = await A.call('POST', '/quotes', { projectId: d.id, clientName: 'x', items: [{ description: 'รวม', quantity: 1, unitPrice: 8000 }] });
  ok('ใบเสนอราคาล็อกที่ราคารวมทุกหัวข้อ (8,000)', r.status === 201 && r.data.lockedPrice === 8000, JSON.stringify(r.data?.lockedPrice ?? r.data));

  r = await A.call('PUT', `/projects/${d.id}`, {
    costGroups: [{ id: g2.id, name: 'ทีมงานและเก็บงาน', markup: 50 }, { id: -9, name: 'ขนส่ง', markup: 0 }],
    costItems: [{ ...d.costItems[1] }, { ...d.costItems[2] }, { groupId: -9, name: 'รถ', category: 'transport', quantity: 1, price: 1000 }],
  });
  ok('แก้หัวข้อ: เปลี่ยนชื่อ/markup ลบหัวข้อ เพิ่มหัวข้อใหม่', r.status === 200 && r.data.costGroups.length === 2 && r.data.costGroups[0].name === 'ทีมงานและเก็บงาน' && r.data.costGroups[0].markup === 50 && r.data.costGroups[1].name === 'ขนส่ง', JSON.stringify(r.data.costGroups));
  ok('รายการตามหัวข้อไปถูกที่หลังบันทึกซ้ำ', r.data.costItems.length === 3 && r.data.costItems[0].groupId === r.data.costGroups[0].id && r.data.costItems[2].groupId === r.data.costGroups[1].id);
  ok('markup รวมอัปเดตตาม (ราคา 7,000 ÷ ต้นทุน 5,000 = 40%)', Math.abs(r.data.profitMargin - 40) < 1e-9, String(r.data.profitMargin));
  r = await A.call('PUT', `/projects/${d.id}`, { notes: 'แก้อย่างอื่น' });
  ok('แก้ช่องอื่น หัวข้อและ markup ไม่เปลี่ยน', r.data.costGroups.length === 2 && r.data.costGroups[0].markup === 50 && r.data.costGroups[1].markup === 0 && r.data.costItems.length === 3, JSON.stringify(r.data.costGroups));
  r = await A.call('PUT', `/projects/${d.id}`, { profitMargin: 20 });
  ok('ส่ง markup เดียวทั้งงาน (ไม่ส่งหัวข้อ) → ตั้งทุกหัวข้อเท่ากัน', r.data.costGroups.every((g) => g.markup === 20) && Math.abs(r.data.profitMargin - 20) < 1e-9, JSON.stringify(r.data.costGroups));
  r = await A.call('PUT', `/projects/${d.id}`, { costGroups: [{ id: 1, name: 'x', markup: 5000 }, { id: 2, name: 'y', markup: -500 }], costItems: [] });
  ok('markup นอกช่วงถูกปรับเข้า −100…1000', r.data.costGroups[0].markup === 1000 && r.data.costGroups[1].markup === -100, JSON.stringify(r.data.costGroups));
  r = await B.call('PUT', `/projects/${d.id}`, { costGroups: [] });
  ok('ร้านอื่นแก้หัวข้อของเราไม่ได้', r.status === 404);
  await A.call('DELETE', `/projects/${d.id}`);
}

// --- misc
r = await A.call('POST', '/projects', '{bad json');
ok('JSON เสีย → 400 ไม่ใช่ 500', r.status === 400, r.status);
r = await A.call('GET', '/nope');
ok('API ที่ไม่มี → 404', r.status === 404);
for (const bad of ['abc', '1.5', '-1', '99999999999999']) {
  r = await A.call('GET', `/projects/${bad}`);
  ok(`รหัสโปรเจ็กต์ที่ไม่ใช่ตัวเลข (${bad}) → 404 ไม่ใช่ 500`, r.status === 404, r.status);
}
r = await A.call('GET', '/quotes/abc');
ok('รหัสใบเสนอราคาที่ไม่ใช่ตัวเลข → 404 ไม่ใช่ 500', r.status === 404, r.status);
r = await A.call('POST', '/quotes', { clientName: 'x', projectId: 'abc' });
ok('ผูกใบเสนอราคากับรหัสโปรเจ็กต์ที่ไม่ใช่ตัวเลข → 404 ไม่ใช่ 500', r.status === 404, r.status);
r = await A.call('GET', '/activities?limit=1.5');
ok('limit ที่ไม่ใช่จำนวนเต็ม ไม่ error', r.status === 200 && r.data.length === 1, r.status);
r = await A.call('GET', '/activities?limit=-3');
ok('limit ติดลบ ไม่ error', r.status === 200, r.status);
{
  // ten projects created at the same moment must each get their own code
  const made = await Promise.all(Array.from({ length: 10 }, (_, i) => A.call('POST', '/projects', { title: `พร้อมกัน ${i}`, projectType: 'งานหมั้น' })));
  const codes = made.map((m) => m.data?.code);
  ok('สร้างโปรเจ็กต์พร้อมกัน 10 งาน รหัสไม่ซ้ำกัน', made.every((m) => m.status === 201) && new Set(codes).size === 10, codes.join(','));
  for (const m of made) await A.call('DELETE', `/projects/${m.data.id}`);
}
// --- what else a quote can carry: the customer's address, tax id and branch, a reference number, credit days,
//     a note for the shop only, and a unit on each line
{
  r = await A.call('POST', '/quotes', {
    clientName: 'บริษัท มาลีอีเวนต์ จำกัด', clientAddress: '  99/1 ถ.สุขุมวิท กรุงเทพฯ 10110  ', clientTaxId: '0105551234567', clientBranch: 'สำนักงานใหญ่',
    referenceNo: 'PO-2026-015', eventDate: '2026-12-20', creditDays: 30, internalNote: 'ลูกค้าขอส่วนลดเพิ่ม', vatMode: 'none',
    items: [{ description: 'กุหลาบ', quantity: 200, unit: ' ดอก ', unitPrice: 25 }, { description: 'ทีม', quantity: 2, unitPrice: 1500 }],
  });
  const q = r.data;
  ok('ใบเสนอราคาเก็บที่อยู่ เลขผู้เสียภาษี สาขา เลขที่อ้างอิง และโน้ตภายใน', r.status === 201 && q.clientAddress === '99/1 ถ.สุขุมวิท กรุงเทพฯ 10110' && q.clientTaxId === '0105551234567' && q.clientBranch === 'สำนักงานใหญ่' && q.referenceNo === 'PO-2026-015' && q.internalNote === 'ลูกค้าขอส่วนลดเพิ่ม', JSON.stringify(q).slice(0, 400));
  ok('เครดิต 30 วันหลังวันจัดงาน 20 ธ.ค. 2026 → ครบกำหนด 19 ม.ค. 2027', q.creditDays === 30 && q.dueDate === '2027-01-19' && !!q.dueDateText, `${q.creditDays} ${q.dueDate} ${q.dueDateText}`);
  ok('หน่วยของแต่ละรายการถูกเก็บ (ตัดช่องว่างหัวท้าย) รายการที่ไม่ส่งหน่วยมาเป็นว่าง และยอดเงินไม่เปลี่ยน', q.items[0].unit === 'ดอก' && q.items[1].unit === '' && q.totalAmount === 8000, JSON.stringify(q.items));
  const plain = (await A.call('POST', '/quotes', { clientName: 'ลูกค้าธรรมดา', items: [{ description: 'x', quantity: 1, unitPrice: 100 }] })).data;
  ok('ใบที่ไม่ได้ส่งช่องใหม่มา → ทุกช่องว่าง เครดิต 0 ไม่มีวันครบกำหนด', plain.clientAddress === '' && plain.clientTaxId === '' && plain.clientBranch === '' && plain.referenceNo === '' && plain.internalNote === '' && plain.creditDays === 0 && plain.dueDate === '' && plain.items[0].unit === '', JSON.stringify(plain).slice(0, 300));

  r = await A.call('PUT', `/quotes/${q.id}`, { status: 'sent' });
  ok('แก้แค่สถานะ → ช่องใหม่และหน่วยของรายการไม่หาย', r.status === 200 && r.data.clientAddress === q.clientAddress && r.data.clientTaxId === '0105551234567' && r.data.referenceNo === 'PO-2026-015' && r.data.creditDays === 30 && r.data.internalNote === 'ลูกค้าขอส่วนลดเพิ่ม' && r.data.items[0].unit === 'ดอก', JSON.stringify(r.data).slice(0, 300));
  const cust = (await A.call('GET', '/customers')).data.find((c) => c.name === 'บริษัท มาลีอีเวนต์ จำกัด');
  ok('รายชื่อลูกค้าบอกที่อยู่ เลขผู้เสียภาษี และสาขา จากใบเสนอราคาล่าสุดของลูกค้ารายนั้น', !!cust && cust.quoteAddress === '99/1 ถ.สุขุมวิท กรุงเทพฯ 10110' && cust.quoteTaxId === '0105551234567' && cust.quoteBranch === 'สำนักงานใหญ่', JSON.stringify(cust));
  ok('ลูกค้าที่ใบเสนอราคาไม่เคยมีข้อมูลนี้ → ว่าง', (await A.call('GET', '/customers')).data.find((c) => c.name === 'ลูกค้าธรรมดา')?.quoteTaxId === '');
  ok('ร้านอื่นไม่เห็นข้อมูลนี้', !(await B.call('GET', '/customers')).data.some((c) => c.quoteTaxId));

  r = await A.call('PUT', `/quotes/${q.id}`, { status: 'approved' });
  const made = await A.call('POST', `/quotes/${q.id}/project`);
  ok('สร้างโปรเจ็กต์จากใบเสนอราคา → รายการต้นทุนได้หน่วยของแต่ละรายการมาด้วย', made.status === 201 && made.data.costItems.map((i) => `${i.name}:${i.unit}`).join() === 'กุหลาบ:ดอก,ทีม:', JSON.stringify(made.data.costItems));

  r = await A.call('PUT', `/quotes/${plain.id}`, { creditDays: 999.6, clientTaxId: 'x'.repeat(40), clientBranch: 'b'.repeat(90), referenceNo: 'y'.repeat(100), clientAddress: 'z'.repeat(700), internalNote: 'n'.repeat(2500), items: [{ description: 'x', quantity: 1, unit: 'u'.repeat(50), unitPrice: 100 }] });
  ok('ค่าที่ยาวหรือมากเกินถูกจำกัด (เครดิต 365 · เลขภาษี 20 · สาขา 60 · อ้างอิง 60 · ที่อยู่ 500 · โน้ต 2,000 · หน่วย 30)', r.status === 200 && r.data.creditDays === 365 && r.data.clientTaxId.length === 20 && r.data.clientBranch.length === 60 && r.data.referenceNo.length === 60 && r.data.clientAddress.length === 500 && r.data.internalNote.length === 2000 && r.data.items[0].unit.length === 30, JSON.stringify([r.data.creditDays, r.data.clientTaxId.length, r.data.clientBranch.length, r.data.referenceNo.length, r.data.clientAddress.length, r.data.internalNote.length, r.data.items[0].unit.length]));
  ok('มีเครดิตแต่ไม่มีวันจัดงาน → ไม่มีวันครบกำหนด', r.data.dueDate === '' && r.data.dueDateText === '');
  r = await A.call('PUT', `/quotes/${plain.id}`, { creditDays: -5 });
  ok('เครดิตติดลบ → 0', r.data.creditDays === 0, r.data.creditDays);
  await A.call('DELETE', `/projects/${made.data.id}`);
  await A.call('DELETE', `/quotes/${q.id}`);
  await A.call('DELETE', `/quotes/${plain.id}`);
}

r = await A.call('POST', '/auth/logout');
r = await A.call('GET', '/auth/me');
ok('logout แล้ว me = null', r.data.user === null);

const S = client();
let okLogins = 0;
for (let i = 0; i < 12; i++) if ((await S.call('POST', '/auth/login', { email: 'b@x.test', password: 'password123' })).status === 200) okLogins++;
ok('login สำเร็จติดกัน 12 ครั้ง ไม่ถูกบล็อก (ร้านที่ใช้เน็ตเดียวกัน)', okLogins === 12, okLogins);
const T = client();
let last;
for (let i = 0; i < 12; i++) last = await T.call('POST', '/auth/login', { email: 'nobody@x.test', password: 'x' });
ok('login ผิดติดกันหลายครั้ง ถูกจำกัด (429)', last.status === 429, last.status);
r = await S.call('POST', '/auth/login', { email: 'b@x.test', password: 'password123' });
ok('คนที่ใส่รหัสผิดถูกบล็อก ไม่กระทบบัญชีอื่น', r.status === 200, r.status);

const failed = results.filter((x) => !x.pass);
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${!x.pass && x.extra ? '   → ' + x.extra : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน`);
process.exit(failed.length ? 1 : 0);
