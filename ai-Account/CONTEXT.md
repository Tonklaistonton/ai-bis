# AIZEN Account - Domain Model (CONTEXT)

ระบบ AI บัญชีการเงินและการจัดการเอกสารอัตโนมัติ (AI Accounting & Expense Management)

---

## 1. Core Domain Concepts & Glossary

### Financial Entities (ข้อมูลทางการเงิน)
- **Transaction (รายการทางบัญชี)**: รายการเคลื่อนไหวทางการเงินรายรับหรือรายจ่าย
  - `type`: `income` (รายรับ) หรือ `expense` (รายจ่าย)
  - `status`: `pending` (รอตรวจสอบ), `verified` (ยืนยันแล้ว), `rejected` (ปฏิเสธ/เป็นโมฆะ)
  - `amount`: จำนวนเงินสุทธิ
  - `currency`: สกุลเงิน (ค่าเริ่มต้น THB)
- **Slip (สลิปโอนเงิน)**: หลักฐานการโอนเงินจากลูกค้าที่ส่งเข้ามาทางแชทหรืออัปโหลดโดยตรง
  - `sender_bank`: ธนาคารต้นทาง
  - `receiver_bank`: ธนาคารปลายทาง
  - `receiver_account`: เลขบัญชีปลายทาง
  - `transfer_time`: วันเวลาที่โอนเงิน
  - `reference_no`: เลขที่อ้างอิงธุรกรรม / Slip Hash ป้องกันสลิปซ้ำ
- **Invoice / Receipt (ใบแจ้งหนี้ / ใบเสร็จรับเงิน)**: เอกสารเรียกเก็บเงินหรือหลักฐานค่าใช้จ่าย
  - `vendor_name`: ชื่อคู่ค้า/ผู้ให้บริการ
  - `tax_id`: เลขประจำตัวผู้เสียภาษี
  - `vat_amount`: ภาษีมูลค่าเพิ่ม (7%)
  - `wht_amount`: ภาษีหัก ณ ที่จ่าย (ถ้ามี)
- **Account Category (หมวดหมู่บัญชี)**: หมวดหมู่เพื่อจัดสรรงบประมาณ (เช่น รายได้จากการขาย, ค่าโฆษณา, ค่าเช่า, เงินเดือน)

### Verification & Workflow (การตรวจสอบและกระบวนการ)
- **Vision Provider (ผู้ประมวลผลการอ่านภาพ)**: ตัวเลือกโมเดล/บริการที่สลับใช้งานได้
  - `gemini`: Google Gemini Vision
  - `openai`: OpenAI GPT-4o Vision
  - `slipok`: SlipOK / EasySlip API (เช็คธนาคารไทยแบบเรียลไทม์)
- **Human-in-the-loop (HIL)**:
  - สลิปหรือบิลที่ AI อ่านได้จะอยู่ในสถานะ `pending` พร้อมแสดงผลการสกัดข้อมูล
  - เจ้าหน้าที่/แอดมินต้องกด "Confirm" หรือแก้ไขยอดก่อนระบบบันทึกสถานะเป็น `verified` เข้าบัญชีจริง
- **Inbound Webhook**: จุดรับข้อมูล Event จาก `ai-chat` เมื่อลูกค้าส่งรูปสลิปเข้ามาในห้องแชท

---

## 2. Invariants & Business Rules (กฎทางธุรกิจ)
1. **Duplicate Prevention**: สลิปที่มี `reference_no` หรือรูปภาพที่มี hash ซ้ำกันในระบบ ต้องถูกปฏิเสธทันทีเพื่อป้องกันการใช้สลิปซ้ำ
2. **Immutable Confirmed Records**: รายการที่ผ่านการ `verified` แล้วไม่สามารถลบออกจากระบบได้ แต่ต้องใช้วิธี Void/Reversal เพื่อความถูกต้องทางบัญชี
3. **Provider Agnostic**: ระบบรองรับสลับ Vision Provider (Gemini / OpenAI / Thai Slip API) ผ่าน Configuration โดยไม่ต้องแก้โค้ด Business Logic
