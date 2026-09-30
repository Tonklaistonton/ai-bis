# AIZEN Responder

ระบบ AI Auto-Responder สำหรับ LINE Official Account และ Gmail (SMTP) พร้อมเชื่อมต่อ Airtable & Google Sheets

**สถาปัตยกรรม**: UI เป็น **Next.js + React** (เส้นทาง `/line`, `/email`, `/knowledge`, `/settings`)
รันบน Express custom server เดิม port เดียว — `/api/*`, LINE webhook, WebSocket `/ws` และ SMTP ยังเป็นของ Express
ฐานข้อมูลเป็น **SQLite** ผ่าน `node:sqlite` (มากับ Node ตั้งแต่รุ่น 22 — ไม่ต้องติดตั้งแพ็กเกจเพิ่ม ไม่มีค่าใช้จ่าย)

---

## 🚀 คุณสมบัติเด่น (Features)
- 💬 **แชท LINE**: รายชื่อลูกค้า + ห้องสนทนา, โหมดตอบอัตโนมัติ / ช่วยร่าง (Copilot รออนุมัติ), ร่างแยกตามห้อง
- ✉️ **ส่งอีเมล**: ฟอร์มผู้รับ/หัวข้อ/เนื้อหา ส่งผ่าน Gmail SMTP พร้อมประวัติการส่ง (ระบบ**ไม่มี**การดึงอีเมลเข้า/IMAP)
- 🤖 **AI สำหรับตอบแชท**: Google Gemini หรือ OpenAI หรือ NLP ในตัว (ยังไม่เปลี่ยน provider/model)
- 📊 **ข้อมูลร้าน**: Knowledge Base + ซิงก์ Airtable & Google Sheets + สคริปต์ Apps Script
- 🌐 **Realtime**: WebSocket ที่ `/ws` แจ้งเตือนข้อความใหม่ แล้วให้ UI โหลดประวัติผ่าน HTTP ใหม่
- 🔐 **บัญชีผู้ใช้**: username/password ที่เซิร์ฟเวอร์ตรวจสอบ, เก็บรหัสผ่านแบบ scrypt, session ผ่าน httpOnly cookie, แยกสิทธิ์ admin/staff

---

## 🛠️ การติดตั้งและใช้งาน (Installation)

### ข้อกำหนด
- **Node.js 22 ขึ้นไป** (ต้องใช้ 22+ เพราะระบบใช้ `node:sqlite`) ทดสอบกับ Node 25
- npm

### 1. ติดตั้ง Dependencies
```bash
npm install
```

### 2. เริ่มระบบ
```bash
# พัฒนา (Next dev + HMR)
npm run dev

# Production: build แล้วรัน
npm run build
npm start

# รัน test (node:test)
npm test
```
เปิดบราวเซอร์ที่ `http://localhost:3000` — **ครั้งแรกระบบจะพาไปหน้า "ตั้งค่าครั้งแรก"** ให้กรอกชื่อร้าน/องค์กรและสร้างบัญชีผู้ดูแลระบบ
หลังจากนั้นทุกครั้งต้องเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน

> หน้า `POST /api/auth/setup` ใช้ได้**ครั้งเดียวเท่านั้น** — เมื่อมีบัญชีแล้วจะปิดถาวร ป้องกันการมีใครมาทะเบียนแอดมินทับ

### 3. โหมดทดสอบ/สาธิต (ไม่แตะข้อมูลจริง)
```bash
node preview.js
```
ใช้ฐานข้อมูลแยก `data/preview.db` โหลดจาก `tests/fixtures/` พร้อม credential ว่างเปล่า
บัญชีสาธิต: **demo / demo1234**

---

## 🔐 ความปลอดภัย

