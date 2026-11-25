import express from 'express';
import crypto from 'node:crypto';
import { db, NOW, ready, transaction } from './db.js';
import { passwordResetMail, sendMail } from './mail.js';
import { emailError, phoneError } from '../shared/contact.js';
import { DISCOUNT_TYPES, jobPricing, lineAmount, projectPrice, quoteLinesFromJob, quoteTotals, ROUNDINGS, toSatang, VAT_MODES, wholeBaht } from '../shared/quote-math.js';

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
/** A phone number from a form. A number that was already stored is left alone, so old records can still be saved. */
const phone = (v, stored = '') => {
  const value = str(v, 50);
  const error = value === stored ? '' : phoneError(value);
  if (error) throw new HttpError(400, error);
  return value;
};
/** A customer's email address from a form; like phone(), an address that was already stored is left alone. */
const contactEmail = (v, stored = '') => {
  const value = str(v, 200);
  const error = value === stored ? '' : emailError(value);
  if (error) throw new HttpError(400, error);
  return value;
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

const publicUser = async (u) => ({
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
  // cost categories this shop added to the built-in ones
  costCategories: await customCategories(u.id),
});

/** The built-in cost categories. owner_labor and teardown also answer two of the job conditions. */
const COST_CATEGORIES = ['material', 'rental', 'labor', 'owner_labor', 'transport', 'teardown', 'other'];
const BUILT_IN_CATEGORY_NAMES = ['ดอกไม้/วัสดุ', 'เช่าอุปกรณ์/พร็อพ', 'ค่าแรง', 'ค่าแรงเจ้าของ', 'ขนส่ง/รถ', 'เก็บงาน/ขนส่งกลับ', 'อื่น ๆ'];
const MAX_CUSTOM_CATEGORIES = 30;
/** how a cost item refers to a category the shop added */
const categoryKey = (id) => `c${id}`;
const customCategories = async (userId) =>
  (await db.prepare('SELECT id, name FROM cost_categories WHERE user_id = ? ORDER BY id').all(userId)).map((c) => ({ id: categoryKey(c.id), name: c.name }));
/** every category a shop's cost items may use */
const allowedCategories = async (userId) => [...COST_CATEGORIES, ...(await customCategories(userId)).map((c) => c.id)];

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
  return { user: await publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid)) };
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
  return { user: await publicUser(user) };
}));

app.post('/api/auth/logout', route(async (req, res) => {
  if (req.sessionToken) await db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
}));

app.get('/api/auth/me', route(async (req) => ({ user: req.user ? await publicUser(req.user) : null })));

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
  return { user: await publicUser(user) };
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
    phone(req.body.businessPhone, req.user.business_phone),
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
  return { user: await publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) };
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

