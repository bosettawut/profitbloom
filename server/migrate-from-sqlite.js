// One-off move of the data from the first release (SQLite file / Turso) into PostgreSQL.
//
//   Source  TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, or the file in SQLITE_FILE (default data/profitbloom.db)
//   Target  DATABASE_URL
//
//   npm run migrate-data -- --dry-run    read the source and report, write nothing
//   npm run migrate-data                 copy; stops if the target already has data
//   npm run migrate-data -- --replace    empty the target first, then copy (for rehearsals)
//
// Everything is written in one transaction: either all of it arrives or nothing changes.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { close, connectionConfig, CUSTOMER_CREDIT, CUSTOMER_FROM_QUOTES, db, GROUP_COSTS, LINK_CUSTOMERS, ready, TIE_QUOTES, transaction, UNLOCK_AGREED } from './db.js';

const flags = new Set(process.argv.slice(2));
const DRY = flags.has('--dry-run');
const REPLACE = flags.has('--replace');

// parents before children
const TABLES = ['users', 'sessions', 'projects', 'cost_items', 'quotes', 'quote_items', 'activities'];
const WITH_ID = TABLES.filter((t) => t !== 'sessions');
const PLAN_RENAMES = { basic: 'starter', enterprise: 'pro' };

function openSource() {
  if (process.env.TURSO_DATABASE_URL) {
    return { label: process.env.TURSO_DATABASE_URL, client: createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }) };
  }
  const file = path.resolve(process.env.SQLITE_FILE || path.resolve(import.meta.dirname, '../data/profitbloom.db'));
  if (!fs.existsSync(file)) throw new Error(`ไม่พบไฟล์ฐานข้อมูลเดิม ${file} (กำหนด SQLITE_FILE หรือ TURSO_DATABASE_URL)`);
  return { label: file, client: createClient({ url: `file:${file}` }) };
}

/** A value from loosely-typed SQLite, made to fit the Postgres column; undefined = leave it to the column default. */
function fit(value, col) {
  if (value === null || value === undefined) return col.nullable ? null : undefined;
  if (col.type === 'integer') {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? n : col.nullable ? null : undefined;
  }
  if (col.type === 'double precision') {
    const n = Number(value);
    return Number.isFinite(n) ? n : col.nullable ? null : undefined;
  }
  // Postgres text cannot hold a NUL byte
  return String(value).replaceAll('\u0000', '');
}

