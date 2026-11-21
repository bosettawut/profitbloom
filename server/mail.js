// Outgoing email. With RESEND_API_KEY set, mail goes out through Resend (https://resend.com);
// without it (local development) the message is printed to the server log instead.
// The automated tests set MAIL_OUTBOX_FILE to collect what would have been sent.
import fs from 'node:fs';

const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function sendMail({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!IS_PROD && process.env.MAIL_OUTBOX_FILE) {
    fs.appendFileSync(process.env.MAIL_OUTBOX_FILE, JSON.stringify({ to, subject, text }) + '\n');
    return;
  }
  if (!key) {
    // never write a live reset link into production logs
    if (IS_PROD) console.error(`ยังไม่ได้ตั้งค่า RESEND_API_KEY: อีเมล "${subject}" ไม่ถูกส่ง`);
    else console.log(`\n--- อีเมลถึง ${to} (ยังไม่ได้ตั้งค่าการส่งอีเมล จึงแสดงที่นี่) ---\n${subject}\n\n${text}\n---\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'ProfitBloom <onboarding@resend.dev>', to: [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`ส่งอีเมลไม่สำเร็จ (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

export function passwordResetMail({ name, link, minutes }) {
  const subject = 'ตั้งรหัสผ่านใหม่สำหรับ ProfitBloom';
  const text = `สวัสดี คุณ${name}

มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชี ProfitBloom ของคุณ กดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่:

${link}

ลิงก์ใช้ได้ครั้งเดียว และหมดอายุใน ${minutes} นาที
ถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ

ทีม ProfitBloom`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#221A33">
  <h1 style="font-size:20px;margin:0 0 16px">ตั้งรหัสผ่านใหม่</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px">สวัสดี คุณ${escapeHtml(name)}<br>มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชี ProfitBloom ของคุณ</p>
  <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#673AB7;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:9999px">ตั้งรหัสผ่านใหม่</a></p>
  <p style="font-size:13px;line-height:1.6;color:#5B566D;margin:0">ลิงก์ใช้ได้ครั้งเดียว และหมดอายุใน ${minutes} นาที<br>ถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ</p>
</div>`;
  return { subject, text, html };
}
