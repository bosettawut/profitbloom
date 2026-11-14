import express from 'express';
import crypto from 'node:crypto';
import { db, NOW, ready, transaction } from './db.js';
import { passwordResetMail, sendMail } from './mail.js';
import { lineAmount, projectPrice, quoteTotals, VAT_MODES } from '../shared/quote-math.js';

const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const SESSION_COOKIE = 'pb_session';
const SESSION_DAYS = 30;
const TRIAL_DAYS = 30;
const RESET_MINUTES = 60;

export const app = express();
// behind Vercel's proxy: trust X-Forwarded-For so req.ip is the visitor, not the proxy
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const route = (fn) => (req, res, next) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((out) => {
      if (out !== undefined) res.json(out);
    })
    .catch(next);
};

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
};
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
/** a row id from the URL or the request body; anything that isn't a plain positive integer is null */
const rowId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};

const thaiDate = (iso) =>
  iso ? new Date(iso.replace(' ', 'T') + (iso.length > 10 ? 'Z' : '')).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

async function logActivity(userId, kind, title, detail = '') {
  await db.prepare('INSERT INTO activities (user_id, kind, title, detail) VALUES (?, ?, ?, ?)').run(userId, kind, title, detail);
}

// ---------- auth ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// checked when the email is unknown, so "no such account" takes as long as "wrong password"
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Signs the user out on every device. */
const endAllSessions = (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires.toISOString());
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, expires, path: '/' });
}

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  businessName: u.business_name,
  businessAddress: u.business_address,
  businessPhone: u.business_phone,
  businessTaxId: u.business_tax_id,
  businessLogo: u.business_logo,
  // the ProfitBloom subscription this shop is on; changed by ProfitBloom, not by the shop
  plan: u.plan,
  trialEndsAt: u.trial_ends_at,
  role: u.role,
  rules: parseRules(u.rules),
  // how new quotes treat VAT unless changed on the quote itself
  vatMode: u.vat_mode,
});

// business rules for the decision engine; anything missing falls back to the app defaults
const RULE_LIMITS = {
  highRiskMargin: [0, 90],
  minMargin: [0, 90],
  goodMargin: [0, 95],
  depositPct: [0, 100],
  dailyWage: [0, 100000],
  vehicleCost: [0, 1000000],
  laborOverrunPct: [0, 500],
};
function parseRules(text) {
  try {
    const raw = JSON.parse(text || '{}');
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in RULE_LIMITS && Number.isFinite(v)));
  } catch {
    return {};
  }
}

// Brute-force guard. Only failures count, keyed per IP + email, so people sharing one shop
// network don't lock each other out; a second, higher limit per account stops guessing spread
// over many addresses. Attempts live in the database because serverless instances share no memory.
// Keys are stored hashed: the table never holds an IP address or an email.
const WINDOW = 15 * 60e3;
const windowStart = () => new Date(Date.now() - WINDOW).toISOString();
async function recent(key, max) {
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM auth_attempts WHERE key = ? AND created_at > ?').get(sha256(key), windowStart());
  return n >= max;
}
const record = (key) => db.prepare('INSERT INTO auth_attempts (key, created_at) VALUES (?, ?)').run(sha256(key), new Date().toISOString());
const forget = (key) => db.prepare('DELETE FROM auth_attempts WHERE key = ?').run(sha256(key));
const TOO_MANY = 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่';
const TOO_MANY_REQUESTS = 'ทำรายการบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่';

let cleaned = false;
app.use((req, _res, next) => loadSession(req).then(() => next(), next));
async function loadSession(req) {
  await ready();
  if (!cleaned) {
    // clear what has expired once per server start
    cleaned = true;
    const now = new Date().toISOString();
    await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    await db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now);
    await db.prepare('DELETE FROM auth_attempts WHERE created_at <= ?').run(windowStart());
  }
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    const row = await db
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0')
      .get(token, new Date().toISOString());
    if (row) {
      req.user = row;
      req.sessionToken = token;
    }
  }
}

app.post('/api/auth/register', route(async (req, res) => {
  if (await recent(`signup:${req.ip}`, 20)) throw new HttpError(429, TOO_MANY);
  await record(`signup:${req.ip}`);
  const name = str(req.body.name, 100);
  const email = str(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'รูปแบบอีเมลไม่ถูกต้อง');
  if (password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'อีเมลนี้ถูกใช้งานแล้ว');
  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 864e5).toISOString();
  const { lastInsertRowid } = await db
    .prepare("INSERT INTO users (name, email, password_hash, plan, trial_ends_at) VALUES (?, ?, ?, 'trial', ?) RETURNING id")
    .run(name, email, hashPassword(password), trialEnds);
  await startSession(res, Number(lastInsertRowid));
  return { user: publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid)) };
}));

app.post('/api/auth/login', route(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const key = `login:${req.ip}:${email}`;
  const accountKey = `login-account:${email}`;
  if ((await recent(key, 10)) || (await recent(accountKey, 50))) throw new HttpError(429, TOO_MANY);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!verifyPassword(password, user ? user.password_hash : DUMMY_HASH) || !user) {
    await record(key);
    await record(accountKey);
    throw new HttpError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  await forget(key);
  if (user.disabled) throw new HttpError(403, 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อทีม ProfitBloom');
  await startSession(res, user.id);
  return { user: publicUser(user) };
}));