const source = openSource();
try {
  const target = new URL(connectionConfig().connectionString);
  console.log(`จาก  ${source.label}`);
  console.log(`ไป   ${target.host}${target.pathname}${DRY ? '   (dry run: ไม่เขียนข้อมูล)' : ''}\n`);

  await ready();

  // ---- read the source, drop what the new database cannot (and should not) hold
  const rows = {};
  for (const t of TABLES) rows[t] = (await source.client.execute(`SELECT * FROM ${t}`)).rows.map((r) => ({ ...r }));
  const read = Object.fromEntries(TABLES.map((t) => [t, rows[t].length]));

  const now = new Date().toISOString();
  const ids = (t) => new Set(rows[t].map((r) => r.id));
  // SQLite never enforced the foreign keys, so rows whose owner was deleted may still be lying around
  const users = ids('users');
  rows.sessions = rows.sessions.filter((r) => users.has(r.user_id) && r.expires_at > now);
  rows.projects = rows.projects.filter((r) => users.has(r.user_id));
  rows.quotes = rows.quotes.filter((r) => users.has(r.user_id));
  rows.activities = rows.activities.filter((r) => users.has(r.user_id));
  const projects = ids('projects');
  const quotes = ids('quotes');
  rows.cost_items = rows.cost_items.filter((r) => projects.has(r.project_id));
  rows.quote_items = rows.quote_items.filter((r) => quotes.has(r.quote_id));
  let unlinked = 0;
  let customers = 0;
  for (const q of rows.quotes) {
    if (q.project_id !== null && !projects.has(q.project_id)) {
      q.project_id = null;
      unlinked++;
    }
  }
  for (const u of rows.users) {
    u.email = String(u.email).toLowerCase();
    u.plan = PLAN_RENAMES[u.plan] ?? u.plan;
  }
  {
    const seen = new Set();
    for (const u of rows.users) {
      if (seen.has(u.email)) throw new Error(`อีเมลซ้ำในฐานข้อมูลเดิม: ${u.email} — ต้องแก้ก่อนย้าย`);
      seen.add(u.email);
    }
  }

  // ---- write
  const columns = {};
  for (const t of TABLES) {
    columns[t] = (await db
      .prepare(`SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position`)
      .all(t));
  }

  async function insertAll(table) {
    for (const row of rows[table]) {
      const cols = [];
      const values = [];
      for (const col of columns[table]) {
        if (!(col.name in row)) continue; // column the old database never had: the default applies
        const v = fit(row[col.name], col);
        if (v === undefined) continue;
        cols.push(col.name);
        values.push(v);
      }
      await db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...values);
    }
  }

  const count = async (t) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n;
  const money = (list, a, b) => list.reduce((s, r) => s + (Number(r[a]) || 0) * (Number(r[b]) || 0), 0);

  if (!DRY) {
    await transaction(async () => {
      const existing = await count('users');
      if (existing && !REPLACE) throw new Error(`ฐานข้อมูลปลายทางมีข้อมูลอยู่แล้ว (${existing} บัญชี) — ถ้าตั้งใจเขียนทับให้ใส่ --replace`);
      if (existing) await db.exec(`TRUNCATE ${TABLES.join(', ')}, customers RESTART IDENTITY CASCADE`);
      for (const t of TABLES) await insertAll(t);
      // new rows must continue after the highest id that came across
      for (const t of WITH_ID) {
        await db.exec(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
      }

      // ---- check before committing: every kept row arrived, and the money adds up
      for (const t of TABLES) {
        const n = await count(t);
        if (n !== rows[t].length) throw new Error(`${t}: ย้ายไป ${n} แถว แต่ควรเป็น ${rows[t].length}`);
      }
      const cost = (await db.prepare('SELECT COALESCE(SUM(quantity * price), 0) AS v FROM cost_items').get()).v;
      const quoted = (await db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS v FROM quote_items').get()).v;
      const close2 = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
      if (!close2(cost, money(rows.cost_items, 'quantity', 'price'))) throw new Error('ยอดรวมต้นทุนไม่ตรงกับฐานข้อมูลเดิม');
      if (!close2(quoted, money(rows.quote_items, 'quantity', 'unit_price'))) throw new Error('ยอดรวมใบเสนอราคาไม่ตรงกับฐานข้อมูลเดิม');

      // the old database had no customer list: build it from the client names on jobs and quotes
      await db.exec(LINK_CUSTOMERS);
      await db.exec(GROUP_COSTS);
      // and its quotes were only copies of their jobs: the newest quote of each job becomes the one tied to it
      await db.exec(TIE_QUOTES);
      // the same rules as the database's own steps: customers start with their latest credit, and no quote of a
      // job made from a quote is locked to its price
      await db.exec(CUSTOMER_CREDIT);
      await db.exec(CUSTOMER_FROM_QUOTES);
      await db.exec(UNLOCK_AGREED);
      customers = await count('customers');
    });
  }

  // ---- report
  console.log('ตาราง'.padEnd(14) + 'ต้นทาง'.padStart(8) + (DRY ? 'จะย้าย' : 'ย้ายแล้ว').padStart(10) + 'ข้าม'.padStart(8));
  for (const t of TABLES) {
    console.log(t.padEnd(14) + String(read[t]).padStart(8) + String(rows[t].length).padStart(10) + String(read[t] - rows[t].length).padStart(8));
  }
  console.log(`\nต้นทุนรวม ${money(rows.cost_items, 'quantity', 'price').toLocaleString('th-TH')} บาท · ใบเสนอราคารวม ${money(rows.quote_items, 'quantity', 'unit_price').toLocaleString('th-TH')} บาท (ก่อนส่วนลด/ภาษี)`);
  console.log('ที่ข้าม: session ที่หมดอายุ และแถวที่เจ้าของ (ร้าน/โปรเจ็กต์/ใบเสนอราคา) ถูกลบไปแล้ว');
  if (!DRY) console.log(`สร้างรายชื่อลูกค้าจากชื่อในโปรเจ็กต์และใบเสนอราคา ${customers} ราย`);
  if (unlinked) console.log(`ใบเสนอราคา ${unlinked} ใบ ผูกกับโปรเจ็กต์ที่ถูกลบไปแล้ว จึงย้ายแบบไม่ผูกโปรเจ็กต์`);
  console.log(DRY ? '\nยังไม่ได้เขียนข้อมูล (dry run)' : '\nย้ายข้อมูลเสร็จและตรวจจำนวนแถว + ยอดเงินตรงกันแล้ว');

} catch (err) {
  console.error(`\nย้ายข้อมูลไม่สำเร็จ ไม่มีอะไรถูกเขียน: ${err.message}`);
  process.exitCode = 1;
} finally {
  source.client.close();
  await close();
}
