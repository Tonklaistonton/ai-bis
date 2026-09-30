/**
 * AIZEN RESPONDER - AI Natural Language Processing Engine & Knowledge Base
 * Provides intelligent, context-aware Thai & English responses for LINE OA & Gmail
 */

const AIEngine = {
  // Active Knowledge Base
  knowledge: {
    shopName: "AIZEN Store & Fashion",
    openingHours: "เปิดทุกวัน 09:00 - 21:00 น. (ระบบ AI ตอบแชท 24 ชม.)",
    contactInfo: "โทร 02-999-9999, อีเมล support@aizenstore.com",
    products: [
      {
        name: "Orange Puffer Jacket (เสื้อกันหนาวพองสีส้มพรีเมียม)",
        price: "$149 (ปกติ $199)",
        sizes: ["36", "38", "40"],
        colors: ["ส้มพรีเมียม (Warm Orange)", "ดำเงา (Glossy Black)"],
        highlight: "กันหนาว อุ่นเบาสบาย กันละอองน้ำ ดีไซน์โดดเด่นสะกดทุกสายตา"
      },
      {
        name: "Black Urban Puffer Jacket",
        price: "$149",
        sizes: ["36", "38", "40"],
        colors: ["ดำมินิมอล"],
        highlight: "สไตล์เรียบหรู แมทช์ได้ทุกชุด"
      }
    ],
    promotions: "ซื้อชิ้นใดก็ได้ ส่งฟรีด่วน Flash/EMS ทั่วประเทศ! ใส่โค้ด AIZEN10 ลดเพิ่ม 10% ทันทีครับ",
    payment: "ธนาคารกสิกรไทย 123-4-56789-0 บจก. ไอเซน, บัตรเครดิต, และมีบริการเก็บเงินปลายทาง (COD +30 บาท)",
    delivery: "กรุงเทพฯ และปริมณฑล 1-2 วันทำการ, ต่างจังหวัด 2-3 วันทำการ, รับเปลี่ยนไซส์ฟรีภายใน 7 วัน",
    persona: "สุภาพ เป็นมิตร อบอุ่น มีหางเสียง ช่วยปิดการขายและให้ข้อมูลอย่างครบถ้วน"
  },

  updateKnowledge(newKb) {
    this.knowledge = { ...this.knowledge, ...newKb };
  },

  /**
   * Generate an intelligent reply for LINE OA customer messages
   * @param {string} userMessage 
   * @returns {string}
   */
  generateLineReply(userMessage) {
    const text = userMessage.toLowerCase().trim();
    const kb = this.knowledge;

    // 1. ถามเรื่องคำถาม FAQ หรือ ข้อมูลทั่วไป
    if (kb.faq && typeof kb.faq === 'string') {
      const faqList = kb.faq.split('\n\n');
      for (const faqBlock of faqList) {
        const lines = faqBlock.split('\n');
        if (lines.length >= 2) {
          const qLine = lines[0].toLowerCase();
          const cleanKw = qLine.replace(/^q\d*:\s*/i, '').trim();
          if (cleanKw && text.includes(cleanKw)) {
            return `💡 ข้อมูลตอบคำถาม:\n\n${lines.slice(1).join('\n')}\n\nหากต้องการสอบถามเพิ่มเติม ทักแอดมินได้ตลอด 24 ชม. เลยนะครับ 😊`;
          }
        }
      }
    }

    // 2. ถามเรื่องเวลาเปิดปิด / ที่ตั้งร้าน / ติดต่อ
    if (text.includes("เปิด") || text.includes("กี่โมง") || text.includes("เวลา") || text.includes("ปิด") || text.includes("ที่อยู่") || text.includes("ตั้งอยู่")) {
      return `สวัสดีครับ 😊 ทาง ${kb.shopName} ${kb.openingHours} ครับ สำหรับสาขาหน้าร้านและฝ่ายบริการลูกค้าติดต่อได้ที่ ${kb.contactInfo} เลยครับ มีอะไรให้แอดมินหรือ AI ช่วยแนะนำเพิ่มเติมไหมครับ?`;
    }

    // 3. ถามเรื่องโปรโมชั่น / ส่วนลด / ส่งฟรี
    if (text.includes("โปร") || text.includes("ลด") || text.includes("แถม") || text.includes("ส่งฟรี") || text.includes("discount") || text.includes("code")) {
      return `🎉 ตอนนี้เรามีโปรโมชั่นสุดคุ้มเลยครับ!\n\n✨ ${kb.promotions}\n\nเพียงแจ้งไซส์หรือสินค้าที่สนใจ แอดมิน AI ช่วยสรุปยอดและใช้โค้ดลดให้ทันทีเลยครับผม! 🎁`;
    }

    // 4. ถามเรื่องสินค้า / มีอะไรบ้าง / มีของ / เสื้อ / กระเป๋า / ไซส์ / ราคา / สี
    const isProdInquiry = text.includes("มีอะไร") || text.includes("มีของ") || text.includes("ของ") || 
                          text.includes("สินค้า") || text.includes("ขาย") || text.includes("ราคา") || 
                          text.includes("ไซส์") || text.includes("สี") || text.includes("เสื้อ") || 
                          text.includes("กระเป๋า") || text.includes("เคส") || text.includes("สายชาร์จ");

    if (isProdInquiry) {
      if (typeof kb.products === 'string' && kb.products.trim()) {
        return `🧥 รายการสินค้าพร้อมส่งจากทางร้าน ${kb.shopName} ครับ:\n\n${kb.products}\n\n🎉 ${kb.promotions || 'ส่งฟรีทั่วประเทศ!'}\nลูกค้าสนใจรับเป็นชิ้นไหน แจ้งแอดมินหรือส่งรูปมาได้เลยนะครับผม! 😊`;
      }
      if (Array.isArray(kb.products) && kb.products.length > 0) {
        const p1 = kb.products[0];
        return `🧥 สำหรับ ${p1.name} รุ่นยอดฮิต:\n\n🔥 ราคาพิเศษ: ${p1.price}\n📏 ไซส์พร้อมส่ง: ${p1.sizes?.join(", ") || '-'}\n🎨 โทนสี: ${p1.colors?.join(", ") || '-'}\n⭐ จุดเด่น: ${p1.highlight || '-'}\n\nรับเป็นไซส์ไหนดีครับ? วันนี้จัดส่งฟรีทั่วประเทศเลยครับ! 📦`;
      }
    }

    // 5. ถามเรื่องขั้นตอนสั่งซื้อ / วิธีสั่ง / สั่งยังไง
    if (text.includes("สั่ง") || text.includes("ซื้อ") || text.includes("ขั้นตอน")) {
      if (kb.payment) {
        return `🛍️ ขั้นตอนและวิธีการสั่งซื้อสินค้า (${kb.shopName}):\n\n${kb.payment}\n\nลูกค้าสนใจรับสินค้าชิ้นไหน แจ้งรายการหรือสี/ไซส์ได้เลยนะครับ แอดมินพร้อมดูแลครับ! 🙏`;
      }
    }

    // 4. ถามเรื่องเลขบัญชี / โอนเงิน / ชำระเงิน / สลิป
    if (text.includes("บัญชี") || text.includes("โอน") || text.includes("จ่าย") || text.includes("ชำระ") || text.includes("สลิป") || text.includes("ธนาคาร")) {
      return `💳 ขอบพระคุณมากครับ ช่องทางชำระเงินของทางร้าน:\n\n🏦 ${kb.payment}\n\nเมื่อโอนเรียบร้อยแล้ว สามารถส่งสลิปหลักฐานพร้อมแจ้งชื่อ ที่อยู่ และเบอร์โทรศัพท์ในช่องแชทนี้ได้เลยครับ ระบบจะทำการบันทึกและจัดส่งให้ทันทีครับ 🙏`;
    }

    // 5. ถามเรื่องเก็บเงินปลายทาง (COD)
    if (text.includes("ปลายทาง") || text.includes("cod")) {
      return `🚚 ทางร้านมีบริการเก็บเงินปลายทาง (COD) ครับผม! ค่าบริการเพิ่มเติมเพียง 30 บาท ลูกค้าสามารถแจ้งสินค้าที่ต้องการ ไซส์ และที่อยู่สำหรับจัดส่งให้ทางเราเปิดออเดอร์ให้ได้เลยครับ`;
    }

    // 6. ถามเรื่องจัดส่ง / ขนส่ง / กี่วันถึง / เปลี่ยนไซส์
    if (text.includes("ส่ง") || text.includes("ขนส่ง") || text.includes("กี่วัน") || text.includes("เปลี่ยนไซส์") || text.includes("พัสดุ")) {
      return `📦 ข้อมูลการจัดส่งครับ:\n\n🚀 ${kb.delivery}\n\nหากได้รับสินค้าแล้วลองใส่ไม่พอดี ทางเราดูแลเปลี่ยนไซส์ให้ฟรีภายใน 7 วัน สบายใจได้เลยครับผม 😊`;
    }

    // 7. คำทักทายทั่วไป (สวัสดี, ดีครับ, สนใจ)
    if (text.includes("สวัสดี") || text.includes("ดีครับ") || text.includes("ดีค่ะ") || text.includes("hello") || text.includes("hi")) {
      return `สวัสดีครับ ยินดีต้อนรับสู่ ${kb.shopName} ครับผม! 🎉 วันนี้มีโปรพิเศษลด 10% พร้อมส่งฟรีทุกออเดอร์ ลูกค้าสนใจดูสินค้าตัวไหนเป็นพิเศษหรือให้แนะนำไซส์ สอบถามได้ตลอดเลยนะครับ 😊`;
    }

    // Default Fallback: Friendly AI answer
    return `ขอบคุณสำหรับคำถามครับ 😊 เกี่ยวกับ "${userMessage}" ทางเราบันทึกข้อมูลไว้เรียบร้อยครับ สินค้าทั้งหมดของ ${kb.shopName} มีการรับประกันความพึงพอใจและมีรอบจัดส่งทุกวัน\n\nหากต้องการสอบถามเพิ่มเติมหรือสั่งซื้อ สามารถแจ้งรายการและไซส์ที่ต้องการได้เลยนะครับผม! 🙏✨`;
  },

  /**
   * Generate an intelligent Gmail response based on email content and tone
   * @param {Object} email 
   * @param {string} tone - 'formal' | 'friendly' | 'english'
   * @returns {string}
   */
  generateGmailReply(email, tone = "formal") {
    const kb = this.knowledge;
    const clientName = email.senderName || "ท่านผู้ติดต่อ";

    if (tone === "english") {
      return `Dear ${clientName},

Thank you for reaching out to ${kb.shopName}. We appreciate your interest in our products and services regarding "${email.subject}".

Regarding your inquiry:
- All requested items, including our flagship Puffer Jacket collection, are currently in stock with certified quality guarantee.
- Current Offer: Complimentary express nationwide delivery and an exclusive 10% introductory discount (Use code: AIZEN10).
- Payment Methods: Wire transfer, Corporate Invoice, Credit Card, or Cash on Delivery.

Please feel free to reply directly to this email if you need official quotation documents or tailored assistance. Our team is standing by to ensure your complete satisfaction.

Warm regards,

Customer Relations & AI Support Team
${kb.shopName}
Contact: ${kb.contactInfo}
Website: https://aizen-responder.app`;
    }

    if (tone === "friendly") {
      return `สวัสดีครับคุณ ${clientName} 😊

ขอบคุณมากๆ เลยนะครับที่ติดต่อเข้ามาทาง ${kb.shopName} เกี่ยวกับเรื่อง "${email.subject}" ครับ

ทางเราได้ตรวจสอบข้อมูลที่สอบถามเข้ามาเรียบร้อยแล้วครับ:
✨ สินค้าและบริการพร้อมดูแลทันที มีสต็อกพร้อมส่งทุกรายการ
🎁 พิเศษตอนนี้มีโปรโมชั่นส่งฟรีด่วนทั่วประเทศ พร้อมโค้ดลดพิเศษ 10% (โค้ด: AIZEN10)
💳 ช่องทางชำระเงินสะดวกสบาย: โอนผ่านธนาคาร, บัตรเครดิต หรือเก็บเงินปลายทาง (COD)

หากคุณ ${clientName} ต้องการให้ออกใบเสนอราคาหรือมีคำถามเพิ่มเติม ตอบกลับเมลนี้ได้เลยนะครับ ทางเรายินดีบริการเต็มที่ครับผม!

ด้วยความยินดีอย่างยิ่ง,
ทีมงานบริการลูกค้า ${kb.shopName}
โทร: ${kb.contactInfo}`;
    }

    // Default: Formal Business Thai
    return `เรียน คุณ${clientName} ที่นับถือ,

ในนามของ ${kb.shopName} ขอขอบพระคุณเป็นอย่างยิ่งที่ท่านได้ให้ความสนใจและติดต่อสอบถามเข้ามาในหัวข้อเรื่อง "${email.subject}"

สืบเนื่องจากรายละเอียดที่ท่านได้สอบถาม ทางบริษัทฯ ขอเรียนแจ้งข้อมูลดังนี้:
1. การให้บริการและสต็อกสินค้า: สินค้าของบริษัทฯ เป็นไปตามมาตรฐานพรีเมียม มีความพร้อมในการจัดส่งตามกำหนดเวลา
2. สิทธิประโยชน์และโปรโมชั่น: ${kb.promotions}
3. ระยะเวลาการดำเนินงานและการจัดส่ง: ${kb.delivery}

หากท่านประสงค์ให้ทางบริษัทฯ จัดส่งเอกสารใบเสนอราคาอย่างเป็นทางการ (Quotation) หรือต้องการข้อมูลทางเทคนิคเพิ่มเติม กรุณาแจ้งตอบกลับอีเมลนี้ ทางเจ้าหน้าที่จะประสานงานส่งมอบเอกสารให้ท่านโดยเร็วที่สุด

ขอแสดงความนับถือ,

ฝ่ายบริการลูกค้าสัมพันธ์และระบบ AI
${kb.shopName}
ช่องทางติดต่อ: ${kb.contactInfo}`;
  }
};

window.AIEngine = AIEngine;
