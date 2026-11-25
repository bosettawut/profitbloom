import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Database access: PostgreSQL.
 * - On Vercel: Supabase, through DATABASE_URL (use the pooled "transaction" connection string).
 * - Locally: the `profitbloom` database on this machine (createdb profitbloom).
 */
const LOCAL_URL = 'postgresql://localhost:5432/profitbloom';

// COUNT(*) and SUM() come back as bigint/numeric, which pg hands over as strings; the app wants numbers
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);

export function connectionConfig(url = process.env.DATABASE_URL || process.env.POSTGRES_URL || LOCAL_URL) {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  // TLS is decided here, not by the URL: pg would let ?sslmode= override the settings below
  u.searchParams.delete('sslmode');
  const ca = process.env.DATABASE_CA_CERT;
  return {
    connectionString: u.toString(),
    // hosted databases are always encrypted; with DATABASE_CA_CERT the server certificate is verified too
    ssl: local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}

const pool = new pg.Pool({
  ...connectionConfig(),
  // a serverless instance handles few requests at once; the Supabase pooler does the real pooling
  max: Number(process.env.DATABASE_POOL_MAX) || 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});
// a dropped idle connection must not take the process down; the next query opens a new one
pool.on('error', (err) => console.error('database connection lost:', err.message));

// inside transaction(), statements run on the transaction's connection instead of the pool
const txStore = new AsyncLocalStorage();
const runner = () => txStore.getStore() ?? pool;

/** "now" in the format every timestamp column uses: UTC, `YYYY-MM-DD HH:MM:SS`. */
export const NOW = `to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')`;

/** `?` placeholders, as the queries are written, become Postgres's $1, $2, … */
const numbered = (sql) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

/**
 * prepare(sql) → get / all / run, with `?` placeholders.
 * run() reports `changes`, and `lastInsertRowid` when the statement ends with RETURNING id.
 */
export const db = {
  prepare(sql) {
    const text = numbered(sql);
    const exec = (args) => runner().query(text, args.map((a) => (a === undefined ? null : a)));
    return {
      get: async (...args) => (await exec(args)).rows[0],
      all: async (...args) => (await exec(args)).rows,
      run: async (...args) => {
        const rs = await exec(args);
        return { changes: rs.rowCount, lastInsertRowid: rs.rows[0]?.id };
      },
    };
  },
  /** several statements at once, no parameters */
  exec: (sql) => runner().query(sql),
};

export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStore.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const close = () => pool.end();

/**
 * Turns the client names typed on projects and quotes into customers and links them.
 * One customer per shop and name (ignoring case and surrounding spaces); the phone and email come
 * from the most recently edited record that has one. Only touches rows not linked yet, so it is
 * safe to run again — the data import from the old database runs it after copying the rows.
 */
export const LINK_CUSTOMERS = `
  INSERT INTO customers (user_id, name, phone, email)
  SELECT s.user_id,
         (array_agg(s.name ORDER BY s.updated_at DESC))[1],
         COALESCE((array_agg(s.phone ORDER BY s.updated_at DESC) FILTER (WHERE s.phone <> ''))[1], ''),
         COALESCE((array_agg(s.email ORDER BY s.updated_at DESC) FILTER (WHERE s.email <> ''))[1], '')
  FROM (
    SELECT user_id, btrim(client) AS name, btrim(phone) AS phone, btrim(email) AS email, updated_at
      FROM projects WHERE customer_id IS NULL AND btrim(client) <> ''
    UNION ALL
    SELECT user_id, btrim(client_name), btrim(client_phone), btrim(client_email), updated_at
      FROM quotes WHERE customer_id IS NULL AND btrim(client_name) <> ''
  ) s
  WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.user_id = s.user_id AND lower(c.name) = lower(s.name))
  GROUP BY s.user_id, lower(s.name);

  UPDATE projects p SET customer_id =
    (SELECT MIN(c.id) FROM customers c WHERE c.user_id = p.user_id AND lower(c.name) = lower(btrim(p.client)))
  WHERE p.customer_id IS NULL AND btrim(p.client) <> '';

  UPDATE quotes q SET customer_id =
    (SELECT MIN(c.id) FROM customers c WHERE c.user_id = q.user_id AND lower(c.name) = lower(btrim(q.client_name)))
  WHERE q.customer_id IS NULL AND btrim(q.client_name) <> '';
`;

/**
 * Schema changes, in order. Never edit one that has shipped: add a new entry at the end.
 * Each runs once per database, inside a transaction; schema_version remembers how far it got.
 *
 * Conventions carried over from the first (SQLite) release so the data moves across unchanged:
 * timestamps are UTC text `YYYY-MM-DD HH:MM:SS`, dates are text `YYYY-MM-DD`, flags are 0/1.
 */
/**
 * Ties each job to its quote: of a job's quotes, the newest is the one that follows it from here on; older ones stay
 * as they are. A job made from a quote (agreed_price set) is the other way round and is left alone.
 * Used by migration 14 and again after importing the old database, whose quotes arrive untied.
 */
export const TIE_QUOTES = `
  UPDATE quotes q SET follows_project = 1
   WHERE q.project_id IS NOT NULL AND q.follows_project = 0
     AND EXISTS (SELECT 1 FROM projects p WHERE p.id = q.project_id AND p.agreed_price IS NULL)
     AND NOT EXISTS (SELECT 1 FROM quotes f WHERE f.project_id = q.project_id AND f.follows_project = 1)
     AND q.id = (SELECT q2.id FROM quotes q2 WHERE q2.project_id = q.project_id ORDER BY q2.created_at DESC, q2.id DESC LIMIT 1);
`;

/**
 * A customer's days of credit start from the latest of their quotes that gave any (a customer that already has a
 * credit keeps it). Safe to run again.
 */
export const CUSTOMER_CREDIT = `
  UPDATE customers c SET credit_days = q.credit_days
    FROM (SELECT DISTINCT ON (customer_id) customer_id, credit_days FROM quotes
           WHERE customer_id IS NOT NULL AND credit_days > 0
           ORDER BY customer_id, created_at DESC, id DESC) q
   WHERE c.id = q.customer_id AND c.credit_days = 0;
`;

/**
 * A customer's address, tax id and office/branch start from their latest quote that gave each (a customer that
 * already has one keeps it). Safe to run again.
 */
export const CUSTOMER_FROM_QUOTES = ['client_address:address', 'client_tax_id:tax_id', 'client_branch:branch']
  .map((pair) => {
    const [from, to] = pair.split(':');
    return `
  UPDATE customers c SET ${to} = q.${from}
    FROM (SELECT DISTINCT ON (customer_id) customer_id, ${from} FROM quotes
           WHERE customer_id IS NOT NULL AND ${from} <> ''
           ORDER BY customer_id, created_at DESC, id DESC) q
   WHERE c.id = q.customer_id AND c.${to} = '';`;
  })
  .join('\n');

/**
 * A job made from a quote takes its price from that quote, so its quotes are no longer held to a locked price: the
 * lines are changed freely on the quote and the job's price follows. Safe to run again.
 */
export const UNLOCK_AGREED = `
  UPDATE quotes q SET locked_price = NULL
   WHERE q.locked_price IS NOT NULL AND q.follows_project = 0
     AND EXISTS (SELECT 1 FROM projects p WHERE p.id = q.project_id AND p.agreed_price IS NOT NULL);
`;

/**
 * Gives every job that has costs but no heading yet one heading holding all of them, at the job's
 * own markup, so its price stays exactly what it was. Safe to run again.
 */
export const GROUP_COSTS = `
  INSERT INTO cost_groups (project_id, name, markup)
    SELECT p.id, 'รายการต้นทุน', p.profit_margin FROM projects p
    WHERE EXISTS (SELECT 1 FROM cost_items c WHERE c.project_id = p.id AND c.is_extra = 0 AND c.group_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM cost_groups g WHERE g.project_id = p.id);
  UPDATE cost_items c SET group_id = g.id FROM cost_groups g
    WHERE g.project_id = c.project_id AND c.group_id IS NULL AND c.is_extra = 0
      AND g.id = (SELECT MIN(id) FROM cost_groups WHERE project_id = c.project_id);
`;

const MIGRATIONS = [
  // 1 — the schema as it stood on SQLite/Turso
  `
  CREATE TABLE users (
    id               INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name             TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE,
    password_hash    TEXT NOT NULL,
    business_name    TEXT NOT NULL DEFAULT '',
    business_address TEXT NOT NULL DEFAULT '',
    business_phone   TEXT NOT NULL DEFAULT '',
    business_tax_id  TEXT NOT NULL DEFAULT '',
    business_logo    TEXT NOT NULL DEFAULT '',
    plan             TEXT NOT NULL DEFAULT 'trial',
    trial_ends_at    TEXT,
    role             TEXT NOT NULL DEFAULT 'shop',
    disabled         INTEGER NOT NULL DEFAULT 0,
    rules            TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE projects (
    id             INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code           TEXT NOT NULL,
    title          TEXT NOT NULL,
    project_type   TEXT NOT NULL,
    client         TEXT NOT NULL DEFAULT '',
    phone          TEXT NOT NULL DEFAULT '',
    email          TEXT NOT NULL DEFAULT '',
    event_date     TEXT,
    budget         DOUBLE PRECISION NOT NULL DEFAULT 0,
    notes          TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'draft',
    profit_margin  DOUBLE PRECISION NOT NULL DEFAULT 30,
    deposit_pct    DOUBLE PRECISION NOT NULL DEFAULT 30,
    setup_days     DOUBLE PRECISION NOT NULL DEFAULT 1,
    event_days     DOUBLE PRECISION NOT NULL DEFAULT 1,
    labor_days     DOUBLE PRECISION,
    team_size      DOUBLE PRECISION,
    owner_labor    INTEGER,
    teardown       INTEGER,
    review_applied INTEGER NOT NULL DEFAULT 0,
    reviewed_at    TEXT,
    created_at     TEXT NOT NULL DEFAULT ${NOW},
    updated_at     TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE cost_items (
    id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'material',
    quantity    DOUBLE PRECISION NOT NULL DEFAULT 0,
    price       DOUBLE PRECISION NOT NULL DEFAULT 0,
    paid_before INTEGER NOT NULL DEFAULT 1,
    actual      DOUBLE PRECISION,
    is_extra    INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE quotes (
    id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code          TEXT NOT NULL,
    project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    client_name   TEXT NOT NULL DEFAULT '',
    client_phone  TEXT NOT NULL DEFAULT '',
    client_email  TEXT NOT NULL DEFAULT '',
    project_title TEXT NOT NULL DEFAULT '',
    event_date    TEXT,
    valid_until   TEXT,
    notes         TEXT NOT NULL DEFAULT '',
    tax_rate      DOUBLE PRECISION NOT NULL DEFAULT 7,
    discount_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'draft',
    created_at    TEXT NOT NULL DEFAULT ${NOW},
    updated_at    TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE quote_items (
    id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    quantity    DOUBLE PRECISION NOT NULL DEFAULT 0,
    unit_price  DOUBLE PRECISION NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE activities (
    id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    title      TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_projects_user ON projects(user_id);
  CREATE INDEX idx_cost_items_project ON cost_items(project_id);
  CREATE INDEX idx_quotes_user ON quotes(user_id);
  CREATE INDEX idx_quotes_project ON quotes(project_id);
  CREATE INDEX idx_quote_items_quote ON quote_items(quote_id);
  CREATE INDEX idx_activities_user ON activities(user_id, created_at);

  -- Supabase publishes the public schema through its own REST API. Row level security with no
  -- policies shuts that door; this server connects as the table owner and is not affected.
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
  ALTER TABLE cost_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
  `,

  // 2 — password reset links, and sign-in attempts counted in the database (serverless instances share no memory)
  `
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_password_resets_user ON password_resets(user_id);

  CREATE TABLE auth_attempts (
    id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    key        TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_auth_attempts_key ON auth_attempts(key, created_at);

  ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY;
  `,

  // 3 — customers, linked from projects and quotes; client names already typed in become customers
  `
  CREATE TABLE customers (
    id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    line_id    TEXT NOT NULL DEFAULT '',
    address    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_customers_user ON customers(user_id);
  ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

  -- deleting a customer keeps their jobs and quotes (the name stays on them), only the link goes
  ALTER TABLE projects ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
  ALTER TABLE quotes ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
  CREATE INDEX idx_projects_customer ON projects(customer_id);
  CREATE INDEX idx_quotes_customer ON quotes(customer_id);

  ${LINK_CUSTOMERS}
  `,

  // 4 — VAT handling per quote (with a shop default) and the job price a quote is locked to
  `
  ALTER TABLE users ADD COLUMN vat_mode TEXT NOT NULL DEFAULT 'exclusive';
  ALTER TABLE quotes ADD COLUMN vat_mode TEXT NOT NULL DEFAULT 'exclusive';
  ALTER TABLE quotes ADD COLUMN locked_price DOUBLE PRECISION;
  UPDATE quotes SET vat_mode = 'none' WHERE tax_rate = 0;
  `,

  // 5 — costs sit under headings the shop names itself, each with its own markup; existing costs go under one heading
  `
  CREATE TABLE cost_groups (
    id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT '',
    markup     DOUBLE PRECISION NOT NULL DEFAULT 0,
    sort       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_cost_groups_project ON cost_groups(project_id);
  ALTER TABLE cost_groups ENABLE ROW LEVEL SECURITY;
  ALTER TABLE cost_items ADD COLUMN group_id INTEGER REFERENCES cost_groups(id) ON DELETE SET NULL;

  ${GROUP_COSTS}
  `,

  // 6 — cost categories a shop adds to the built-in ones; a cost item refers to one as 'c<id>'
  `
  CREATE TABLE cost_categories (
    id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_cost_categories_user ON cost_categories(user_id);
  ALTER TABLE cost_categories ENABLE ROW LEVEL SECURITY;
  `,

  // 7 — a job made from a quote the client already accepted: its price is that quote's, whatever the costs come to
  `
  ALTER TABLE projects ADD COLUMN agreed_price DOUBLE PRECISION;
  `,

  // 8 — a quote chooses how its amounts are rounded: to whole baht (as every quote so far) or to the satang
  `
  ALTER TABLE quotes ADD COLUMN rounding TEXT NOT NULL DEFAULT 'baht';
  `,

  // 9 — each line of a quote says whether its amount rounds up to a whole baht
  `
  ALTER TABLE quote_items ADD COLUMN round_up INTEGER NOT NULL DEFAULT 0;
  `,

  // 10 — withholding tax on a quote: the % the customer holds back from the price without VAT (0 = none)
  `
  ALTER TABLE quotes ADD COLUMN wht_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
  `,

  // 11 — a cost item can say what it is counted in (ดอก, กำ, คน, เที่ยว): free text, not used in any sum
  `
  ALTER TABLE cost_items ADD COLUMN unit TEXT NOT NULL DEFAULT '';
  `,

  // 12 — a heading can take a discount off the price its markup gives: a share of it ('percent') or an amount ('baht'); 0 = none
  `
  ALTER TABLE cost_groups ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'percent';
  ALTER TABLE cost_groups ADD COLUMN discount DOUBLE PRECISION NOT NULL DEFAULT 0;
  `,

  // 13 — a quote can carry what a company needs on it (the customer's address, tax id and branch), a reference
  //      number, the days of credit after the event, and a note for the shop's own eyes; each line can say its unit
  `
  ALTER TABLE quotes ADD COLUMN client_address TEXT NOT NULL DEFAULT '';
  ALTER TABLE quotes ADD COLUMN client_tax_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE quotes ADD COLUMN client_branch TEXT NOT NULL DEFAULT '';
  ALTER TABLE quotes ADD COLUMN reference_no TEXT NOT NULL DEFAULT '';
  ALTER TABLE quotes ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE quotes ADD COLUMN internal_note TEXT NOT NULL DEFAULT '';
  ALTER TABLE quote_items ADD COLUMN unit TEXT NOT NULL DEFAULT '';
  `,

  // 14 — a job and its quote are tied together: the quote's lines and price are the job's, and change when the job
  //      is saved. One quote per job follows it. For jobs that already have quotes it is the newest one; older ones
  //      stay as they are. A job made from a quote (agreed_price set) is the other way round and is left alone.
  `
  ALTER TABLE quotes ADD COLUMN follows_project INTEGER NOT NULL DEFAULT 0;
  ${TIE_QUOTES}
  CREATE UNIQUE INDEX idx_quotes_follows ON quotes(project_id) WHERE follows_project = 1;
  `,

  // 15 — the last number handed out for each shop, kind of document (its prefix: QT, WD, EN, …) and year, so a number
  //      once given is never given again, even when its document is deleted (a customer may already hold it)
  `
  CREATE TABLE doc_counters (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prefix  TEXT NOT NULL,
    year    INTEGER NOT NULL,
    last_n  INTEGER NOT NULL,
    PRIMARY KEY (user_id, prefix, year)
  );
  ALTER TABLE doc_counters ENABLE ROW LEVEL SECURITY;
  `,

  // 16 — a quote whose job was deleted remembers the job's number, so it can say so (it is cancelled with the job)
  `
  ALTER TABLE quotes ADD COLUMN deleted_project_code TEXT NOT NULL DEFAULT '';
  `,

  // 17 — a customer has days of credit, which a new quote for them starts with (from their latest quote that gave
  //      any); and the quotes of a job made from a quote are no longer locked to its price: the job's price follows them
  `
  ALTER TABLE customers ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 0;
  ${CUSTOMER_CREDIT}
  ${UNLOCK_AGREED}
  `,

  // 18 — a customer has a tax id and an office/branch for their quotes, as they have an address; all three start
  //      from their latest quote that gave each
  `
  ALTER TABLE customers ADD COLUMN tax_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE customers ADD COLUMN branch TEXT NOT NULL DEFAULT '';
  ${CUSTOMER_FROM_QUOTES}
  `,

  // 19 — receipts. One is issued from an approved quote and keeps a copy of everything the quote printed, so it reads
  //      the same whatever happens to the quote later. A quote has at most one receipt in force ('issued'); a
  //      cancelled one stays, with its number, since the customer may hold it.
  `
  CREATE TABLE receipts (
    id             INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'issued',
    quote_id       INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
    project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    quote_code     TEXT NOT NULL DEFAULT '',
    client_name    TEXT NOT NULL DEFAULT '',
    client_phone   TEXT NOT NULL DEFAULT '',
    client_email   TEXT NOT NULL DEFAULT '',
    client_address TEXT NOT NULL DEFAULT '',
    client_tax_id  TEXT NOT NULL DEFAULT '',
    client_branch  TEXT NOT NULL DEFAULT '',
    project_title  TEXT NOT NULL DEFAULT '',
    reference_no   TEXT NOT NULL DEFAULT '',
    event_date     TEXT,
    notes          TEXT NOT NULL DEFAULT '',
    tax_rate       DOUBLE PRECISION NOT NULL DEFAULT 7,
    discount_rate  DOUBLE PRECISION NOT NULL DEFAULT 0,
    wht_rate       DOUBLE PRECISION NOT NULL DEFAULT 0,
    vat_mode       TEXT NOT NULL DEFAULT 'exclusive',
    rounding       TEXT NOT NULL DEFAULT 'line',
    paid_date      TEXT,
    payment_method TEXT NOT NULL DEFAULT 'transfer',
    created_at     TEXT NOT NULL DEFAULT ${NOW},
    updated_at     TEXT NOT NULL DEFAULT ${NOW},
    cancelled_at   TEXT
  );
  CREATE TABLE receipt_items (
    id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    receipt_id  INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    quantity    DOUBLE PRECISION NOT NULL DEFAULT 0,
    unit        TEXT NOT NULL DEFAULT '',
    unit_price  DOUBLE PRECISION NOT NULL DEFAULT 0,
    round_up    INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_receipts_user ON receipts(user_id);
  CREATE INDEX idx_receipts_quote ON receipts(quote_id);
  CREATE INDEX idx_receipts_project ON receipts(project_id);
  CREATE UNIQUE INDEX idx_receipts_in_force ON receipts(quote_id) WHERE status = 'issued';
  CREATE INDEX idx_receipt_items_receipt ON receipt_items(receipt_id);
  ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;
  `,
];

async function schemaVersion(q) {
  try {
    return (await q.query('SELECT version FROM schema_version')).rows[0]?.version ?? 0;
  } catch (err) {
    if (err.code === '42P01') return 0; // no such table: a brand-new database
    throw err;
  }
}

async function migrate() {
  if ((await schemaVersion(pool)) >= MIGRATIONS.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // two instances starting together: the second waits here, then finds nothing left to do
    await client.query('SELECT pg_advisory_xact_lock(77620911)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    await client.query('ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY');
    const { rows } = await client.query('SELECT version FROM schema_version');
    if (!rows.length) await client.query('INSERT INTO schema_version (version) VALUES (0)');
    for (let v = rows[0]?.version ?? 0; v < MIGRATIONS.length; v++) await client.query(MIGRATIONS[v]);
    await client.query('UPDATE schema_version SET version = $1', [MIGRATIONS.length]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let migrated = null;
/** Brings the schema up to date once per process (cold start). A failed attempt is retried on the next call. */
export const ready = () =>
  (migrated ??= migrate().catch((err) => {
    migrated = null;
    throw err;
  }));