app.post('/api/auth/logout', route(async (req, res) => {
  if (req.sessionToken) await db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
}));

app.get('/api/auth/me', route(async (req) => ({ user: req.user ? publicUser(req.user) : null })));

// ---------- forgotten password ----------

/** Where the web app lives, for links in emails. Never taken from the request in production (the Host header can be forged). */
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (IS_PROD) throw new Error('ต้องตั้งค่า APP_URL เพื่อส่งลิงก์ตั้งรหัสผ่านใหม่');
  return req.get('origin') || `${req.protocol}://${req.get('host')}`;
}

async function findReset(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  return db
    .prepare('SELECT r.token_hash, u.* FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > ? AND u.disabled = 0')
    .get(sha256(token), new Date().toISOString());
}
const RESET_EXPIRED = 'ลิงก์นี้ใช้ไม่ได้แล้วหรือหมดอายุ กรุณาขอลิงก์ใหม่';

// Always answers the same way, whether or not the email belongs to an account.
app.post('/api/auth/forgot', route(async (req) => {
  const email = str(req.body.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'รูปแบบอีเมลไม่ถูกต้อง');
  const ipKey = `forgot:${req.ip}`;
  const emailKey = `forgot-email:${email}`;
  if (await recent(ipKey, 10)) throw new HttpError(429, TOO_MANY_REQUESTS);
  await record(ipKey);
  // at most three emails per address per window, however many people ask
  const quiet = await recent(emailKey, 3);
  const user = quiet ? null : await db.prepare('SELECT * FROM users WHERE email = ? AND disabled = 0').get(email);
  if (user) {
    await record(emailKey);
    const token = crypto.randomBytes(32).toString('hex');
    const link = `${appUrl(req)}/reset?token=${token}`;
    await transaction(async () => {
      // only the newest link works, and only its hash is stored
      await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
      await db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(sha256(token), user.id, new Date(Date.now() + RESET_MINUTES * 60e3).toISOString());
    });
    await sendMail({ to: user.email, ...passwordResetMail({ name: user.name, link, minutes: RESET_MINUTES }) });
  }
  return { ok: true };
}));

app.post('/api/auth/reset/check', route(async (req) => ({ valid: !!(await findReset(req.body.token)) })));

app.post('/api/auth/reset', route(async (req, res) => {
  const ipKey = `reset:${req.ip}`;
  if (await recent(ipKey, 20)) throw new HttpError(429, TOO_MANY_REQUESTS);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (password.length < 8) throw new HttpError(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  const user = await findReset(req.body.token);
  if (!user) {
    await record(ipKey);
    throw new HttpError(400, RESET_EXPIRED);
  }
  await transaction(async () => {
    // the link is spent the moment it is used; a second request with it finds nothing
    const { changes } = await db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(user.token_hash);
    if (!changes) throw new HttpError(400, RESET_EXPIRED);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
    // whoever knew the old password is signed out everywhere
    await endAllSessions(user.id);
  });
  await forget(`login-account:${user.email}`);
  await startSession(res, user.id);
  return { user: publicUser(user) };
}));

// everything below requires login
app.use('/api', (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'กรุณาเข้าสู่ระบบ'))));

app.post('/api/auth/logout-all', route(async (req, res) => {
  await endAllSessions(req.user.id);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
}));

app.put('/api/account', route(async (req) => {
  const name = str(req.body.name, 100);
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อ');
  await db.prepare('UPDATE users SET name = ?, business_name = ?, business_address = ?, business_phone = ?, business_tax_id = ? WHERE id = ?').run(
    name,
    str(req.body.businessName, 200),
    str(req.body.businessAddress, 500),
    str(req.body.businessPhone, 50),
    str(req.body.businessTaxId, 50),
    req.user.id,
  );
  if (req.body.rules && typeof req.body.rules === 'object') {
    const rules = {};
    for (const [k, [min, max]] of Object.entries(RULE_LIMITS)) {
      if (req.body.rules[k] !== undefined && req.body.rules[k] !== null && req.body.rules[k] !== '') rules[k] = num(req.body.rules[k], { min, max });
    }
    if (rules.highRiskMargin !== undefined && rules.minMargin !== undefined && rules.highRiskMargin > rules.minMargin)
      throw new HttpError(400, 'Margin เสี่ยงสูง ต้องไม่มากกว่า Margin ขั้นต่ำ');
    if (rules.minMargin !== undefined && rules.goodMargin !== undefined && rules.minMargin > rules.goodMargin)
      throw new HttpError(400, 'Margin ขั้นต่ำ ต้องไม่มากกว่า Margin ที่ดี');
    await db.prepare('UPDATE users SET rules = ? WHERE id = ?').run(JSON.stringify(rules), req.user.id);
  }
  if (VAT_MODES.includes(req.body.vatMode)) await db.prepare('UPDATE users SET vat_mode = ? WHERE id = ?').run(req.body.vatMode, req.user.id);
  if ('businessLogo' in req.body) {
    const logo = typeof req.body.businessLogo === 'string' ? req.body.businessLogo : '';
    // logos arrive pre-shrunk from the browser as a data URL; cap at ~300 KB
    if (logo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 400_000))
      throw new HttpError(400, 'ไฟล์โลโก้ไม่ถูกต้องหรือใหญ่เกินไป (PNG, JPG หรือ WebP)');
    await db.prepare('UPDATE users SET business_logo = ? WHERE id = ?').run(logo, req.user.id);
  }
  const { currentPassword, newPassword } = req.body;
  if (newPassword) {
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw new HttpError(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
    const key = `password:${req.user.id}`;
    if (await recent(key, 10)) throw new HttpError(429, TOO_MANY_REQUESTS);
    if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, req.user.password_hash)) {
      await record(key);
      throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }
    await forget(key);
    await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(req.user.id);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.sessionToken);
  }
  return { user: publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) };
}));

