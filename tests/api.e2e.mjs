// End-to-end API checks for ProfitBloom. Run with `npm test` (starts its own server on a throwaway database).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.BASE;
const PROJECT_DIR = process.env.PROJECT_DIR;
const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra });

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
r = await A.call('POST', '/quotes', {
  projectId: p1.id, clientName: 'ลูกค้า1', projectTitle: 'งานแต่ง 1', validUntil: iso(new Date(Date.now() + 10 * 864e5)),
  taxRate: 7, discountRate: 10, items: [{ description: 'แพ็กดอกไม้', quantity: 2, unitPrice: 1000 }],
});
ok('ใบเสนอราคาจากโปรเจ็กต์ที่ยอดไม่เท่าราคาโปรเจ็กต์ (1,800 ≠ 2,500) ถูกปฏิเสธ', r.status === 400 && r.data.error.includes('2,500'), JSON.stringify(r.data));
r = await A.call('POST', '/quotes', {
  projectId: p1.id, clientName: 'ลูกค้า1', projectTitle: 'งานแต่ง 1', validUntil: iso(new Date(Date.now() + 10 * 864e5)),
  taxRate: 7, items: [{ description: 'แพ็กดอกไม้', quantity: 2, unitPrice: 1250 }],
});
const q1 = r.data;
ok('ใบเสนอราคาจากโปรเจ็กต์ ล็อกราคาโปรเจ็กต์ไว้ (2,000 + 25% = 2,500)', q1.lockedPrice === 2500, q1.lockedPrice);
ok('สร้างใบเสนอราคา + รหัส QT', r.status === 201 && /^QT-\d{4}-001$/.test(q1.code), q1?.code);
ok('ยอดรวม: 2,500 + VAT 7% = 2,675', q1.totalAmount === 2675 && q1.vatMode === 'exclusive', q1.totalAmount);
r = await A.call('GET', `/projects/${p1.id}`);
ok('สร้างใบเสนอราคา → โปรเจ็กต์เป็น "สร้างใบเสนอราคาแล้ว"', r.data.status === 'quote_created', r.data.status);
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
  r = await make({ taxRate: 7, items: [{ description: 'a', quantity: 3, unitPrice: 33.33 }, { description: 'b', quantity: 1, unitPrice: 10.5 }] });
  ok('ปัดเป็นบาทเต็มทุกบรรทัด: 99.99→100, 10.50→11, VAT 7% ของ 111 = 8, รวม 119', r.data.items[0].total === 100 && r.data.items[1].total === 11 && r.data.totalAmount === 119, JSON.stringify([r.data.items.map((i) => i.total), r.data.totalAmount]));
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

  // locked price: project costs 3 × 333.33 + extra (not in the price), markup 50% → 1,499.985 → 1,500
  r = await A.call('POST', '/projects', {
    title: 'งานล็อกราคา', projectType: 'อื่นๆ', profitMargin: 50,
    costItems: [{ name: 'ดอกไม้', quantity: 3, price: 333.33 }, { name: 'งอก', quantity: 1, price: 0, isExtra: true, actual: 500 }],
  });
  const lp = r.data;
  const line = (unitPrice, quantity = 1) => [{ description: 'ดอกไม้', quantity, unitPrice }];
  r = await make({ projectId: lp.id, items: line(1500) });
  const lq = r.data;
  ok('ล็อกราคาเป็นบาทเต็ม (1,500) และไม่รวมรายการงอก', r.status === 201 && lq.lockedPrice === 1500, JSON.stringify(r.data));
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
  await A.call('PUT', `/projects/${lp.id}`, { profitMargin: 100 });
  r = await A.call('PUT', `/quotes/${lq.id}`, { notes: 'x', status: 'sent' });
  ok('ราคาโปรเจ็กต์เปลี่ยนทีหลัง ราคาที่ล็อกในใบเสนอราคาไม่เปลี่ยน', r.status === 200 && r.data.lockedPrice === 1500, r.data.lockedPrice);
  r = await A.call('POST', '/projects', { title: 'งานยังไม่มีต้นทุน', projectType: 'อื่นๆ' });
  const empty = r.data;
  r = await make({ projectId: empty.id, items: line(900) });
  ok('โปรเจ็กต์ที่ยังไม่มีต้นทุน ไม่ล็อกราคา', r.status === 201 && r.data.lockedPrice === null);
  for (const id of [lp.id, empty.id]) await A.call('DELETE', `/projects/${id}`);
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
