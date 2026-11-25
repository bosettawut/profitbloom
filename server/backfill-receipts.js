// Issues the receipt for every approved quote that has none yet, from before receipts existed, so the report page
// (which counts receipts only) shows that money. Each receipt is made exactly as the quote's page makes one
// (issueReceipt), so the quote's job is finished by it.
//
// Which quotes: approved, with no receipt in force, and either written on their own or the quote their job's page
// opens. An older copy of a job's quote is left alone: a receipt for it would count the job's money twice.
//
// The day paid: the event date on the quote, or the day the quote was last saved when it has none; but never later
// than today (in Thailand), so an event still to come is paid today. How: transfer.
//
//   node --env-file=.env server/backfill-receipts.js            lists what it would issue, writes nothing
//   node --env-file=.env server/backfill-receipts.js --apply    issues them
//
// The database is DATABASE_URL (or POSTGRES_URL), as for the server; point it at another with that variable.
import { amountOfQuote, issueReceipt, quoteOfJob } from './app.js';
import { close, connectionConfig, db, ready } from './db.js';

const apply = process.argv.includes('--apply');
const host = (() => {
  try {
    return new URL(connectionConfig().connectionString).hostname;
  } catch {
    return '?';
  }
})();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const money = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

await ready();
const quotes = await db.prepare(`SELECT q.* FROM quotes q
  WHERE q.status = 'approved' AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.quote_id = q.id AND r.status = 'issued')
  ORDER BY q.user_id, q.created_at, q.id`).all();

const plan = [];
const skipped = [];
for (const q of quotes) {
  const job = q.project_id ? await db.prepare('SELECT * FROM projects WHERE id = ?').get(q.project_id) : null;
  if (job) {
    const own = await quoteOfJob(job);
    if (!own || Number(own.id) !== Number(q.id)) {
      skipped.push(`${q.code} ฉบับเก่าของโปรเจ็กต์ ${job.code} (โปรเจ็กต์เปิดใบ ${own?.code ?? '-'}) จะนับยอดซ้ำ`);
      continue;
    }
  }
  const totals = await amountOfQuote(q);
  if (!(totals.afterDiscount > 0)) {
    skipped.push(`${q.code} ยังไม่มียอดเงิน`);
    continue;
  }
  const day = q.event_date || q.updated_at.slice(0, 10);
  const paidDate = day > today ? today : day;
  plan.push({ q, job, totals, paidDate });
}

console.log(`ฐานข้อมูล: ${host}`);
console.log(`ใบเสนอราคาที่อนุมัติแล้ว ยังไม่มีใบเสร็จ: ${quotes.length} ใบ · จะออกใบเสร็จ ${plan.length} ใบ · ข้าม ${skipped.length} ใบ\n`);
for (const { q, job, totals, paidDate } of plan) {
  const after = job ? `โปรเจ็กต์ ${job.code} ${job.status === 'completed' ? 'เสร็จสิ้นอยู่แล้ว' : `→ เสร็จสิ้น (จาก ${job.status})`}` : 'ไม่มีโปรเจ็กต์';
  console.log(`  ${q.code} · ${q.client_name} · ${q.project_title || '-'} · ก่อน VAT ฿${money(totals.beforeVat)} (รวม ฿${money(totals.total)}) · รับเงิน ${paidDate} · ${after}`);
}
for (const why of skipped) console.log(`  ข้าม: ${why}`);

if (!apply) {
  console.log('\nยังไม่ได้ออกจริง ใส่ --apply เพื่อออกใบเสร็จตามรายการนี้');
} else {
  let made = 0;
  for (const { q, paidDate } of plan) {
    const r = await issueReceipt(q.user_id, q, { paidDate, paymentMethod: 'transfer' });
    console.log(`  ออก ${r.code} จาก ${q.code}`);
    made++;
  }
  console.log(`\nออกใบเสร็จแล้ว ${made} ใบ`);
}
await close();