// ---------- customers ----------

function serializeCustomer(c) {
  return {
    id: String(c.id),
    name: c.name,
    phone: c.phone,
    email: c.email,
    lineId: c.line_id,
    address: c.address,
    notes: c.notes,
    createdDate: thaiDate(c.created_at),
  };
}

async function getCustomer(userId, id) {
  const c = await db.prepare('SELECT * FROM customers WHERE id = ? AND user_id = ?').get(rowId(id), userId);
  if (!c) throw new HttpError(404, 'ไม่พบลูกค้า');
  return c;
}

function readCustomerBody(body) {
  const name = str(body.name, 200);
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อลูกค้า');
  return {
    name,
    phone: str(body.phone, 50),
    email: str(body.email, 200),
    line_id: str(body.lineId, 100),
    address: str(body.address, 1000),
    notes: str(body.notes, 5000),
  };
}

/**
 * The customer a project or quote belongs to. A customer picked from the list wins; otherwise the
 * typed name is matched against the shop's customers (ignoring case) and a new customer is created
 * when there is none, so every job with a client name shows up under a customer.
 */
async function resolveCustomer(userId, customerId, name, phone, email) {
  if (customerId) return (await getCustomer(userId, customerId)).id;
  if (!name) return null;
  // one at a time per shop: two saves arriving together must not both create the customer
  await db.prepare('SELECT pg_advisory_xact_lock(?::bigint)').get(userId);
  const found = await db.prepare('SELECT id FROM customers WHERE user_id = ? AND lower(name) = lower(?) ORDER BY id LIMIT 1').get(userId, name);
  if (found) return found.id;
  const { lastInsertRowid } = await db
    .prepare('INSERT INTO customers (user_id, name, phone, email) VALUES (?, ?, ?, ?) RETURNING id')
    .run(userId, name, phone, email);
  return Number(lastInsertRowid);
}

/** which customer a save points at: `customerId` in the request picks one, a changed name is looked up again */
function customerChoice(body, existing, nameKey, existingName) {
  if ('customerId' in body) return body.customerId ? rowId(body.customerId) ?? -1 : null;
  if (existing && (!(nameKey in body) || str(body[nameKey], 200).toLowerCase() === existingName.toLowerCase())) return existing.customer_id;
  return null;
}

/** every customer of the shop with how much they have bought; sales count as in the reports */
async function customerSummaries(userId) {
  const customers = await db.prepare('SELECT * FROM customers WHERE user_id = ? ORDER BY name, id').all(userId);
  const projects = await projectFinancials(userId);
  const quotes = await db.prepare('SELECT customer_id, COUNT(*) AS n FROM quotes WHERE user_id = ? AND customer_id IS NOT NULL GROUP BY customer_id').all(userId);
  const quoteCount = new Map(quotes.map((q) => [q.customer_id, q.n]));
  return customers.map((c) => {
    const mine = projects.filter((p) => p.customer_id === c.id);
    const sold = mine.filter((p) => p.sold);
    return {
      ...serializeCustomer(c),
      projectCount: mine.length,
      quoteCount: quoteCount.get(c.id) ?? 0,
      soldCount: sold.length,
      totalSales: sold.reduce((s, p) => s + p.sales, 0),
      lastEventDate: mine.map((p) => p.event_date || '').sort().pop() || '',
    };
  });
}

app.get('/api/customers', route(async (req) => customerSummaries(req.user.id)));

app.get('/api/customers/:id', route(async (req) => {
  const c = await getCustomer(req.user.id, req.params.id);
  const summary = (await customerSummaries(req.user.id)).find((x) => x.id === String(c.id));
  const projects = await db.prepare('SELECT * FROM projects WHERE user_id = ? AND customer_id = ? ORDER BY created_at DESC, id DESC').all(req.user.id, c.id);
  const quotes = await db.prepare('SELECT * FROM quotes WHERE user_id = ? AND customer_id = ? ORDER BY created_at DESC, id DESC').all(req.user.id, c.id);
  return {
    ...summary,
    projects: await Promise.all(projects.map(serializeProject)),
    quotes: await Promise.all(quotes.map(serializeQuote)),
  };
}));

