# AIZEN Responder - Domain Model (CONTEXT)

ระบบ AI Auto-Responder และศูนย์รับส่งข้อความลูกค้าแบบ Multi-Channel สำหรับองค์กร (Organization) โดยแบ่งการทำงานตามทีม

---

## 1. Core Domain Concepts & Glossary

### Identity & Access (การระบุตัวตนและสิทธิ์)
- **Organization (องค์กร)**: ขอบเขตระดับบนสุดของระบบ ใช้ฐานข้อมูลร่วมกัน มีการตั้งค่าส่วนกลางและรายชื่อผู้ใช้ทั้งหมดในระบบ
- **User (ผู้ใช้งาน)**: บัญชีผู้ใช้ในระบบ เข้าใช้งานด้วย username/password (scrypt hash + session token)
- **Role (บทบาทระบบ)**:
  - `admin`: ผู้ดูแลระบบ มีสิทธิ์จัดการ User, การสร้างและตั้งค่า Team, จัดการ Channel และดูภาพรวมทั้งองค์กร
  - `staff`: เจ้าหน้าที่ผู้ปฏิบัติงาน มีสิทธิ์เข้าถึงเฉพาะข้อมูลและห้องสนทนาของ Team ที่ตนเองเป็นสมาชิก
- **Team (ทีม)**: กลุ่มการทำงานย่อยภายใน Organization (เช่น ทีมขาย, ทีมบริการลูกค้า)
- **Team Membership (การสังกัดทีม)**: ความสัมพันธ์ระหว่าง User กับ Team โดย User 1 คนสามารถสังกัดได้หลายทีม (`User 1..* Team`)

### Communication & Routing (การสื่อสารและช่องทาง)
- **Channel (ช่องทางสื่อสาร)**: ช่องทางเชื่อมต่อภายนอก เช่น LINE Official Account หรือ Gmail (SMTP)
  - ผูกขาดกับระดับ **Team** (`Channel *..1 Team`)
  - แต่ละทีมมี Channel การสื่อสารเป็นของตนเอง
- **Conversation (บทสนทนา / ห้องแชท)**: ลำดับข้อความระหว่างลูกค้าภายนอก (Customer) กับระบบผ่าน Channel ใด Channel หนึ่ง
- **Customer (ลูกค้า)**: บุคคลภายนอกที่ส่งข้อความเข้ามา (เช่น LINE User ID หรือ Email Address)
- **Message (ข้อความ)**: ข้อความสื่อสารเดี่ยวที่ส่งเข้าหรือออกจาก Conversation

### Ownership & Workflow (การมอบหมายและการรับผิดชอบ)
- **Assignment (การมอบหมาย)**:
  - สถานะการรับผิดชอบ Conversation
  - **Unassigned (ยังไม่ระบุ)**: ห้องแชทที่ยังไม่มีเจ้าหน้าที่รับผิดชอบ สมาชิกทุกคนในทีมเห็นได้
  - **Claimed / Assigned (รับมอบหมายแล้ว)**: สถานะที่มี Staff คนใดคนหนึ่งกด "Claim" หรือถูกระบุตัวผู้รับผิดชอบ
  - **Ownership Restriction**: เฉพาะ Staff ผู้เป็นเจ้าของ (Assigned Staff) หรือ `admin` เท่านั้นที่มีสิทธิ์พิมพ์ส่งข้อความหรืออนุมัติข้อความใน Conversation นั้น

### Intelligence (ระบบปัญญาประดิษฐ์)
- **AI Auto-Responder / Copilot**: ระบบช่วยสร้างคำตอบอัตโนมัติ (Google Gemini หรือ OpenAI) โดยอิงจาก Knowledge Base ของระบบ
- **AI Lifecycle Policy**:
  - **Active Window**: AI จะทำงาน (ตอบอัตโนมัติ หรือ ร่างข้อความ Draft) ตราบใดที่ Conversation อยู่ในสถานะ **Unassigned**
  - **Handoff (Pause)**: ทันทีที่มี Staff ทำการ Claim ห้องแชท AI จะหยุดตอบและหยุดร่างข้อความอัตโนมัติทันที เพื่อส่งมอบการสนทนาให้มนุษย์ดูแลอย่างต่อเนื่อง
  - **Release / Reopen**: เมื่อ Staff ปลดการ Claim หรือส่งกลับเข้าคิวส่วนกลาง AI จะกลับมาทำหน้าที่ตามนโยบายเดิม

---

## 2. Invariants & Business Rules (กฎทางธุรกิจที่ไม่สามารถละเมิดได้)

1. **Strict Ownership on Sending**: Staff ไม่สามารถส่งข้อความใน Conversation ที่ถูก Claim โดย Staff คนอื่นได้
2. **Channel Isolation**: ข้อความและ Conversation จะมองเห็นได้เฉพาะสมาชิกของ Team ที่เป็นเจ้าของ Channel นั้นเท่านั้น
3. **AI Handoff Invariant**: ห้าม AI ตอบข้อความอัตโนมัติใน Conversation ที่มีสถานะ Claimed/Assigned
4. **Admin Escalation**: สิทธิ์ `admin` สามารถดูได้ทุกทีม และสามารถ Overwrite / Reassign ข้อความในทุก Conversation ได้เสมอ
