// Fills a shop with made-up customers and jobs, for trying the app on this machine.
// Usage: npm run seed-mock -- you@example.com your-password   (add --reset to replace the shop's jobs and customers)
// The account is created when the email has none yet; an account that exists keeps its own password.
// Only ever runs against a database on this machine.
import crypto from 'node:crypto';
import { close, connectionConfig, db, ready, transaction } from './db.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const reset = process.argv.includes('--reset');
const email = (args[0] || '').toLowerCase();
const password = args[1] || '';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const host = new URL(connectionConfig().connectionString).hostname;
if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) fail(`ข้อมูลตัวอย่างใส่ได้เฉพาะฐานข้อมูลบนเครื่อง (ตอนนี้ชี้ไปที่ ${host})`);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('ระบุอีเมล เช่น  npm run seed-mock -- you@example.com รหัสผ่าน');

// the same numbers on every run, so a figure seen on one machine can be found on another
let seed = 20261125;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const pad = (n, width = 2) => String(n).padStart(width, '0');

const CUSTOMERS = [
  ['คุณณัฐธิดา ศรีสุข', '081-234-5678'],
  ['คุณปกรณ์ วงศ์ทอง', '089-555-0142'],
  ['บริษัท สยามอีเวนต์ จำกัด', '02-123-4567'],
  ['คุณวรรณา ใจดี', '086-777-1290'],
  ['โรงแรมริเวอร์ไซด์ เชียงใหม่', '053-222-333'],
  ['คุณธนพล อินทร์แก้ว', '092-468-1357'],
  ['คุณสุภาวดี มณีรัตน์', '095-321-6540'],
  ['ร้านกาแฟบ้านสวน', '088-900-1122'],
];

// [type, code prefix, what the job is called, cheapest and dearest cost in baht]
const JOB_TYPES = [
  ['งานแต่งงาน', 'WD', 'งานแต่งงาน', 60000, 220000],
  ['งานแต่งงาน', 'WD', 'งานแต่งงาน', 60000, 220000],
  ['งานหมั้น', 'EN', 'งานหมั้น', 25000, 70000],
  ['งานวันเกิด', 'BD', 'งานวันเกิด', 8000, 30000],
  ['งานบวช', 'OR', 'งานบวช', 15000, 45000],
  ['งานเปิดร้าน', 'OP', 'งานเปิดร้าน', 10000, 40000],
  ['อื่นๆ', 'EV', 'งานอีเวนต์บริษัท', 30000, 120000],
];

// how a job's cost splits across its lines: [heading, item, category, unit, share of the cost]
const COST_LINES = [
  ['ดอกไม้และซุ้ม', 'ดอกไม้สด', 'material', 'กำ', 0.38],
  ['ดอกไม้และซุ้ม', 'โครงซุ้มและวัสดุตกแต่ง', 'rental', 'ชุด', 0.17],
  ['ทีมงานและขนส่ง', 'ค่าแรงทีมจัดดอกไม้', 'labor', 'คน', 0.2],
  ['ทีมงานและขนส่ง', 'ค่าแรงเจ้าของ', 'owner_labor', 'วัน', 0.1],
  ['ทีมงานและขนส่ง', 'ค่าขนส่งไป-กลับ', 'transport', 'เที่ยว', 0.09],
  ['ทีมงานและขนส่ง', 'เก็บงานและขนกลับ', 'teardown', 'เที่ยว', 0.06],
];