app.post('/api/customers', route(async (req, res) => {
  const d = readCustomerBody(req.body);
  const { lastInsertRowid } = await db
    .prepare('INSERT INTO customers (user_id, name, phone, email, line_id, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .run(req.user.id, d.name, d.phone, d.email, d.line_id, d.address, d.notes);
  await logActivity(req.user.id, 'customer_created', `ลูกค้าใหม่ - ${d.name}`, 'เพิ่มแล้ว');
  res.status(201);
  return serializeCustomer(await getCustomer(req.user.id, lastInsertRowid));
}));

app.put('/api/customers/:id', route(async (req) => {
  const existing = await getCustomer(req.user.id, req.params.id);
  const d = readCustomerBody({ ...serializeCustomer(existing), ...req.body });
  await db.prepare(`UPDATE customers SET name=?, phone=?, email=?, line_id=?, address=?, notes=?, updated_at=${NOW} WHERE id = ? AND user_id = ?`)
    .run(d.name, d.phone, d.email, d.line_id, d.address, d.notes, existing.id, req.user.id);
  return serializeCustomer(await getCustomer(req.user.id, existing.id));
}));

app.delete('/api/customers/:id', route(async (req) => {
  const c = await getCustomer(req.user.id, req.params.id);
  // their projects and quotes stay, with the name still on them; the database clears the link
  await db.prepare('DELETE FROM customers WHERE id = ?').run(c.id);
  await logActivity(req.user.id, 'customer_deleted', `ลบลูกค้า ${c.name}`, 'ลบแล้ว');
  return { ok: true };
}));

// ---------- projects ----------

const PROJECT_STATUS = {
  draft: 'ร่าง',
  quote_created: 'สร้างใบเสนอราคาแล้ว',
  pending: 'รอการอนุมัติ',
  approved: 'อนุมัติแล้ว',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
};
const TYPE_PREFIX = { 'งานแต่งงาน': 'WD', 'งานหมั้น': 'EN', 'งานวันเกิด': 'BD', 'งานบวช': 'OR', 'งานเปิดร้าน': 'OP' };

async function nextCode(table, userId, prefix) {
  // always called inside a transaction: one shop's codes are handed out one at a time, so two
  // requests arriving together can't be given the same number
  await db.prepare('SELECT pg_advisory_xact_lock(?::bigint)').get(userId);
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = await db.prepare(`SELECT code FROM ${table} WHERE user_id = ? AND code LIKE ? ORDER BY id DESC LIMIT 1`).get(userId, like);
  const n = row ? Number(row.code.split('-').pop()) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(3, '0')}`;
}

async function serializeProject(p) {
  const items = await db.prepare('SELECT * FROM cost_items WHERE project_id = ? ORDER BY sort, id').all(p.id);
  return {
    id: String(p.id),
    code: p.code,
    title: p.title,
    projectType: p.project_type,
    customerId: p.customer_id ? String(p.customer_id) : null,
    client: p.client,
    phone: p.phone,
    email: p.email,
    eventDate: p.event_date || '',
    budget: p.budget,
    notes: p.notes,
    status: p.status,
    statusText: PROJECT_STATUS[p.status] || p.status,
    profitMargin: p.profit_margin,
    depositPct: p.deposit_pct,
    setupDays: p.setup_days,
    eventDays: p.event_days,
    laborDays: p.labor_days,
    teamSize: p.team_size,
    ownerLabor: p.owner_labor === null ? null : !!p.owner_labor,
    teardown: p.teardown === null ? null : !!p.teardown,
    reviewApplied: !!p.review_applied,
    reviewedAt: p.reviewed_at,
    createdDate: thaiDate(p.created_at),
    updatedAt: p.updated_at,
    costItems: items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      quantity: i.quantity,
      price: i.price,
      total: i.quantity * i.price,
      paidBefore: !!i.paid_before,
      actual: i.actual,
      isExtra: !!i.is_extra,
    })),
  };
}

async function getProject(userId, id) {
  const p = await db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(rowId(id), userId);
  if (!p) throw new HttpError(404, 'ไม่พบโปรเจ็กต์');
  return p;
}

function readProjectBody(body) {
  const title = str(body.title, 200);
  if (!title) throw new HttpError(400, 'กรุณากรอกชื่อโปรเจ็กต์');
  const status = body.status && PROJECT_STATUS[body.status] ? body.status : undefined;
  return {
    title,
    project_type: str(body.projectType, 50) || 'อื่นๆ',
    client: str(body.client, 200),
    phone: str(body.phone, 50),
    email: str(body.email, 200),
    event_date: date(body.eventDate),
    budget: num(body.budget, { min: 0 }),
    notes: str(body.notes, 5000),
    profit_margin: num(body.profitMargin ?? 30, { min: 0, max: 1000 }),
    deposit_pct: num(body.depositPct ?? 30, { min: 0, max: 100 }),
    setup_days: num(body.setupDays ?? 1, { min: 0, max: 60 }),
    event_days: num(body.eventDays ?? 1, { min: 0, max: 60 }),
    labor_days: optNum(body.laborDays, 0, 365),
    team_size: optNum(body.teamSize, 0, 500),
    owner_labor: optBool(body.ownerLabor),
    teardown: optBool(body.teardown),
    review_applied: body.reviewApplied ? 1 : 0,
    status,
    items: Array.isArray(body.costItems)
      ? body.costItems.slice(0, 500).map((i) => ({
          name: str(i.name, 200),
          category: COST_CATEGORIES.includes(i.category) ? i.category : 'material',
          quantity: num(i.quantity, { min: 0 }),
          price: num(i.price, { min: 0 }),
          paid_before: i.paidBefore === false ? 0 : 1,
          actual: i.actual === null || i.actual === undefined || i.actual === '' ? null : num(i.actual, { min: 0 }),
          is_extra: i.isExtra ? 1 : 0,
        }))
      : null,
  };
}

const COST_CATEGORIES = ['material', 'rental', 'labor', 'transport', 'other'];
function optNum(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  return num(v, { min, max });
}
function optBool(v) {
  return v === null || v === undefined ? null : v ? 1 : 0;
}

async function replaceCostItems(projectId, items) {
  await db.prepare('DELETE FROM cost_items WHERE project_id = ?').run(projectId);
  const ins = db.prepare(
    'INSERT INTO cost_items (project_id, name, category, quantity, price, paid_before, actual, is_extra, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [idx, i] of items.entries()) await ins.run(projectId, i.name, i.category, i.quantity, i.price, i.paid_before, i.actual, i.is_extra, idx);
}

app.get('/api/projects', route(async (req) =>
  Promise.all((await db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(req.user.id)).map(serializeProject)),
));

app.get('/api/projects/:id', route(async (req) => serializeProject(await getProject(req.user.id, req.params.id))));

app.post('/api/projects', route(async (req, res) => {
  const d = readProjectBody(req.body);
  const project = await transaction(async () => {
    const code = await nextCode('projects', req.user.id, TYPE_PREFIX[d.project_type] || 'EV');
    const customerId = await resolveCustomer(req.user.id, customerChoice(req.body), d.client, d.phone, d.email);
    const { lastInsertRowid } = await db
      .prepare(`INSERT INTO projects (user_id, code, customer_id, title, project_type, client, phone, email, event_date, budget, notes, status, profit_margin,
                  deposit_pct, setup_days, event_days, labor_days, team_size, owner_labor, teardown)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .run(req.user.id, code, customerId, d.title, d.project_type, d.client, d.phone, d.email, d.event_date, d.budget, d.notes, d.status || 'draft', d.profit_margin,
        d.deposit_pct, d.setup_days, d.event_days, d.labor_days, d.team_size, d.owner_labor, d.teardown);
    await replaceCostItems(Number(lastInsertRowid), d.items || []);
    await logActivity(req.user.id, 'project_created', `โปรเจ็กต์ใหม่ - ${d.title}`, 'เพิ่มแล้ว');
    return await getProject(req.user.id, lastInsertRowid);
  });
  res.status(201);
  return serializeProject(project);
}));