**ที่ระบบทำให้แล้ว**
- ทุก `/api/*` ต้องเข้าสู่ระบบด้วย session cookie ก่อน (ยกเว้น webhook ที่ตรวจลายเซ็นแทน)
- รหัสผ่านเก็บเป็น **scrypt hash** ไม่ใช่ข้อความธรรมดา
- แยกสิทธิ์จริง: เฉพาะ `admin` เท่านั้นที่แก้การตั้งค่า, credential, และจัดการสมาชิกได้
- **API key / token ไม่เคยถูกส่งกลับเบราว์เซอร์** — `/api/config` คืนค่าเป็น mask (เช่น `<set>abcd`) และเซิร์ฟเวอร์ข้ามฟิลด์ที่ส่งกลับมาเป็น mask
- WebSocket `/ws` ปฏิเสธการเชื่อมต่อที่ไม่มี session (ปิดด้วย code 4401)
- **LINE webhook บังคับตรวจ HMAC signature** — ไม่มี Channel Secret หรือไม่มี signature จะปฏิเสธ ไม่ใช่รับเงียบ ๆ
- เปิด static ทั้งโฟลเดอร์แล้วให้ Next.js เสิร์ฟ UI — **ไม่มีการเปิดไฟล์** `data/`, `lib/`, `server.js` หรือ dotfiles ผ่าน HTTP
- `data/aizen.db`, `data/database.json`, `.env` ถูก ignore ใน git

**ยังคงต้องระวัง**
- ระบบรันบน Node server แบบ self-hosted เท่านั้น ไม่ใช่ static export / deploy แบบ Vercel
- **ยังไม่มี HTTPS ในตัว** — ถ้าเปิดให้เข้าถึงจากอินเทอร์เน็ต ต้องใช้ tunnel (Cloudflare/ngrok) ซึ่งจะเพิ่ม `Secure` ให้ cookie อัตโนมัติ
- ยังไม่มี rate limiting, audit log, 2FA และการสำรองข้อมูลอัตโนมัติ
- `start.bat` จะถามก่อนเปิด tunnel (ค่าเริ่มต้นคือไม่เปิด) — เพราะเปิด tunnel = เปิดข้อมูลร้านและแชทออกสู่สาธารณะ

**เก็บ secret นอกฐานข้อมูลได้** — สร้างไฟล์ `.env` ที่รากโปรเจกต์ (ไฟล์นี้ถูก git ignore):
```
LINE_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
AIRTABLE_API_KEY=...
GMAIL_APP_PASSWORD=...
```
ค่าใน `.env` จะถูกใช้แทนค่าในฐานข้อมูล (ตัวแปรแวดล้อมอื่นที่กำหนดไว้ก่อนจะมีผลก่อนเสมอ)

---

## 📁 โครงสร้างข้อมูล

| เก็บอะไร | อยู่ที่ไหน | ใครแก้ |
|---|---|---|
| บัญชีผู้ใช้ + session | `data/aizen.db` | ระบบ |
| ค่าตั้งค่า + credential | `data/aizen.db` (หรือ `.env`) | ผู้ดูแลระบบ |
| ประวัติแชท / อีเมลที่ส่ง | `data/aizen.db` (เก็บย้อนหลัง 200 รายการล่าสุด) | ระบบ |
| ข้อมูลสินค้า/FAQ | **Airtable หรือ Google Sheets** → sync เข้า SQLite เป็น cache | ทีมงานร้าน |

ฐานข้อมูลเป็นไฟล์เดียว — สำรองข้อมูลคือคัดลอกไฟล์ `data/aizen.db`

**การย้ายข้อมูลจากระบบรุ่นเก่า (JSON)**: ถ้ายังมี `data/database.json` อยู่ ระบบจะย้ายข้อมูลเข้า SQLite ให้อัตโนมัติเมื่อเปิดครั้งแรก แล้วเก็บไฟล์เดิมไว้เป็น `data/database.json.migrated.json`

## 📧 ข้อจำกัดของระบบอีเมล
- มีเฉพาะการ **ส่งออกผ่าน SMTP** (Gmail App Password) + บันทึกประวัติการส่ง
- ไม่มีการดึงอีเมลเข้า (ไม่มี IMAP/inbox sync) — หน้าส่งอีเมลจึงเป็น "เขียน + ประวัติที่ส่งแล้ว" ไม่ใช่กล่องขาเข้า