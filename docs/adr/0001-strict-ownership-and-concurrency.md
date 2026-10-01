# 1. Strict Ownership and Concurrency Model for Multi-Channel Conversations

Date: 2026-10-01

## Status

Accepted

## Context

ระบบ AIZEN Responder รองรับการสื่อสารแบบ Multi-Channel (LINE Official Account และ Gmail/Email) ภายใต้โครงสร้าง Organization และ Team
ก่อนหน้านี้มีปัญหาความไม่สอดคล้องกันระหว่างข้อกำหนดทางธุรกิจ (Business Rules) กับ Implementation:
1. การตรวจสอบสิทธิ์การดูข้อความรวมที่ `/api/inbox/conversations` เปิดกว้างและไม่กรองตาม Team Membership
2. ช่องทาง Email (`/api/emails/send`) ส่งออกได้โดยไม่มีการตรวจสอบสิทธิ์ Channel หรือ Assignment ทำให้ไม่มีการควบคุมความรับผิดชอบ
3. ห้องแชทที่ยังเป็น `Unassigned` อนุญาตให้ Staff พิมพ์ตอบได้พร้อมกัน ซึ่งอาจก่อให้เกิดข้อความซ้ำซ้อนหรือทับซ้อนกับ AI
4. การกด Claim ห้องแชทมีช่องโหว่ Race condition (TOCTOU: Time-of-check to time-of-use) ในระดับ Database (SELECT แล้ว UPDATE)

## Decision

1. **Enforce Channel Isolation**: กำหนดให้ API เรียกดูและจัดการข้อความทั้งหมดต้องผ่าน Authenticated Session และกรองห้องสนทนาตาม Team ที่ผู้ใช้สังกัด (ยกเว้น `admin` ที่เห็นทั้งหมด)
2. **Claim-Before-Send Rule**: ใช้กฎเข้มงวดว่าข้อความขาออก (Outbound Message) จาก Staff จะต้องส่งได้ต่อเมื่อห้องนั้นมีสถานะ `Claimed` และผู้ส่งคือ `assigned_user_id` เท่านั้น (ห้ามส่งขณะห้องยัง `Unassigned`)
3. **Unify Conversation Model for Email**: นำ Email เข้ามาอยู่ใต้โมเดล `conversations` เช่นเดียวกับ LINE โดยผูกกับ Channel ของ Team และต้อง Claim ก่อนส่งตอบ
4. **Atomic Concurrency for Claiming**: การ Claim ห้องสนทนาจะต้องใช้ Conditional Atomic UPDATE ในระดับ SQLite เช่น:
   `UPDATE conversations SET assigned_user_id = ? WHERE id = ? AND (assigned_user_id IS NULL OR assigned_user_id = ?)`
   และตรวจสอบผลลัพธ์ว่าบันทึกสำเร็จจริง หากมีคน Claim ไปก่อนหน้าจะปฏิเสธด้วยสถานะ 409 Conflict ทันที

## Consequences

- ป้องกันมนุษย์แย่งกันตอบ หรือตอบซ้อนกับ AI ได้เด็ดขาด
- ป้องกัน Data Leakage ข้ามทีม ข้อมูลแชทและอีเมลถูกแยกสิทธิ์อย่างสมบูรณ์
- Staff จำเป็นต้องกด Claim รับงานก่อนเริ่มพิมพ์ส่งข้อความ