app.put('/api/projects/:id', route(async (req) => {
  const existing = await getProject(req.user.id, req.params.id);
  const d = readProjectBody({ ...(await serializeProject(existing)), ...req.body });
  await transaction(async () => {
    const customerId = await resolveCustomer(req.user.id, customerChoice(req.body, existing, 'client', existing.client), d.client, d.phone, d.email);
    await db.prepare(`UPDATE projects SET customer_id=?, title=?, project_type=?, client=?, phone=?, email=?, event_date=?, budget=?, notes=?, status=?, profit_margin=?,
                  deposit_pct=?, setup_days=?, event_days=?, labor_days=?, team_size=?, owner_labor=?, teardown=?, review_applied=?,
                  reviewed_at=CASE WHEN ? = 1 AND review_applied = 0 THEN ${NOW} ELSE reviewed_at END, updated_at=${NOW}
                WHERE id = ? AND user_id = ?`)
      .run(customerId, d.title, d.project_type, d.client, d.phone, d.email, d.event_date, d.budget, d.notes, d.status || existing.status, d.profit_margin,
        d.deposit_pct, d.setup_days, d.event_days, d.labor_days, d.team_size, d.owner_labor, d.teardown, d.review_applied,
        d.review_applied, existing.id, req.user.id);
    if (d.items) await replaceCostItems(existing.id, d.items);
    if (d.status && d.status !== existing.status) {
      await logActivity(req.user.id, `project_${d.status}`, `โปรเจ็กต์ ${d.title}`, PROJECT_STATUS[d.status]);
    }
  });
  return serializeProject(await getProject(req.user.id, existing.id));
}));

app.delete('/api/projects/:id', route(async (req) => {
  const p = await getProject(req.user.id, req.params.id);
  // the database removes its cost items and unlinks its quotes (ON DELETE CASCADE / SET NULL)
  await db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  await logActivity(req.user.id, 'project_deleted', `ลบโปรเจ็กต์ ${p.title}`, 'ลบแล้ว');
  return { ok: true };
}));

// ---------- quotes ----------

