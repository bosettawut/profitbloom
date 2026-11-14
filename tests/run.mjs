// Starts the API on a temporary database, runs the end-to-end checks, then cleans up.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const port = 4321;

// a throwaway database next to the development one, on the same Postgres server
const adminUrl = new URL(process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/postgres');
const dbName = `profitbloom_test_${process.pid}`;
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${dbName}`;

const admin = new pg.Client({ connectionString: adminUrl.toString() });
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
} catch (err) {
  console.error(`เชื่อมต่อ PostgreSQL สำหรับทดสอบไม่ได้ (${adminUrl.host}): ${err.message}`);
  console.error('เปิด PostgreSQL บนเครื่องก่อน หรือกำหนด TEST_DATABASE_URL');
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: testUrl.toString(), API_PORT: String(port), NODE_ENV: 'test' };
delete env.POSTGRES_URL;

const server = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
const stopped = new Promise((resolve) => server.once('exit', resolve));
let code = 1;
try {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://localhost:${port}/api/auth/me`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  code = spawnSync(process.execPath, ['tests/api.e2e.mjs'], {
    cwd: root,
    env: { ...env, BASE: `http://localhost:${port}`, PROJECT_DIR: root },
    stdio: 'inherit',
  }).status;
} finally {
  server.kill();
  await stopped;
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch((err) => console.error(err.message));
  await admin.end();
}
process.exit(code ?? 1);
