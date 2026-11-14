# ProfitBloom

ระบบคำนวณต้นทุน–กำไร และออกใบเสนอราคา สำหรับธุรกิจจัดดอกไม้/จัดงาน

ส่งมอบงาน / เจ้าของใหม่: อ่าน [HANDOVER.md](HANDOVER.md) ก่อน

- **Frontend:** React + Vite + Tailwind (ดีไซน์จาก Figma Make)
- **Backend:** Node.js + Express, ฐานข้อมูล PostgreSQL ผ่าน `pg` — บนเครื่องใช้ PostgreSQL ในเครื่อง, บน Vercel ใช้ [Supabase](https://supabase.com) (สิงคโปร์)
- **Login:** อีเมล + รหัสผ่าน (scrypt hash), session cookie แบบ httpOnly

ต้องใช้ Node.js 22.13 ขึ้นไป และ PostgreSQL 14 ขึ้นไป

## รันบนเครื่อง (development)

```bash
npm install
createdb profitbloom     # ครั้งแรกครั้งเดียว
npm run dev
```

เปิด http://localhost:5173 แล้วสมัครสมาชิกได้เลย
(`npm run dev` รันทั้ง API ที่พอร์ต 3001 และหน้าเว็บที่พอร์ต 5173 โดย Vite ส่งต่อ `/api` ไปที่ API)

ข้อมูลเก็บในฐานข้อมูล `profitbloom` ของ PostgreSQL บนเครื่อง (ตารางถูกสร้างให้อัตโนมัติ) ถ้าต้องการเริ่มใหม่ทั้งหมด: `dropdb profitbloom && createdb profitbloom`
ถ้า PostgreSQL ไม่ได้อยู่ที่ `localhost:5432` ให้กำหนด `DATABASE_URL` เช่น `postgresql://user:pass@host:5432/profitbloom`

## หน้าเว็บ

| ที่อยู่ | หน้า |
| --- | --- |
| `/` | หน้าเว็บหลัก (Landing page) |
| `/login`, `/signup` | เข้าสู่ระบบ / สมัครสมาชิก |
| `/app`, `/app/projects`, `/app/projects/12`, `/app/quotes`, … | ตัวโปรแกรม ProfitBloom — แต่ละหน้าจอมีที่อยู่ของตัวเอง (ดู `src/lib/route.ts`) ปุ่มย้อนกลับของเบราว์เซอร์จึงย้อนทีละหน้าจอ |

ข้อความ ตัวเลข ราคาแพ็กเกจ รีวิว อีเมลติดต่อ และลิงก์โซเชียลของหน้าเว็บหลักแก้ได้ที่เดียวใน `src/landing/content.ts`
รูปภาพอยู่ใน `public/landing/`

## แพ็กเกจ

ใช้ชุดเดียวกับหน้าเว็บ: **Free Trial** (30 วัน) / **Starter** (฿990 ต่อปี) / **Pro** (฿1,590 ต่อปี)
ชื่อ ราคา และรายการฟีเจอร์แก้ที่ `PLANS` ใน `src/landing/content.ts` ที่เดียว — หน้าเว็บ หน้าแพ็กเกจในแอป และหน้าแอดมินใช้ข้อมูลชุดนี้

- ร้านที่สมัครใหม่เริ่มที่ Free Trial 30 วัน (เหลือ ≤ 7 วันจะมีแถบเตือนที่หน้าหลัก)
- เปลี่ยนแพ็กเกจได้โดยแอดมินเท่านั้น (ร้านกดเลือกแพ็กเกจ → ส่งอีเมลหาทีม ProfitBloom)
- ยังไม่มีระบบรับชำระเงิน และหมดช่วงทดลองแล้ว**ยังใช้งานต่อได้** (มีแค่แถบเตือน)

## ผู้ดูแลระบบ (ทีม ProfitBloom)

บัญชีจะเป็นแอดมินได้ด้วยคำสั่งบน server เท่านั้น (สมัครผ่านหน้าเว็บก่อน แล้วรัน):

```bash
npm run make-admin -- admin@profitbloom.co.th
```

ถอนสิทธิ์: `npm run make-admin -- admin@profitbloom.co.th --remove`

แอดมินจะเห็นเมนู "ผู้ดูแลระบบ" — ดูร้านทั้งหมด จำนวนโปรเจ็กต์/ใบเสนอราคา การใช้งานล่าสุด เปลี่ยนแพ็กเกจ และระงับ/เปิดใช้งานร้าน
(ร้านที่ถูกระงับจะถูกออกจากระบบทันทีและ login ไม่ได้ ข้อมูลยังอยู่ครบ)

## ทดสอบ

```bash
npm test
```

รัน unit test ของระบบคำนวณ (เทียบกับตัวอย่างใน Product Vision) แล้วตามด้วยการทดสอบ API ทั้งหมด (สมัคร/login, แยกข้อมูลระหว่างร้าน, โปรเจ็กต์, ใบเสนอราคา, ตัวเลข Dashboard/Reports, ตั้งค่าบัญชี, แอดมิน, จำกัดการเดารหัส) บนฐานข้อมูลชั่วคราว (สร้างและลบให้เองบน PostgreSQL ในเครื่อง หรือที่ `TEST_DATABASE_URL`) ไม่กระทบข้อมูลจริง

## ขึ้นใช้งานจริง (production)

### Vercel + Supabase (สิงคโปร์)

- หน้าเว็บ build ด้วย `vite build` → `dist/`, API ทั้งหมดวิ่งผ่าน serverless function `api/index.js` ที่ region `sin1` (ดู `vercel.json`)
- ฐานข้อมูลอยู่บน Supabase region Southeast Asia (Singapore) — ตั้งค่า Environment Variables ใน Vercel:

| ตัวแปร | ความหมาย |
| --- | --- |
| `DATABASE_URL` | connection string แบบ **Transaction pooler** (พอร์ต 6543) จาก Supabase → Connect |
| `DATABASE_CA_CERT` | (แนะนำ) ใบรับรองจาก Supabase → Database → SSL Configuration เพื่อให้ตรวจสอบตัวตนของเซิร์ฟเวอร์ฐานข้อมูล |

ตารางถูกสร้างและอัปเดตให้อัตโนมัติตอนเรียก API ครั้งแรก (ดู `MIGRATIONS` ใน `server/db.js`) ทุกตารางเปิด Row Level Security ไว้ เพื่อไม่ให้เข้าถึงผ่าน REST API ของ Supabase ได้
ตั้งแอดมินบนฐานข้อมูลจริง: `DATABASE_URL=... npm run make-admin -- อีเมล`

### ย้ายข้อมูลจากระบบเดิม (Turso / SQLite)

```bash
# ต้นทาง: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (หรือ SQLITE_FILE=ไฟล์.db)   ปลายทาง: DATABASE_URL
npm run migrate-data -- --dry-run   # ดูจำนวนแถวก่อน ยังไม่เขียน
npm run migrate-data                # ย้ายจริง (หยุดถ้าปลายทางมีข้อมูลแล้ว)
```

ย้ายทั้งหมดในครั้งเดียว ถ้าพลาดกลางทางจะไม่มีอะไรถูกเขียน และตรวจจำนวนแถวกับยอดเงินให้ก่อนยืนยัน บัญชี รหัสผ่าน และการ login ค้างไว้ของร้านใช้ต่อได้เลย

### เซิร์ฟเวอร์ทั่วไป

```bash
npm install
npm run build
npm start
```

เซิร์ฟเวอร์ตัวเดียวให้บริการทั้งหน้าเว็บและ API ที่พอร์ตจาก `PORT` — กำหนด `DATABASE_URL` ชี้ไปที่ PostgreSQL ที่ใช้

ต้องเปิดผ่าน **HTTPS** เพราะ cookie ตั้งค่า `Secure` ในโหมด production

## โครงสร้าง

```
server/
  db.js          เชื่อมฐานข้อมูล PostgreSQL + ตาราง (MIGRATIONS)
  app.js         API ทั้งหมด (Express)
  index.js       รันแบบเซิร์ฟเวอร์ปกติ + เสิร์ฟไฟล์ใน dist/
api/index.js     ทางเข้าของ Vercel
  make-admin.js  ตั้ง/ถอนสิทธิ์ผู้ดูแลระบบ
  migrate-from-sqlite.js  ย้ายข้อมูลจากระบบเดิม (ใช้ครั้งเดียว)
tests/           การทดสอบ API (npm test)
src/
  lib/api.ts   ฟังก์ชันเรียก API และ type ที่ใช้ร่วมกัน
  App.tsx      หน้าหลัก, Dashboard, การนำทาง
  lib/pdf.ts   สร้างไฟล์ PDF ใบเสนอราคา
  landing/     หน้าเว็บหลัก (LandingPage.tsx) + เนื้อหาที่แก้ได้ (content.ts)
  components/  หน้าต่าง ๆ (Projects, NewProject, QuickCheck, job/, NewQuote, AllQuotes, QuoteDocument, Reports, Packages, AdminPage, AccountSettings, AuthScreen)
```

## ระบบช่วยตัดสินใจก่อนรับงาน (ตาม Product Vision)

ทุกตัวเลขมาจาก `src/lib/decision.ts` ที่เดียว (กติกาธุรกิจ + การคำนวณ ไม่ใช้ AI) และมี unit test เทียบกับตัวอย่างใน Product Vision ทุกสไลด์

| ส่วน | อยู่ที่ |
| --- | --- |
| Can I Take This Job? (เช็คก่อนรับงาน) | เมนู "เช็คก่อนรับงาน" |
| Job Health Check (คะแนน 0–100) | งานแต่ละงาน ขั้นที่ 1 + หน้าหลัก + การ์ดโปรเจ็กต์ |
| Quote Health Check | ขึ้นทุกครั้งก่อนสร้างใบเสนอราคาจากงาน |
| Scenario Simulator | งานแต่ละงาน ขั้นที่ 3 |
| Estimated vs Actual | งานแต่ละงาน ขั้นที่ 4 + หน้ารายงาน |
| Post-Event Review + Learning Loop | งานแต่ละงาน ขั้นที่ 5 → เตือนเผื่อต้นทุนในงานถัดไป |
| กติกาธุรกิจ (Margin เสี่ยง/ขั้นต่ำ/ที่ดี, มัดจำ, ค่าแรง, ค่ารถ, เกณฑ์ Labor Overrun) | ตั้งค่า → กติกาธุรกิจ |

**Margin = กำไร ÷ ราคาขาย** (ไม่ใช่กำไร ÷ ต้นทุน ซึ่งคือ markup) — ฐานข้อมูลเก็บเป็น markup (`profit_margin`) แต่หน้าจอแสดงและรับค่าเป็น Margin

ยังไม่ได้ทำ (Phase 3 ตาม Roadmap): Industry Benchmark, Pattern ของงานขาดทุน, Bloom AI

## การคำนวณ

- **ราคาขายของโปรเจ็กต์** = ต้นทุนรวม × (1 + markup%) และ **Margin** = กำไร ÷ ราคาขาย
- **ยอดขาย/กำไรบน Dashboard และ Reports** นับเฉพาะโปรเจ็กต์ที่ "อนุมัติแล้ว" หรือ "เสร็จสิ้น" ตามเดือนของวันจัดงาน
- **อัตราความสำเร็จ** = (อนุมัติ + เสร็จสิ้น) ÷ (อนุมัติ + เสร็จสิ้น + ยกเลิก)
- **ใบเสนอราคาที่ผูกกับโปรเจ็กต์** จะเปลี่ยนสถานะโปรเจ็กต์ให้อัตโนมัติ: สร้าง → "สร้างใบเสนอราคาแล้ว", ส่ง → "รอการอนุมัติ", อนุมัติ → "อนุมัติแล้ว"
- **ใบเสนอราคา** ที่เลยวัน "ใช้ได้ถึง" และยังเป็นร่าง/ส่งแล้ว จะแสดงเป็น "หมดอายุ"