const QUOTE_STATUS = { draft: 'ร่าง', sent: 'ส่งแล้ว', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ', expired: 'หมดอายุ' };
// keep the linked project's status in step with its quote
const QUOTE_TO_PROJECT_STATUS = { draft: 'quote_created', sent: 'pending', approved: 'approved' };

async function serializeQuote(q) {
  const items = await db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort, id').all(q.id);
  const lines = items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unit_price }));
  const totals = quoteTotals({ items: lines, discountRate: q.discount_rate, taxRate: q.tax_rate, vatMode: q.vat_mode });
  const today = new Date().toISOString().slice(0, 10);
  const status = ['draft', 'sent'].includes(q.status) && q.valid_until && q.valid_until < today ? 'expired' : q.status;
  return {
    id: String(q.id),
    code: q.code,
    projectId: q.project_id ? String(q.project_id) : null,
    customerId: q.customer_id ? String(q.customer_id) : null,
    clientName: q.client_name,
    clientPhone: q.client_phone,
    clientEmail: q.client_email,
    projectTitle: q.project_title,
    eventDate: q.event_date || '',
    validUntil: q.valid_until || '',
    validUntilText: thaiDate(q.valid_until),
    notes: q.notes,
    taxRate: q.tax_rate,
    discountRate: q.discount_rate,
    vatMode: q.vat_mode,
    /** the job's price when the quote was made; the lines must come to this after the discount */
    lockedPrice: q.locked_price,
    status,
    statusText: QUOTE_STATUS[status] || status,
    createdDate: thaiDate(q.created_at),
    createdAt: q.created_at,
    itemCount: items.length,
    totalAmount: totals.total,
    items: lines.map((i) => ({ ...i, total: lineAmount(i) })),
  };
}

async function getQuote(userId, id) {
  const q = await db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(rowId(id), userId);
  if (!q) throw new HttpError(404, 'ไม่พบใบเสนอราคา');
  return q;
}

async function readQuoteBody(userId, body) {
  const projectId = body.projectId ? rowId(body.projectId) : null;
  if (body.projectId) await getProject(userId, projectId);
  return {
    project_id: projectId,
    client_name: str(body.clientName, 200),
    client_phone: str(body.clientPhone, 50),
    client_email: str(body.clientEmail, 200),
    project_title: str(body.projectTitle, 200),
    event_date: date(body.eventDate),
    valid_until: date(body.validUntil),
    notes: str(body.notes, 5000),
    tax_rate: num(body.taxRate ?? 7, { min: 0, max: 100 }),
    discount_rate: num(body.discountRate ?? 0, { min: 0, max: 100 }),
    vat_mode: VAT_MODES.includes(body.vatMode) ? body.vatMode : undefined,
    status: body.status && QUOTE_STATUS[body.status] && body.status !== 'expired' ? body.status : undefined,
    items: Array.isArray(body.items)
      ? body.items.slice(0, 500).map((i) => ({ description: str(i.description, 500), quantity: num(i.quantity, { min: 0 }), unit_price: num(i.unitPrice, { min: 0 }) }))
      : null,
  };
}

/** a quote made from a job must come to the job's price, so the profit worked out for the job holds */
function checkLockedPrice(lockedPrice, d, items) {
  if (lockedPrice === null || lockedPrice === undefined) return;
  const { afterDiscount } = quoteTotals({ items: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price })), discountRate: d.discount_rate });
  if (afterDiscount !== lockedPrice) {
    const baht = (n) => `฿${n.toLocaleString('th-TH')}`;
    throw new HttpError(400, `ยอดรวมรายการ ${baht(afterDiscount)} ไม่เท่ากับราคาโปรเจ็กต์ที่ล็อกไว้ ${baht(lockedPrice)} กด "ปรับส่วนต่างอัตโนมัติ" หรือแก้รายการให้ยอดตรงกัน`);
  }
}

async function lockedPriceOf(projectId) {
  if (!projectId) return null;
  const p = await db.prepare('SELECT profit_margin FROM projects WHERE id = ?').get(projectId);
  const items = await db.prepare('SELECT quantity, price, is_extra FROM cost_items WHERE project_id = ?').all(projectId);
  const price = projectPrice(items.map((i) => ({ quantity: i.quantity, price: i.price, isExtra: !!i.is_extra })), p.profit_margin);
  // a job with no costs yet has no price to hold the quote to
  return price > 0 ? price : null;
}

async function replaceQuoteItems(quoteId, items) {
  await db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quoteId);
  const ins = db.prepare('INSERT INTO quote_items (quote_id, description, quantity, unit_price, sort) VALUES (?, ?, ?, ?, ?)');
  for (const [idx, i] of items.entries()) await ins.run(quoteId, i.description, i.quantity, i.unit_price, idx);
}

async function syncProjectStatus(userId, projectId, quoteStatus) {
  const target = QUOTE_TO_PROJECT_STATUS[quoteStatus];
  if (!projectId || !target) return;
  await db.prepare(`UPDATE projects SET status = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ? AND status NOT IN ('completed', 'cancelled')`)
    .run(target, projectId, userId);
}