function plan() {
  const today = new Date();
  const thisYear = today.getFullYear();
  const todayIso = `${thisYear}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const jobs = [];
  const counters = {};
  for (const year of [thisYear - 2, thisYear - 1, thisYear]) {
    for (let month = 1; month <= 12; month++) {
      // the wedding season (November to February) is busier
      const busy = [11, 12, 1, 2].includes(month);
      for (let n = between(busy ? 2 : 1, busy ? 4 : 2); n > 0; n--) {
        const [type, prefix, word, lo, hi] = pick(JOB_TYPES);
        const [client, phone] = pick(CUSTOMERS);
        const eventDate = `${year}-${pad(month)}-${pad(between(1, 28))}`;
        const past = eventDate < todayIso;
        const roll = random();
        // jobs already held are mostly done; those still to come are spread over every step before that
        const status = past
          ? roll < 0.8 ? 'completed' : roll < 0.92 ? 'cancelled' : 'approved'
          : roll < 0.35 ? 'approved' : roll < 0.55 ? 'pending' : roll < 0.75 ? 'quote_created' : roll < 0.92 ? 'draft' : 'cancelled';
        const count = (counters[`${prefix}-${year}`] = (counters[`${prefix}-${year}`] || 0) + 1);
        const cost = Math.round(between(lo, hi) / 500) * 500;
        jobs.push({
          year, prefix, count, type, client, phone, eventDate, status, cost,
          code: `${prefix}-${year}-${pad(count, 3)}`,
          title: `${word} ${client.replace(/^คุณ/, '').split(' ')[0]}`,
          markup: between(18, 60),
          // some finished jobs have their real costs filled in: most ran a little over
          actualFactor: status === 'completed' && random() < 0.4 ? 0.95 + random() * 0.25 : null,
        });
      }
    }
  }
  return { jobs, counters };
}

await ready();
let user = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!user && password.length < 8) fail('ยังไม่มีบัญชีนี้ ให้ระบุรหัสผ่านอย่างน้อย 8 ตัวอักษรต่อท้ายอีเมล เพื่อสร้างบัญชี');

const summary = await transaction(async () => {
  if (!user) {
    const salt = crypto.randomBytes(16);
    const hash = `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
    const { lastInsertRowid } = await db
      .prepare("INSERT INTO users (name, email, password_hash, plan, trial_ends_at) VALUES (?, ?, ?, 'trial', ?) RETURNING id")
      .run('ร้านดอกไม้ตัวอย่าง', email, hash, new Date(Date.now() + 30 * 864e5).toISOString());
    user = { id: Number(lastInsertRowid), created: true };
  }
  const existing = (await db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(user.id)).n;
  if (existing && !reset) return { existing };
  if (reset) {
    for (const table of ['quotes', 'projects', 'customers', 'activities']) await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id);
  }

  const customerIds = new Map();
  for (const [name, phone] of CUSTOMERS) {
    const { lastInsertRowid } = await db.prepare('INSERT INTO customers (user_id, name, phone) VALUES (?, ?, ?) RETURNING id').run(user.id, name, phone);
    customerIds.set(name, lastInsertRowid);
  }

  const { jobs, counters } = plan();
  for (const job of jobs) {
    // a job is opened about six weeks before its day
    const created = new Date(new Date(job.eventDate).getTime() - 45 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
    const { lastInsertRowid: projectId } = await db
      .prepare(`INSERT INTO projects (user_id, code, title, project_type, client, phone, event_date, budget, status, profit_margin, customer_id, owner_labor, teardown, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?) RETURNING id`)
      .run(user.id, job.code, job.title, job.type, job.client, job.phone, job.eventDate, Math.round(job.cost * 1.6), job.status, job.markup, customerIds.get(job.client), created, created);
    const groupIds = new Map();
    for (const [i, [heading, name, category, unit, share]] of COST_LINES.entries()) {
      if (!groupIds.has(heading)) {
        const { lastInsertRowid } = await db.prepare('INSERT INTO cost_groups (project_id, name, markup, sort) VALUES (?, ?, ?, ?) RETURNING id').run(projectId, heading, job.markup, groupIds.size);
        groupIds.set(heading, lastInsertRowid);
      }
      const quantity = category === 'material' ? between(10, 40) : category === 'labor' ? between(2, 6) : 1;
      const price = Math.round((job.cost * share) / quantity);
      const actual = job.actualFactor === null ? null : Math.round(quantity * price * (job.actualFactor + (random() - 0.5) * 0.1));
      await db
        .prepare('INSERT INTO cost_items (project_id, group_id, name, category, quantity, unit, price, actual, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(projectId, groupIds.get(heading), name, category, quantity, unit, price, actual, i);
    }
  }
  // the next job made in the app takes the number after the last one here
  for (const [key, n] of Object.entries(counters)) {
    const [prefix, year] = key.split('-');
    await db.prepare('INSERT INTO doc_counters (user_id, prefix, year, last_n) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, prefix, year) DO UPDATE SET last_n = GREATEST(doc_counters.last_n, EXCLUDED.last_n)')
      .run(user.id, prefix, Number(year), n);
  }
  return { jobs: jobs.length, customers: CUSTOMERS.length, years: [...new Set(jobs.map((j) => j.year))] };
});
await close();

if (summary.existing) fail(`บัญชี ${email} มีโปรเจ็กต์อยู่แล้ว ${summary.existing} งาน — เติม --reset ถ้าต้องการลบงาน ใบเสนอราคา และลูกค้าของบัญชีนี้ แล้วใส่ข้อมูลตัวอย่างแทน`);
console.log(`${user.created ? 'สร้างบัญชี' : 'ใช้บัญชี'} ${email} และใส่ข้อมูลตัวอย่างแล้ว: ${summary.jobs} โปรเจ็กต์ ${summary.customers} ลูกค้า (ปี ${summary.years.join(', ')})`);
console.log('เปิด http://localhost:5173/login แล้วเข้าสู่ระบบด้วยอีเมลนี้');