function readCustomerBody(body, existing) {
  const name = str(body.name, 200);
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อลูกค้า');
  return {
    name,
    phone: phone(body.phone, existing?.phone),
    email: contactEmail(body.email, existing?.email),
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

/**
 * Carries the phone number and email typed on a project or quote over to the customer's own record.
 * An empty field on the customer is always filled in; a different value replaces what the customer
 * has only when the shop said so (`overwrite`), because a job is sometimes arranged with someone else.
 */
async function syncCustomerContact(customerId, phone, email, overwrite) {
  if (!customerId) return;
  const c = await db.prepare('SELECT phone, email FROM customers WHERE id = ?').get(customerId);
  const pick = (typed, kept) => (typed && (overwrite || !kept) ? typed : kept);
  const next = { phone: pick(phone, c.phone), email: pick(email, c.email) };
  if (next.phone === c.phone && next.email === c.email) return;
  await db.prepare(`UPDATE customers SET phone = ?, email = ?, updated_at = ${NOW} WHERE id = ?`).run(next.phone, next.email, customerId);
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
  // the address, tax id and branch written on each customer's latest quote that had any: a new quote starts from them
  const written = await db
    .prepare(`SELECT DISTINCT ON (customer_id) customer_id, client_address, client_tax_id, client_branch FROM quotes
              WHERE user_id = ? AND customer_id IS NOT NULL AND (client_address <> '' OR client_tax_id <> '' OR client_branch <> '')
              ORDER BY customer_id, id DESC`)
    .all(userId);
  const lastWritten = new Map(written.map((q) => [q.customer_id, q]));
  return customers.map((c) => {
    const mine = projects.filter((p) => p.customer_id === c.id);
    const sold = mine.filter((p) => p.sold);
    const last = lastWritten.get(c.id);
    return {
      ...serializeCustomer(c),
      quoteAddress: last?.client_address ?? '',
      quoteTaxId: last?.client_tax_id ?? '',
      quoteBranch: last?.client_branch ?? '',
      projectCount: mine.length,
      quoteCount: quoteCount.get(c.id) ?? 0,
      soldCount: sold.length,
      totalSales: sold.reduce((s, p) => s + p.sales, 0),
      lastEventDate: mine.map((p) => p.event_date || '').sort().pop() || '',
    };
  });
}

// ---------- cost categories the shop adds ----------

async function readCategoryName(userId, body, selfId = null) {
  const name = str(body.name, 50);
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อหมวด');
  const taken = [...BUILT_IN_CATEGORY_NAMES, ...(await db.prepare('SELECT id, name FROM cost_categories WHERE user_id = ?').all(userId)).filter((c) => c.id !== selfId).map((c) => c.name)];
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) throw new HttpError(400, `มีหมวด "${name}" อยู่แล้ว`);
  return name;
}
async function getCategory(userId, key) {
  const id = /^c\d+$/.test(String(key)) ? Number(String(key).slice(1)) : 0;
  const c = id && (await db.prepare('SELECT * FROM cost_categories WHERE id = ? AND user_id = ?').get(id, userId));
  if (!c) throw new HttpError(404, 'ไม่พบหมวดนี้');
  return c;
}

app.get('/api/cost-categories', route(async (req) => customCategories(req.user.id)));

app.post('/api/cost-categories', route(async (req, res) => {
  const name = await readCategoryName(req.user.id, req.body);
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM cost_categories WHERE user_id = ?').get(req.user.id);
  if (n >= MAX_CUSTOM_CATEGORIES) throw new HttpError(400, `เพิ่มหมวดได้ไม่เกิน ${MAX_CUSTOM_CATEGORIES} หมวด`);
  const { lastInsertRowid } = await db.prepare('INSERT INTO cost_categories (user_id, name) VALUES (?, ?) RETURNING id').run(req.user.id, name);
  res.status(201);
  return { id: categoryKey(lastInsertRowid), name };
}));

app.put('/api/cost-categories/:id', route(async (req) => {
  const existing = await getCategory(req.user.id, req.params.id);
  const name = await readCategoryName(req.user.id, req.body, existing.id);
  await db.prepare('UPDATE cost_categories SET name = ? WHERE id = ?').run(name, existing.id);
  return { id: categoryKey(existing.id), name };
}));

// costs filed under a removed category move to "อื่น ๆ", so no job loses a cost line
app.delete('/api/cost-categories/:id', route(async (req) => {
  const existing = await getCategory(req.user.id, req.params.id);
  let moved = 0;
  await transaction(async () => {
    ({ changes: moved } = await db
      .prepare("UPDATE cost_items SET category = 'other' WHERE category = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)")
      .run(categoryKey(existing.id), req.user.id));
    await db.prepare('DELETE FROM cost_categories WHERE id = ?').run(existing.id);
  });
  return { ok: true, moved };
}));

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
  const d = readCustomerBody({ ...serializeCustomer(existing), ...req.body }, existing);
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

const BANGKOK_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' });
/** the year as it is in Thailand: the server's clock is UTC, seven hours behind on the night of 31 December */
const bangkokYear = (at = new Date()) => Number(BANGKOK_YEAR.format(at));

/**
 * The next number for a shop's document, like QT-2026-013: one run per shop, per kind (prefix) and per year, starting
 * at 001. A number is never given twice, even after its document is deleted: the last one handed out is kept in
 * doc_counters, and the numbers in use count too (for documents from before that table, or brought in from the old system).
 */
async function nextCode(table, userId, prefix) {
  // always called inside a transaction: one shop's codes are handed out one at a time, so two
  // requests arriving together can't be given the same number
  await db.prepare('SELECT pg_advisory_xact_lock(?::bigint)').get(userId);
  const year = bangkokYear();
  const inUse = await db.prepare(`SELECT MAX(CAST(split_part(code, '-', 3) AS INTEGER)) AS n FROM ${table} WHERE user_id = ? AND code ~ ?`).get(userId, `^${prefix}-${year}-[0-9]+$`);
  const given = await db.prepare('SELECT last_n FROM doc_counters WHERE user_id = ? AND prefix = ? AND year = ?').get(userId, prefix, year);
  const n = Math.max(inUse?.n ?? 0, given?.last_n ?? 0) + 1;
  await db.prepare('INSERT INTO doc_counters (user_id, prefix, year, last_n) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, prefix, year) DO UPDATE SET last_n = EXCLUDED.last_n')
    .run(userId, prefix, year, n);
  return `${prefix}-${year}-${String(n).padStart(3, '0')}`;
}

async function serializeProject(p) {
  const items = await db.prepare('SELECT * FROM cost_items WHERE project_id = ? ORDER BY sort, id').all(p.id);
  const groups = await db.prepare('SELECT * FROM cost_groups WHERE project_id = ? ORDER BY sort, id').all(p.id);
  const quote = await followingQuote(p.id);
  return {
    /** the quote tied to this job: its lines and price are the job's and change when the job is saved (null until one is made) */
    quote: quote ? { id: String(quote.id), code: quote.code, status: quote.status, statusText: QUOTE_STATUS[quote.status] || quote.status } : null,
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
    // set when the job was made from an accepted quote: the price is fixed and the margin follows from the costs
    agreedPrice: p.agreed_price,
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
    costGroups: groups.map((g) => ({ id: g.id, name: g.name, markup: g.markup, discountType: g.discount_type, discount: g.discount })),
    costItems: items.map((i) => ({
      id: i.id,
      groupId: i.group_id,
      name: i.name,
      category: i.category,
      quantity: i.quantity,
      unit: i.unit,
      price: i.price,
      total: i.quantity * i.price,
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

function readProjectBody(body, existing, categories = COST_CATEGORIES) {
  const title = str(body.title, 200);
  if (!title) throw new HttpError(400, 'กรุณากรอกชื่อโปรเจ็กต์');
  const status = body.status && PROJECT_STATUS[body.status] ? body.status : undefined;
  return {
    title,
    project_type: str(body.projectType, 50) || 'อื่นๆ',
    client: str(body.client, 200),
    phone: phone(body.phone, existing?.phone),
    email: contactEmail(body.email, existing?.email),
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
    groups: Array.isArray(body.costGroups)
      ? body.costGroups.slice(0, 100).map((g) => {
          const discountType = DISCOUNT_TYPES.includes(g?.discountType) ? g.discountType : 'percent';
          // a share cannot be more than all of the price; an amount is capped at the heading's price when it is worked out
          return { id: g?.id, name: str(g?.name, 200), markup: num(g?.markup, { min: -100, max: 1000 }), discountType, discount: num(g?.discount, { min: 0, max: discountType === 'percent' ? 100 : 1e12 }) };
        })
      : null,
    items: Array.isArray(body.costItems)
      ? body.costItems.slice(0, 500).map((i) => ({
          group: i.groupId,
          name: str(i.name, 200),
          // '' = no category chosen yet (the form asks for one before a filled-in row is saved)
          category: categories.includes(i.category) ? i.category : i.category === '' ? '' : 'material',
          quantity: num(i.quantity, { min: 0 }),
          unit: str(i.unit, 30),
          price: num(i.price, { min: 0 }),
          actual: i.actual === null || i.actual === undefined || i.actual === '' ? null : num(i.actual, { min: 0 }),
          is_extra: i.isExtra ? 1 : 0,
        }))
      : null,
  };
}

function optNum(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  return num(v, { min, max });
}
function optBool(v) {
  return v === null || v === undefined ? null : v ? 1 : 0;
}

/**
 * Saves a job's headings and the cost items under them, replacing what was there. Planned items that
 * name no heading go under the first one (a job always gets one once it has costs); unplanned extras
 * have none. `oneMarkup` sets every heading to the job's markup — for callers that still send a single
 * markup for the whole job. Keeps projects.profit_margin as the job's overall markup, so
 * cost × (1 + profit_margin) is its price everywhere.
 */
async function replaceCosts(projectId, d, oneMarkup = false) {
  const groups = (d.groups || []).map((g) => ({ ...g, markup: oneMarkup ? d.profit_margin : g.markup }));
  const items = d.items || [];
  const known = new Set(groups.map((g) => g.id).filter((id) => id !== null && id !== undefined));
  if (groups.length === 0 && items.some((i) => !i.is_extra)) groups.push({ id: undefined, name: 'รายการต้นทุน', markup: d.profit_margin });

  await db.prepare('DELETE FROM cost_items WHERE project_id = ?').run(projectId);
  await db.prepare('DELETE FROM cost_groups WHERE project_id = ?').run(projectId);
  const newId = new Map();
  const saved = [];
  for (const [idx, g] of groups.entries()) {
    const discountType = g.discountType ?? 'percent';
    const discount = g.discount ?? 0;
    const { lastInsertRowid } = await db.prepare('INSERT INTO cost_groups (project_id, name, markup, discount_type, discount, sort) VALUES (?, ?, ?, ?, ?, ?) RETURNING id').run(projectId, g.name, g.markup, discountType, discount, idx);
    const id = Number(lastInsertRowid);
    if (known.has(g.id)) newId.set(g.id, id);
    saved.push({ id, name: g.name, markup: g.markup, discountType, discount });
  }
  const ins = db.prepare('INSERT INTO cost_items (project_id, group_id, name, category, quantity, unit, price, actual, is_extra, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const priced = [];
  for (const [idx, i] of items.entries()) {
    const groupId = i.is_extra ? null : newId.get(i.group) ?? saved[0].id;
    await ins.run(projectId, groupId, i.name, i.category, i.quantity, i.unit ?? '', i.price, i.actual, i.is_extra, idx);
    priced.push({ quantity: i.quantity, price: i.price, isExtra: !!i.is_extra, groupId });
  }
  const { cost, price } = jobPricing(priced, saved);
  const { agreed_price: agreed } = await db.prepare('SELECT agreed_price FROM projects WHERE id = ?').get(projectId);
  if (agreed !== null && cost > 0) {
    // the price was settled with the client: every heading gets the one markup that makes the costs come to it
    // (negative when the costs are more than the price)
    const markup = (agreed / cost - 1) * 100;
    // a discount has no meaning under a settled price, so none is kept
    await db.prepare('UPDATE cost_groups SET markup = ?, discount = 0 WHERE project_id = ?').run(markup, projectId);
    await db.prepare('UPDATE projects SET profit_margin = ? WHERE id = ?').run(markup, projectId);
    return;
  }
  const overall = cost > 0 ? (price / cost - 1) * 100 : saved[0]?.markup ?? d.profit_margin;
  await db.prepare('UPDATE projects SET profit_margin = ? WHERE id = ?').run(overall, projectId);
}

app.get('/api/projects', route(async (req) =>
  Promise.all((await db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(req.user.id)).map(serializeProject)),
));

app.get('/api/projects/:id', route(async (req) => serializeProject(await getProject(req.user.id, req.params.id))));

app.post('/api/projects', route(async (req, res) => {
  const d = readProjectBody(req.body, undefined, await allowedCategories(req.user.id));
  const project = await transaction(async () => {
    const code = await nextCode('projects', req.user.id, TYPE_PREFIX[d.project_type] || 'EV');
    const customerId = await resolveCustomer(req.user.id, customerChoice(req.body), d.client, d.phone, d.email);
    await syncCustomerContact(customerId, d.phone, d.email, req.body.updateCustomer === true);
    const { lastInsertRowid } = await db
      .prepare(`INSERT INTO projects (user_id, code, customer_id, title, project_type, client, phone, email, event_date, budget, notes, status, profit_margin,
                  deposit_pct, setup_days, event_days, labor_days, team_size, owner_labor, teardown)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .run(req.user.id, code, customerId, d.title, d.project_type, d.client, d.phone, d.email, d.event_date, d.budget, d.notes, d.status || 'draft', d.profit_margin,
        d.deposit_pct, d.setup_days, d.event_days, d.labor_days, d.team_size, d.owner_labor, d.teardown);
    await replaceCosts(Number(lastInsertRowid), d);
    await logActivity(req.user.id, 'project_created', `โปรเจ็กต์ใหม่ - ${d.title}`, 'เพิ่มแล้ว');
    return await getProject(req.user.id, lastInsertRowid);
  });
  res.status(201);
  return serializeProject(project);
}));

app.put('/api/projects/:id', route(async (req) => {
  const existing = await getProject(req.user.id, req.params.id);
  /** whether this save changed the quote tied to the job */
  let quoteUpdated = false;
  const d = readProjectBody({ ...(await serializeProject(existing)), ...req.body }, existing, await allowedCategories(req.user.id));
  await transaction(async () => {
    // What the job gives its quote before this save. The quote follows the job, so it is this save changing that
    // which changes the quote: a save that leaves it alone (a status, a note, what the job really cost) leaves the
    // quote alone too, even a quote from before the two were tied that has not caught up with its job yet.
    const before = ['costItems', 'costGroups', 'profitMargin'].some((k) => k in req.body) ? await jobQuoteLines(existing.id) : null;
    const customerId = await resolveCustomer(req.user.id, customerChoice(req.body, existing, 'client', existing.client), d.client, d.phone, d.email);
    await syncCustomerContact(customerId, d.phone, d.email, req.body.updateCustomer === true);
    await db.prepare(`UPDATE projects SET customer_id=?, title=?, project_type=?, client=?, phone=?, email=?, event_date=?, budget=?, notes=?, status=?, profit_margin=?,
                  deposit_pct=?, setup_days=?, event_days=?, labor_days=?, team_size=?, owner_labor=?, teardown=?, review_applied=?,
                  reviewed_at=CASE WHEN ? = 1 AND review_applied = 0 THEN ${NOW} ELSE reviewed_at END, updated_at=${NOW}
                WHERE id = ? AND user_id = ?`)
      .run(customerId, d.title, d.project_type, d.client, d.phone, d.email, d.event_date, d.budget, d.notes, d.status || existing.status, d.profit_margin,
        d.deposit_pct, d.setup_days, d.event_days, d.labor_days, d.team_size, d.owner_labor, d.teardown, d.review_applied,
        d.review_applied, existing.id, req.user.id);
    // a caller that sends one markup for the job, and no headings, means it for every heading
    await replaceCosts(existing.id, d, req.body.profitMargin !== undefined && !Array.isArray(req.body.costGroups));
    if (before) {
      const after = await jobQuoteLines(existing.id);
      if (before.price !== after.price || !sameLines(before.lines, after.lines)) quoteUpdated = await syncFollowingQuote(existing.id, req.body.confirmQuoteChange === true);
    }
    if (d.status && d.status !== existing.status) {
      await logActivity(req.user.id, `project_${d.status}`, `โปรเจ็กต์ ${d.title}`, PROJECT_STATUS[d.status]);
    }
  });
  return { ...(await serializeProject(await getProject(req.user.id, existing.id))), quoteUpdated };
}));

app.delete('/api/projects/:id', route(async (req) => {
  const p = await getProject(req.user.id, req.params.id);
  // the database removes its cost items and unlinks its quotes (ON DELETE CASCADE / SET NULL);
  // a quote that followed the job is an ordinary quote from here on: it keeps the lines it last had, and is free to change them
  await db.prepare('UPDATE quotes SET follows_project = 0, locked_price = NULL WHERE project_id = ? AND follows_project = 1').run(p.id);
  await db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  await logActivity(req.user.id, 'project_deleted', `ลบโปรเจ็กต์ ${p.title}`, 'ลบแล้ว');
  return { ok: true };
}));

// ---------- quotes ----------

const QUOTE_STATUS = { draft: 'ร่าง', sent: 'ส่งแล้ว', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ', expired: 'หมดอายุ' };
// keep the linked project's status in step with its quote
const QUOTE_TO_PROJECT_STATUS = { draft: 'quote_created', sent: 'pending', approved: 'approved' };

async function serializeQuote(q, { withJob = false } = {}) {
  const items = await db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort, id').all(q.id);
  const followsProject = !!q.follows_project && !!q.project_id;
  // for the quote's own page: which job it follows, and whether it still holds what the job gives it
  // (a quote from before jobs and quotes were tied can be behind until the job is next saved)
  let job;
  if (withJob && followsProject) {
    const p = await db.prepare('SELECT id, code, title FROM projects WHERE id = ?').get(q.project_id);
    const fresh = await jobQuoteLines(q.project_id);
    job = { id: String(p.id), code: p.code, title: p.title, price: fresh.price, inStep: await inStepWithJob(q, fresh) };
  }
  const lines = items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unit_price, roundUp: !!i.round_up }));
  // payment falls due so many days after the event
  const dueDate = q.credit_days > 0 && q.event_date ? new Date(Date.parse(q.event_date + 'T00:00:00Z') + q.credit_days * 864e5).toISOString().slice(0, 10) : '';
  const rounding = ROUNDINGS.includes(q.rounding) ? q.rounding : 'baht';
  const totals = quoteTotals({ items: lines, discountRate: q.discount_rate, taxRate: q.tax_rate, vatMode: q.vat_mode, rounding, whtRate: q.wht_rate });
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
    clientAddress: q.client_address,
    clientTaxId: q.client_tax_id,
    clientBranch: q.client_branch,
    projectTitle: q.project_title,
    referenceNo: q.reference_no,
    eventDate: q.event_date || '',
    validUntil: q.valid_until || '',
    validUntilText: thaiDate(q.valid_until),
    /** days the customer has to pay after the event (0 = not stated), and the day that comes to */
    creditDays: q.credit_days,
    dueDate,
    dueDateText: thaiDate(dueDate),
    notes: q.notes,
    /** for the shop only: never printed on the quote */
    internalNote: q.internal_note,
    taxRate: q.tax_rate,
    discountRate: q.discount_rate,
    vatMode: q.vat_mode,
    /** 'line': each line chooses to round up to a whole baht, sums keep the satang; 'baht': an older quote, whole baht throughout */
    rounding,
    /** the job's price when the quote was made; the lines must come to this after the discount */
    lockedPrice: q.locked_price,
    /** the quote is tied to its job: its lines and price are the job's, are changed there, and follow it when it is saved */
    followsProject,
    ...(job ? { job } : {}),
    status,
    statusText: QUOTE_STATUS[status] || status,
    createdDate: thaiDate(q.created_at),
    createdAt: q.created_at,
    itemCount: items.length,
    totalAmount: totals.total,
    /** withholding tax: the % the customer holds back from the price without VAT, the amount, and what is left to transfer */
    whtRate: totals.whtRate,
    withholding: totals.withholding,
    payableAmount: totals.payable,
    items: lines.map((i) => ({ ...i, total: lineAmount(i, rounding) })),
  };
}

async function getQuote(userId, id) {
  const q = await db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(rowId(id), userId);
  if (!q) throw new HttpError(404, 'ไม่พบใบเสนอราคา');
  return q;
}

async function readQuoteBody(userId, body, existing) {
  const projectId = body.projectId ? rowId(body.projectId) : null;
  if (body.projectId) await getProject(userId, projectId);
  return {
    project_id: projectId,
    client_name: str(body.clientName, 200),
    client_phone: phone(body.clientPhone, existing?.client_phone),
    client_email: contactEmail(body.clientEmail, existing?.client_email),
    client_address: str(body.clientAddress, 500),
    client_tax_id: str(body.clientTaxId, 20),
    client_branch: str(body.clientBranch, 60),
    reference_no: str(body.referenceNo, 60),
    credit_days: Math.round(num(body.creditDays ?? 0, { min: 0, max: 365 })),
    internal_note: str(body.internalNote, 2000),
    project_title: str(body.projectTitle, 200),
    event_date: date(body.eventDate),
    valid_until: date(body.validUntil),
    notes: str(body.notes, 5000),
    tax_rate: num(body.taxRate ?? 7, { min: 0, max: 100 }),
    discount_rate: num(body.discountRate ?? 0, { min: 0, max: 100 }),
    wht_rate: num(body.whtRate ?? 0, { min: 0, max: 100 }),
    vat_mode: VAT_MODES.includes(body.vatMode) ? body.vatMode : undefined,
    rounding: ROUNDINGS.includes(body.rounding) ? body.rounding : undefined,
    status: body.status && QUOTE_STATUS[body.status] && body.status !== 'expired' ? body.status : undefined,
    items: Array.isArray(body.items)
      ? body.items.slice(0, 500).map((i) => ({ description: str(i.description, 500), quantity: num(i.quantity, { min: 0 }), unit: str(i.unit, 30), unit_price: num(i.unitPrice, { min: 0 }), round_up: i.roundUp === true ? 1 : 0 }))
      : null,
  };
}

/** a quote made from a job must come to the job's price, so the profit worked out for the job holds */
function checkLockedPrice(lockedPrice, d, items) {
  if (lockedPrice === null || lockedPrice === undefined) return;
  const { afterDiscount } = quoteTotals({ items: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, roundUp: !!i.round_up })), discountRate: d.discount_rate, rounding: d.rounding });
  if (afterDiscount !== toSatang(lockedPrice)) {
    const baht = (n) => `฿${n.toLocaleString('th-TH')}`;
    throw new HttpError(400, `ยอดรวมรายการ ${baht(afterDiscount)} ไม่เท่ากับราคาโปรเจ็กต์ที่ล็อกไว้ ${baht(lockedPrice)} กด "ปรับส่วนต่างอัตโนมัติ" หรือแก้รายการให้ยอดตรงกัน`);
  }
}

async function lockedPriceOf(projectId) {
  if (!projectId) return null;
  const p = await db.prepare('SELECT profit_margin, agreed_price FROM projects WHERE id = ?').get(projectId);
  if (p.agreed_price !== null) return p.agreed_price;
  const items = await db.prepare('SELECT quantity, price, is_extra, group_id FROM cost_items WHERE project_id = ?').all(projectId);
  const groups = (await db.prepare('SELECT id, name, markup, discount_type, discount FROM cost_groups WHERE project_id = ?').all(projectId)).map((g) => ({ id: g.id, name: g.name, markup: g.markup, discountType: g.discount_type, discount: g.discount }));
  const price = projectPrice(items.map((i) => ({ quantity: i.quantity, price: i.price, isExtra: !!i.is_extra, groupId: i.group_id })), p.profit_margin, groups);
  // a job with no costs yet has no price to hold the quote to
  return price > 0 ? price : null;
}

/** the quote tied to a job: its lines and price are the job's. One per job; a job made from a quote has none. */
async function followingQuote(projectId) {
  if (!projectId) return undefined;
  return db.prepare('SELECT * FROM quotes WHERE project_id = ? AND follows_project = 1').get(projectId);
}

/** what a job's quote should hold right now: one line per heading, and the price they come to */
async function jobQuoteLines(projectId) {
  const p = await db.prepare('SELECT profit_margin FROM projects WHERE id = ?').get(projectId);
  const items = await db.prepare('SELECT name, quantity, unit, price, is_extra, group_id FROM cost_items WHERE project_id = ? ORDER BY sort, id').all(projectId);
  const groups = (await db.prepare('SELECT id, name, markup, discount_type, discount FROM cost_groups WHERE project_id = ? ORDER BY sort, id').all(projectId))
    .map((g) => ({ id: g.id, name: g.name, markup: g.markup, discountType: g.discount_type, discount: g.discount }));
  return quoteLinesFromJob(items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, price: i.price, isExtra: !!i.is_extra, groupId: i.group_id })), groups, p.profit_margin);
}

const lineRow = (i) => ({ description: i.description, quantity: i.quantity, unit: i.unit ?? '', unit_price: i.unitPrice, round_up: i.roundUp ? 1 : 0 });

/** two lists of quote lines say the same thing */
const sameLines = (a, b) => a.length === b.length && a.every((x, n) => {
  const y = b[n];
  return x.description === y.description && x.quantity === y.quantity && (x.unit ?? '') === (y.unit ?? '') && toSatang(x.unitPrice) === toSatang(y.unitPrice) && !!x.roundUp === !!y.roundUp;
});

/** whether a quote already holds exactly what its job gives it */
async function inStepWithJob(quote, fresh) {
  const stored = await db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort, id').all(quote.id);
  return quote.discount_rate === 0 && sameLines(stored.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unit_price, roundUp: !!i.round_up })), fresh.lines);
}

/** the customer has this quote in hand (or has agreed to it), so it is not changed without the shop saying so */
const QUOTE_IS_OUT = ['sent', 'approved'];

/**
 * Brings the job's quote into line with the job as it stands, and says whether the quote changed.
 * A quote that is already sent or approved is only changed when the caller has confirmed it: otherwise the request
 * is refused with 409 and the details the confirmation needs, and nothing of it is kept.
 */
async function syncFollowingQuote(projectId, confirmed) {
  const quote = await followingQuote(projectId);
  if (!quote) return false;
  const fresh = await jobQuoteLines(projectId);
  if (await inStepWithJob(quote, fresh)) return false;
  if (QUOTE_IS_OUT.includes(quote.status) && !confirmed) {
    const stored = await db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort, id').all(quote.id);
    const rounding = ROUNDINGS.includes(quote.rounding) ? quote.rounding : 'baht';
    const before = quoteTotals({ items: stored.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, roundUp: !!i.round_up })), discountRate: quote.discount_rate, rounding }).afterDiscount;
    const err = new HttpError(409, `ใบเสนอราคา ${quote.code} ${quote.status === 'approved' ? 'ลูกค้าอนุมัติแล้ว' : 'ส่งให้ลูกค้าแล้ว'} การแก้นี้จะเปลี่ยนใบเสนอราคาตามโปรเจ็กต์ ยืนยันก่อนบันทึก`);
    err.data = { code: 'quote_change', quote: { id: String(quote.id), code: quote.code, status: quote.status, statusText: QUOTE_STATUS[quote.status], price: before, newPrice: fresh.price ?? 0 } };
    throw err;
  }
  await replaceQuoteItems(quote.id, fresh.lines.map(lineRow));
  await db.prepare(`UPDATE quotes SET locked_price = ?, discount_rate = 0, rounding = 'line', updated_at = ${NOW} WHERE id = ?`).run(fresh.price, quote.id);
  return true;
}

async function replaceQuoteItems(quoteId, items) {
  await db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quoteId);
  const ins = db.prepare('INSERT INTO quote_items (quote_id, description, quantity, unit, unit_price, round_up, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [idx, i] of items.entries()) await ins.run(quoteId, i.description, i.quantity, i.unit ?? '', i.unit_price, i.round_up ? 1 : 0, idx);
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

app.get('/api/quotes/:id', route(async (req) => serializeQuote(await getQuote(req.user.id, req.params.id), { withJob: true })));

/**
 * Turns a quote that was written on its own into a job, once the client has said yes: the job takes the
 * quote's details and its lines (as cost items waiting for a cost), and its price is the quote's amount
 * after the discount and before VAT. The quote is tied to the new job and held to that price.
 */
app.post('/api/quotes/:id/project', route(async (req, res) => {
  const quote = await getQuote(req.user.id, req.params.id);
  if (quote.project_id) throw new HttpError(400, 'ใบเสนอราคานี้มีโปรเจ็กต์อยู่แล้ว');
  const items = await db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort, id').all(quote.id);
  const { afterDiscount } = quoteTotals({ items: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, roundUp: !!i.round_up })), discountRate: quote.discount_rate, taxRate: quote.tax_rate, vatMode: quote.vat_mode, rounding: quote.rounding });
  if (!(afterDiscount > 0)) throw new HttpError(400, 'ใบเสนอราคานี้ยังไม่มียอดเงิน ใส่รายการก่อนสร้างโปรเจ็กต์');
  const rules = parseRules(req.user.rules);
  const title = quote.project_title || `งานของ ${quote.client_name}`;
  const project = await transaction(async () => {
    const code = await nextCode('projects', req.user.id, 'EV');
    const status = QUOTE_TO_PROJECT_STATUS[quote.status] || 'approved';
    const { lastInsertRowid } = await db
      .prepare(`INSERT INTO projects (user_id, code, customer_id, title, project_type, client, phone, email, event_date, notes, status, profit_margin, deposit_pct, agreed_price)
                VALUES (?, ?, ?, ?, 'อื่นๆ', ?, ?, ?, ?, ?, ?, 0, ?, ?) RETURNING id`)
      .run(req.user.id, code, quote.customer_id, title, quote.client_name, quote.client_phone, quote.client_email, quote.event_date, quote.notes, status,
        Number.isFinite(rules.depositPct) ? rules.depositPct : 30, afterDiscount);
    const projectId = Number(lastInsertRowid);
    await replaceCosts(projectId, {
      profit_margin: 0,
      groups: [{ id: 1, name: 'รายการต้นทุน', markup: 0 }],
      items: items.filter((i) => i.description).map((i) => ({ group: 1, name: i.description, category: 'material', quantity: i.quantity > 0 ? i.quantity : 1, unit: i.unit, price: 0, actual: null, is_extra: 0 })),
    });
    await db.prepare(`UPDATE quotes SET project_id = ?, locked_price = ?, updated_at = ${NOW} WHERE id = ?`).run(projectId, afterDiscount, quote.id);
    await logActivity(req.user.id, 'project_created', `โปรเจ็กต์ใหม่จากใบเสนอราคา ${quote.code} - ${title}`, 'เพิ่มแล้ว');
    return await getProject(req.user.id, projectId);
  });
  res.status(201);
  return serializeProject(project);
}));

app.post('/api/quotes', route(async (req, res) => {
  const d = await readQuoteBody(req.user.id, req.body);
  // a new quote lets each line choose; only quotes that already exist stay on the old whole-baht rule
  d.rounding ||= 'line';
  if (!d.client_name) throw new HttpError(400, 'กรุณากรอกชื่อลูกค้า');
  const quote = await transaction(async () => {
    const code = await nextCode('quotes', req.user.id, 'QT');
    const status = d.status || 'draft';
    const customerId = await resolveCustomer(req.user.id, customerChoice(req.body), d.client_name, d.client_phone, d.client_email);
    await syncCustomerContact(customerId, d.client_phone, d.client_email, req.body.updateCustomer === true);
    // A quote made for a job follows it: the lines and the price are the job's, whatever the caller sent, and one
    // quote per job does. A job that was itself made from a quote is the other way round: its price is settled, and
    // a quote for it is only held to that price.
    const job = d.project_id ? await db.prepare('SELECT agreed_price FROM projects WHERE id = ?').get(d.project_id) : null;
    const follows = !!job && job.agreed_price === null;
    let lockedPrice;
    if (follows) {
      const other = await followingQuote(d.project_id);
      if (other) throw new HttpError(400, `โปรเจ็กต์นี้มีใบเสนอราคา ${other.code} อยู่แล้ว เปิดใบนั้นแทนการสร้างใหม่`);
      const fresh = await jobQuoteLines(d.project_id);
      d.items = fresh.lines.map(lineRow);
      d.discount_rate = 0;
      d.rounding = 'line';
      lockedPrice = fresh.price;
    } else {
      lockedPrice = await lockedPriceOf(d.project_id);
      checkLockedPrice(lockedPrice, d, d.items || []);
    }
    const { lastInsertRowid } = await db
      .prepare(`INSERT INTO quotes (user_id, code, customer_id, project_id, client_name, client_phone, client_email, project_title, event_date, valid_until, notes, tax_rate, discount_rate, wht_rate, vat_mode, rounding, locked_price, status,
                                    client_address, client_tax_id, client_branch, reference_no, credit_days, internal_note, follows_project)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .run(req.user.id, code, customerId, d.project_id, d.client_name, d.client_phone, d.client_email, d.project_title, d.event_date, d.valid_until, d.notes, d.tax_rate, d.discount_rate, d.wht_rate,
        d.vat_mode || req.user.vat_mode, d.rounding, lockedPrice, status,
        d.client_address, d.client_tax_id, d.client_branch, d.reference_no, d.credit_days, d.internal_note, follows ? 1 : 0);
    await replaceQuoteItems(Number(lastInsertRowid), d.items || []);
    await syncProjectStatus(req.user.id, d.project_id, status);
    await logActivity(req.user.id, 'quote_created', `ใบเสนอราคาใหม่ ${code}`, status === 'sent' ? 'ส่งแล้ว' : 'สร้างแล้ว');
    return await getQuote(req.user.id, lastInsertRowid);
  });
  res.status(201);
  return serializeQuote(quote, { withJob: true });
}));

app.put('/api/quotes/:id', route(async (req) => {
  const existing = await getQuote(req.user.id, req.params.id);
  const merged = { ...(await serializeQuote(existing)), ...req.body };
  if (!('status' in req.body)) merged.status = existing.status;
  const d = await readQuoteBody(req.user.id, merged, existing);
  if (!d.client_name) throw new HttpError(400, 'กรุณากรอกชื่อลูกค้า');
  const status = d.status || existing.status;
  await transaction(async () => {
    const customerId = await resolveCustomer(req.user.id, customerChoice(req.body, existing, 'clientName', existing.client_name), d.client_name, d.client_phone, d.client_email);
    await syncCustomerContact(customerId, d.client_phone, d.client_email, req.body.updateCustomer === true);
    if (existing.follows_project && existing.project_id) {
      // its lines, discount and job are not the quote's to change: they are the job's, and are changed there
      d.project_id = existing.project_id;
      d.items = null;
      d.discount_rate = existing.discount_rate;
      d.rounding = existing.rounding;
    } else if ('items' in req.body || 'discountRate' in req.body || 'rounding' in req.body) {
      // only a change to the lines or the discount can break the lock; old quotes can still change status
      checkLockedPrice(existing.locked_price, d, d.items || []);
    }
    await db.prepare(`UPDATE quotes SET customer_id=?, project_id=?, client_name=?, client_phone=?, client_email=?, project_title=?, event_date=?, valid_until=?, notes=?, tax_rate=?, discount_rate=?, wht_rate=?, vat_mode=?, rounding=?, status=?,
                                    client_address=?, client_tax_id=?, client_branch=?, reference_no=?, credit_days=?, internal_note=?, updated_at=${NOW}
                WHERE id = ? AND user_id = ?`)
      .run(customerId, d.project_id, d.client_name, d.client_phone, d.client_email, d.project_title, d.event_date, d.valid_until, d.notes, d.tax_rate, d.discount_rate, d.wht_rate, d.vat_mode || existing.vat_mode, d.rounding || existing.rounding || 'baht', status,
        d.client_address, d.client_tax_id, d.client_branch, d.reference_no, d.credit_days, d.internal_note, existing.id, req.user.id);
    if (d.items) await replaceQuoteItems(existing.id, d.items);
    if (status !== existing.status) {
      await syncProjectStatus(req.user.id, d.project_id, status);
      await logActivity(req.user.id, `quote_${status}`, `ใบเสนอราคา ${existing.code}`, QUOTE_STATUS[status]);
    }
  });
  return serializeQuote(await getQuote(req.user.id, existing.id), { withJob: true });
}));

// A quote tied to its job normally keeps up by itself. One made before the two were tied may still hold its old
// lines; this brings it into line with the job when the shop asks for that (with the same confirmation as a job save).
app.post('/api/quotes/:id/sync', route(async (req) => {
  const quote = await getQuote(req.user.id, req.params.id);
  if (!quote.follows_project || !quote.project_id) throw new HttpError(400, 'ใบเสนอราคานี้ไม่ได้ผูกกับโปรเจ็กต์');
  await transaction(() => syncFollowingQuote(quote.project_id, req.body?.confirmQuoteChange === true));
  return serializeQuote(await getQuote(req.user.id, quote.id), { withJob: true });
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
      const agreed = p.agreed_price !== null;
      const profit = agreed ? p.agreed_price - p.cost : p.cost * (p.profit_margin / 100);
      // a job taken at an agreed price with no costs entered yet would count as pure profit: it waits until it has costs
      const uncosted = agreed && p.cost === 0;
      const won = ['approved', 'completed'].includes(p.status);
      return { ...p, profit, sales: p.cost + profit, month: (p.event_date || p.created_at).slice(0, 7), sold: won && !uncosted, uncosted: won && uncosted };
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

/**
 * Sales, cost and profit of sold jobs (approved or completed) whose day falls inside from–to,
 * by month, by customer and job by job. A job's day is its event date, or the day it was created
 * when no event date is set. Either bound may be left out.
 */
async function salesReport(userId, rows, from, to) {
  const names = new Map((await db.prepare('SELECT id, name FROM customers WHERE user_id = ?').all(userId)).map((c) => [c.id, c.name]));
  const jobs = rows
    .filter((r) => r.sold)
    .map((r) => ({
      id: String(r.id),
      code: r.code,
      title: r.title,
      date: (r.event_date || r.created_at).slice(0, 10),
      customerId: r.customer_id ? String(r.customer_id) : null,
      customer: names.get(r.customer_id) || r.client || '',
      statusText: PROJECT_STATUS[r.status],
      sales: wholeBaht(r.sales),
      cost: wholeBaht(r.cost),
      profit: wholeBaht(r.sales) - wholeBaht(r.cost),
    }))
    .filter((j) => (!from || j.date >= from) && (!to || j.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));

  const sum = (list) => ({
    jobs: list.length,
    sales: list.reduce((s, j) => s + j.sales, 0),
    cost: list.reduce((s, j) => s + j.cost, 0),
    profit: list.reduce((s, j) => s + j.profit, 0),
  });
  const group = (keyOf) => {
    const groups = new Map();
    for (const j of jobs) {
      const key = keyOf(j);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(j);
    }
    return groups;
  };

  const byMonth = [...group((j) => j.date.slice(0, 7))]
    .map(([key, list]) => ({ key, month: `${TH_MONTHS[Number(key.slice(5)) - 1]} ${Number(key.slice(0, 4)) + 543}`, ...sum(list) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  // jobs not tied to a customer are grouped by the name typed on them
  const byCustomer = [...group((j) => (j.customerId ? `id:${j.customerId}` : `name:${j.customer.toLowerCase()}`))]
    .map(([, list]) => ({ customerId: list[0].customerId, name: list[0].customer, ...sum(list) }))
    .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name, 'th'));

  return { from, to, totals: sum(jobs), byMonth, byCustomer, jobs };
}

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
  const sales = await salesReport(req.user.id, rows, date(req.query.from), date(req.query.to));
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
    sales,
    // accepted jobs left out of every figure above because their costs are not in yet
    uncosted: { count: rows.filter((r) => r.uncosted).length, sales: rows.filter((r) => r.uncosted).reduce((s, r) => s + r.sales, 0) },
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
  // `data`: what the client needs to act on a refusal (for instance the quote a save would change), never on a 500
  res.status(status).json({ error: badJson ? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' : status >= 500 ? 'เกิดข้อผิดพลาดในระบบ' : err.message, ...(status < 500 && err.data ? err.data : {}) });
});