app.get('/api/quotes', route(async (req) =>
  Promise.all((await db.prepare('SELECT * FROM quotes WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(req.user.id)).map(serializeQuote)),
));

app.get('/api/quotes/:id', route(async (req) => serializeQuote(await getQuote(req.user.id, req.params.id))));

app.post('/api/quotes', route(async (req, res) => {
  const d = await readQuoteBody(req.user.id, req.body);
  if (!d.client_name) throw new HttpError(400, 'กรุณากรอกชื่อลูกค้า');
  const quote = await transaction(async () => {
    const code = await nextCode('quotes', req.user.id, 'QT');
    const status = d.status || 'draft';
    const customerId = await resolveCustomer(req.user.id, customerChoice(req.body), d.client_name, d.client_phone, d.client_email);
    const lockedPrice = await lockedPriceOf(d.project_id);
    checkLockedPrice(lockedPrice, d, d.items || []);
    const { lastInsertRowid } = await db
      .prepare(`INSERT INTO quotes (user_id, code, customer_id, project_id, client_name, client_phone, client_email, project_title, event_date, valid_until, notes, tax_rate, discount_rate, vat_mode, locked_price, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .run(req.user.id, code, customerId, d.project_id, d.client_name, d.client_phone, d.client_email, d.project_title, d.event_date, d.valid_until, d.notes, d.tax_rate, d.discount_rate,
        d.vat_mode || req.user.vat_mode, lockedPrice, status);
    await replaceQuoteItems(Number(lastInsertRowid), d.items || []);
    await syncProjectStatus(req.user.id, d.project_id, status);
    await logActivity(req.user.id, 'quote_created', `ใบเสนอราคาใหม่ ${code}`, status === 'sent' ? 'ส่งแล้ว' : 'สร้างแล้ว');
    return await getQuote(req.user.id, lastInsertRowid);
  });
  res.status(201);
  return serializeQuote(quote);
}));

app.put('/api/quotes/:id', route(async (req) => {
  const existing = await getQuote(req.user.id, req.params.id);
  const merged = { ...(await serializeQuote(existing)), ...req.body };
  if (!('status' in req.body)) merged.status = existing.status;
  const d = await readQuoteBody(req.user.id, merged);
  if (!d.client_name) throw new HttpError(400, 'กรุณากรอกชื่อลูกค้า');
  const status = d.status || existing.status;
  await transaction(async () => {
    const customerId = await resolveCustomer(req.user.id, customerChoice(req.body, existing, 'clientName', existing.client_name), d.client_name, d.client_phone, d.client_email);
    // only a change to the lines or the discount can break the lock; old quotes can still change status
    if ('items' in req.body || 'discountRate' in req.body) checkLockedPrice(existing.locked_price, d, d.items || []);
    await db.prepare(`UPDATE quotes SET customer_id=?, project_id=?, client_name=?, client_phone=?, client_email=?, project_title=?, event_date=?, valid_until=?, notes=?, tax_rate=?, discount_rate=?, vat_mode=?, status=?, updated_at=${NOW}
                WHERE id = ? AND user_id = ?`)
      .run(customerId, d.project_id, d.client_name, d.client_phone, d.client_email, d.project_title, d.event_date, d.valid_until, d.notes, d.tax_rate, d.discount_rate, d.vat_mode || existing.vat_mode, status, existing.id, req.user.id);
    if (d.items) await replaceQuoteItems(existing.id, d.items);
    if (status !== existing.status) {
      await syncProjectStatus(req.user.id, d.project_id, status);
      await logActivity(req.user.id, `quote_${status}`, `ใบเสนอราคา ${existing.code}`, QUOTE_STATUS[status]);
    }
  });
  return serializeQuote(await getQuote(req.user.id, existing.id));
}));

app.delete('/api/quotes/:id', route(async (req) => {
  const q = await getQuote(req.user.id, req.params.id);
  await db.prepare('DELETE FROM quotes WHERE id = ?').run(q.id);
  await logActivity(req.user.id, 'quote_deleted', `ลบใบเสนอราคา ${q.code}`, 'ลบแล้ว');
  return { ok: true };
}));

// ---------- dashboard / reports ----------

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Per-project cost, sale price and profit. A project counts as a sale once approved or completed. */
async function projectFinancials(userId) {
  return (await db
    .prepare(`SELECT p.*, COALESCE(SUM(c.quantity * c.price), 0) AS cost
              FROM projects p LEFT JOIN cost_items c ON c.project_id = p.id
              WHERE p.user_id = ? GROUP BY p.id`)
    .all(userId))
    .map((p) => {
      const profit = p.cost * (p.profit_margin / 100);
      return { ...p, profit, sales: p.cost + profit, month: (p.event_date || p.created_at).slice(0, 7), sold: ['approved', 'completed'].includes(p.status) };
    });
}

function monthSeries(rows, months) {
  const now = new Date();
  const series = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const inMonth = rows.filter((r) => r.sold && r.month === key);
    series.push({
      key,
      month: TH_MONTHS[d.getMonth()],
      sales: Math.round(inMonth.reduce((s, r) => s + r.sales, 0)),
      profit: Math.round(inMonth.reduce((s, r) => s + r.profit, 0)),
    });
  }
  return series;
}

const pctChange = (cur, prev) => (prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100);

app.get('/api/dashboard', route(async (req) => {
  const range = req.query.range === '12' ? 12 : req.query.range === 'year' ? new Date().getMonth() + 1 : 6;
  const rows = await projectFinancials(req.user.id);
  const series = monthSeries(rows, Math.max(range, 2));
  const [prev, cur] = series.slice(-2);
  const thisMonth = monthKey(new Date());

  const decided = rows.filter((r) => ['approved', 'completed', 'cancelled'].includes(r.status));
  const won = decided.filter((r) => r.status !== 'cancelled');

  return {
    stats: {
      salesThisMonth: cur.sales,
      salesChange: pctChange(cur.sales, prev.sales),
      profitThisMonth: cur.profit,
      profitChange: pctChange(cur.profit, prev.profit),
      activeProjects: rows.filter((r) => !['completed', 'cancelled'].includes(r.status)).length,
      newProjectsThisMonth: rows.filter((r) => r.created_at.slice(0, 7) === thisMonth).length,
      successRate: decided.length ? (won.length / decided.length) * 100 : 0,
      decidedProjects: decided.length,
    },
    chart: series.slice(-range),
    activities: await db.prepare('SELECT * FROM activities WHERE user_id = ? ORDER BY id DESC LIMIT 4').all(req.user.id),
    recentProjects: await Promise.all((await db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 3').all(req.user.id)).map(serializeProject)),
  };
}));

app.get('/api/activities', route(async (req) =>
  db.prepare('SELECT * FROM activities WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(req.user.id, Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 50, 1), 200)),
));

app.get('/api/reports', route(async (req) => {
  const rows = await projectFinancials(req.user.id);
  const byType = {};
  for (const r of rows) {
    const t = (byType[r.project_type] ||= { type: r.project_type, projects: 0, sold: 0, sales: 0, profit: 0 });
    t.projects++;
    if (r.sold) {
      t.sold++;
      t.sales += r.sales;
      t.profit += r.profit;
    }
  }
  const byStatus = Object.keys(PROJECT_STATUS).map((s) => ({ status: s, statusText: PROJECT_STATUS[s], count: rows.filter((r) => r.status === s).length }));
  const sold = rows.filter((r) => r.sold);
  return {
    totals: {
      projects: rows.length,
      sales: sold.reduce((s, r) => s + r.sales, 0),
      profit: sold.reduce((s, r) => s + r.profit, 0),
      cost: sold.reduce((s, r) => s + r.cost, 0),
    },
    chart: monthSeries(rows, 12),
    byType: Object.values(byType).sort((a, b) => b.sales - a.sales),
    byStatus,
  };
}));


// ---------- ProfitBloom admin ----------

const PLANS = ['trial', 'starter', 'pro'];
const PLAN_NAMES = { trial: 'Free Trial', starter: 'Starter', pro: 'Pro' };

app.use('/api/admin', (req, _res, next) => (req.user.role === 'admin' ? next() : next(new HttpError(403, 'เฉพาะผู้ดูแลระบบ ProfitBloom'))));

const shopRow = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  businessName: u.business_name,
  businessPhone: u.business_phone,
  hasLogo: !!u.business_logo,
  plan: u.plan,
  trialEndsAt: u.trial_ends_at,
  role: u.role,
  disabled: !!u.disabled,
  createdAt: u.created_at,
  projects: u.projects,
  quotes: u.quotes,
  lastActiveAt: u.last_active_at,
});

const SHOPS_SQL = `
  SELECT u.*,
    (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
    (SELECT COUNT(*) FROM quotes q WHERE q.user_id = u.id) AS quotes,
    (SELECT MAX(a.created_at) FROM activities a WHERE a.user_id = u.id) AS last_active_at
  FROM users u`;

app.get('/api/admin/shops', route(async () => (await db.prepare(`${SHOPS_SQL} ORDER BY u.created_at DESC, u.id DESC`).all()).map(shopRow)));

app.put('/api/admin/shops/:id', route(async (req) => {
  const shop = await db.prepare('SELECT * FROM users WHERE id = ?').get(rowId(req.params.id));
  if (!shop) throw new HttpError(404, 'ไม่พบร้านนี้');
  const { plan, disabled } = req.body;
  await transaction(async () => {
    if (plan !== undefined) {
      if (!PLANS.includes(plan)) throw new HttpError(400, 'แพ็กเกจไม่ถูกต้อง');
      if (plan !== shop.plan) {
        await db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, shop.id);
        // moving (back) to the trial starts a fresh trial period if the old one is gone
        if (plan === 'trial' && !(shop.trial_ends_at && shop.trial_ends_at > new Date().toISOString())) {
          await db.prepare('UPDATE users SET trial_ends_at = ? WHERE id = ?').run(new Date(Date.now() + TRIAL_DAYS * 864e5).toISOString(), shop.id);
        }
        await logActivity(shop.id, 'plan_changed', `แพ็กเกจเปลี่ยนเป็น ${PLAN_NAMES[plan]}`, 'โดย ProfitBloom');
      }
    }
    if (disabled !== undefined) {
      if (shop.id === req.user.id) throw new HttpError(400, 'ระงับบัญชีของตัวเองไม่ได้');
      await db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, shop.id);
      // a suspended shop is signed out everywhere straight away
      if (disabled) await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(shop.id);
    }
  });
  return shopRow(await db.prepare(`${SHOPS_SQL} WHERE u.id = ?`).get(shop.id));
}));

// ---------- errors ----------

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'ไม่พบ API นี้')));

app.use((err, _req, res, _next) => {
  // bad JSON comes from Express locally (entity.parse.failed) or from Vercel's body parser (SyntaxError)
  const badJson = err.type === 'entity.parse.failed' || err instanceof SyntaxError;
  const status = badJson ? 400 : err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: badJson ? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' : status >= 500 ? 'เกิดข้อผิดพลาดในระบบ' : err.message });
});
