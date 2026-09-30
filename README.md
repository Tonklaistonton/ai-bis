# AIZEN Responder

ระบบ AI Auto-Responder อัตโนมัติสำหรับ LINE Official Account และ Gmail พร้อมเชื่อมต่อ Airtable & Google Sheets

---

## 🚀 คุณสมบัติเด่น (Features)
- 🤖 **AI Auto-Responder**: รองรับ Google Gemini API & OpenAI ChatGPT
- 💬 **LINE Messaging API**: เชื่อมต่อ Webhook รับ-ส่งข้อความ และตอบกลับลูกค้าอัตโนมัติ
- ✉️ **Gmail Automation**: รองรับการตรวจสอบและร่างอีเมลตอบกลับ
- 📊 **Dynamic Knowledge Base**: เชื่อมฐานข้อมูลสินค้าและ FAQ จาก Airtable & Google Sheets
- 🌐 **Realtime Dashboard**: ติดตามการทำงาน, สถานะแชท และตั้งค่าผ่าน Web UI

---

## 🛠️ การติดตั้งและใช้งาน (Installation)

### 1. ติดตั้ง Dependencies
```bash
npm install
```

### 2. เตรียมไฟล์ข้อมูล (Database / Configuration)
คัดลอกไฟล์ตัวอย่าง `database.example.json`:
```bash
# Windows
copy data\database.example.json data\database.json

# Linux / macOS
cp data/database.example.json data/database.json
```
> กรอก LINE Channel Secret, Access Token, API Key ในระบบผ่าน Dashboard หรือแก้ไขใน `data/database.json`

### 3. เริ่มรันระบบ (Run Server)
```bash
npm start
# หรือรันผ่านไฟล์ start.bat
```
เปิดบราวเซอร์ที่: `http://localhost:3000`

---

## 🔒 ความปลอดภัย (Security Note)
- ไฟล์ `data/database.json` ถูกตั้งค่าใน `.gitignore` เพื่อป้องกันไม่ให้ข้อมูล Credentials/API Key รั่วไหล
