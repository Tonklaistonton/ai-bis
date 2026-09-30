/**
 * AIZEN PRO - Gmail AI Inbox & Real SMTP Sender
 * Manages email threads, professional response drafting, tone switching, and real SMTP dispatch
 */

const GmailSimulator = {
  emails: [
    {
      id: "em-1",
      senderName: "กิตติพงษ์ วัฒนาการ",
      senderEmail: "kittipong.wat@enterprise-corp.th",
      subject: "ขอใบเสนอราคา Orange Puffer Jacket จำนวน 30 ตัว สำหรับยูนิฟอร์มบริษัท",
      preview: "เรียนฝ่ายขาย ทางบริษัทเรามีความสนใจสั่งซื้อเสื้อกันหนาว Puffer Jacket...",
      body: `เรียน ฝ่ายขายและบริการลูกค้า AIZEN Store,

ทางบริษัท เอ็นเตอร์ไพรส์ คอร์ปอเรชั่น จำกัด มีความประสงค์สั่งซื้อเสื้อกันหนาว Orange Puffer Jacket ไซส์ 38 และ 40 คละสี จำนวนรวม 30 ตัว เพื่อใช้เป็นของขวัญและยูนิฟอร์มสำหรับพนักงานในการเดินทางไปสัมมนาต่างประเทศช่วงปลายปีนี้

รบกวนขอทราบข้อมูลดังต่อไปนี้ครับ:
1. ใบเสนอราคาพร้อมเงื่อนไขส่วนลดสำหรับการสั่งซื้อแบบองค์กร (B2B Volume Discount)
2. ระยะเวลาการเตรียมสินค้าและการจัดส่งถึงสำนักงานใหญ่ที่อโศก กทม.
3. เครดิตเทอมและการวางบิลใบเสร็จ/ใบกำกับภาษี

หากมีแคตตาล็อกสินค้าเพิ่มเติม สามารถแนบมาพร้อมกับอีเมลตอบกลับนี้ได้เลยครับ

ขอแสดงความนับถือ,
กิตติพงษ์ วัฒนาการ
Procurement Manager, Enterprise Corp`,
      time: "10:25 น.",
      status: "pending",
      replied: false
    },
    {
      id: "em-2",
      senderName: "Sara Jenkins (Marketing Lead)",
      senderEmail: "sara.j@globalvibe.com",
      subject: "Collaboration & International Wholesale Inquiry for AIZEN Collection",
      preview: "Hello AIZEN Team, We love your modern jacket designs and would like to explore...",
      body: `Hello AIZEN Team,

My name is Sara Jenkins from Global Vibe Lifestyle. We came across your flagship orange puffer jackets and recent line showcase, and our team is thoroughly impressed by the modern aesthetics and clean craftsmanship.

We are interested in exploring a potential wholesale distribution partnership for our flagship retail boutique in Singapore and online storefront. 

Could you please share your international wholesale price tier, minimum order quantities (MOQ), and current export shipping turnaround?

Looking forward to hearing from you.

Best regards,
Sara Jenkins
Head of Brand Partnerships | Global Vibe`,
      time: "09:12 น.",
      status: "pending",
      replied: false
    },
    {
      id: "em-3",
      senderName: "พิมพิศา รุ่งเรือง",
      senderEmail: "pimpisa.r@gmail.com",
      subject: "สอบถามการขอเปลี่ยนไซส์เสื้อจากไซส์ 36 เป็น 38 ค่ะ (ออเดอร์ #AZ-8921)",
      preview: "สวัสดีค่ะ ได้รับเสื้อ Puffer Jacket เรียบร้อยแล้วค่ะ สวยมาก แต่ลองใส่แล้วรู้สึกแน่นไปนิด...",
      body: `สวัสดีค่ะทีมงาน AIZEN,

เมื่อวานนี้ได้รับพัสดุเสื้อ Orange Puffer Jacket เลขคำสั่งซื้อ #AZ-8921 เรียบร้อยแล้วค่ะ เนื้อผ้าและสีสันสวยตรงปกมากๆ ประทับใจมากค่ะ

แต่พอลองสวมทับเสื้อหนาวตัวใน รู้สึกว่าไซส์ 36 จะแน่นช่วงไหล่ไปนิดนึง เลยอยากสอบถามว่าสามารถส่งกลับไปเปลี่ยนเป็นไซส์ 38 ได้ไหมคะ? มีขั้นตอนอย่างไรบ้าง และต้องส่งกลับไปที่อยู่ไหนคะ

ขอบคุณมากค่ะ
พิมพิศา`,
      time: "เมื่อวาน",
      status: "replied",
      replied: true
    }
  ],

  activeEmailId: "em-1",

  init() {
    this.renderEmailList();
    this.loadEmail("em-1");

    // Search filter
    const searchInput = document.getElementById("gmailSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.filterEmails(e.target.value);
      });
    }

    // Tone select change
    const toneSelect = document.getElementById("emailToneSelect");
    if (toneSelect) {
      toneSelect.addEventListener("change", () => {
        this.generateDraftForActive();
      });
    }

    // Regenerate button
    const regenBtn = document.getElementById("regenerateDraftBtn");
    if (regenBtn) {
      regenBtn.addEventListener("click", () => {
        this.generateDraftForActive();
        window.App?.showToast("↻ AI ร่างเนื้อหาอีเมลใหม่เรียบร้อยแล้ว");
      });
    }

    // Copy draft
    const copyBtn = document.getElementById("copyDraftBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const textarea = document.getElementById("aiDraftContent");
        if (textarea && textarea.value) {
          navigator.clipboard.writeText(textarea.value);
          window.App?.showToast("✓ คัดลอกข้อความร่างไปยังคลิปบอร์ดแล้ว");
        }
      });
    }

    // Send email button (SMTP)
    const sendBtn = document.getElementById("sendEmailReplyBtn");
    if (sendBtn) {
      sendBtn.addEventListener("click", () => this.handleSendEmail());
    }

    // Simulate new incoming email
    const simNewEmailBtn = document.getElementById("newEmailSimBtn");
    if (simNewEmailBtn) {
      simNewEmailBtn.addEventListener("click", () => this.simulateIncomingEmail());
    }
  },

  renderEmailList() {
    const container = document.getElementById("emailListContainer");
    if (!container) return;

    container.innerHTML = "";
    this.emails.forEach((email) => {
      const card = document.createElement("div");
      card.className = `thread-item ${email.id === this.activeEmailId ? "active" : ""}`;
      card.setAttribute("data-id", email.id);

      card.innerHTML = `
        <div class="thread-header-row">
          <span class="thread-sender-name">${email.senderName}</span>
          <span class="thread-time">${email.time}</span>
        </div>
        <div class="thread-subject">${email.subject}</div>
        <div class="thread-preview">${email.preview}</div>
        ${email.replied ? '<span class="status-chip-email" style="margin-top:6px; display:inline-block; font-size:0.65rem; background:rgba(16, 185, 129, 0.2); color:#10b981; border-color:rgba(16, 185, 129, 0.3);">✓ ตอบแล้ว</span>' : ""}
      `;

      card.addEventListener("click", () => {
        this.loadEmail(email.id);
      });

      container.appendChild(card);
    });
  },

  loadEmail(id) {
    this.activeEmailId = id;
    const email = this.emails.find((e) => e.id === id);
    if (!email) return;

    // Update highlight
    document.querySelectorAll(".thread-item").forEach((card) => {
      card.classList.toggle("active", card.getAttribute("data-id") === id);
    });

    // Populate reading pane
    document.getElementById("currentEmailSubject").textContent = email.subject;
    document.getElementById("currentSenderName").textContent = email.senderName;
    document.getElementById("currentSenderEmail").textContent = `<${email.senderEmail}>`;
    document.getElementById("currentEmailTime").textContent = email.time;
    document.getElementById("currentSenderAvatar").textContent = email.senderName.charAt(0);
    document.getElementById("currentEmailBody").textContent = email.body;

    const statusEl = document.getElementById("currentEmailStatus");
    if (statusEl) {
      if (email.replied) {
        statusEl.textContent = "✓ ส่งคำตอบแล้ว";
        statusEl.style.background = "rgba(16, 185, 129, 0.15)";
        statusEl.style.color = "#10b981";
        statusEl.style.borderColor = "rgba(16, 185, 129, 0.3)";
      } else {
        statusEl.textContent = "รอการตอบกลับ";
        statusEl.style.background = "rgba(234, 67, 53, 0.15)";
        statusEl.style.color = "#ef4444";
        statusEl.style.borderColor = "rgba(234, 67, 53, 0.3)";
      }
    }

    // Auto-detect tone
    const toneSelect = document.getElementById("emailToneSelect");
    if (toneSelect) {
      if (email.body.includes("Hello") || email.body.includes("Dear") || email.body.includes("Singapore")) {
        toneSelect.value = "english";
      } else {
        toneSelect.value = "formal";
      }
    }

    this.generateDraftForActive();
  },

  generateDraftForActive() {
    const email = this.emails.find((e) => e.id === this.activeEmailId);
    if (!email) return;

    const toneSelect = document.getElementById("emailToneSelect");
    const tone = toneSelect ? toneSelect.value : "formal";

    const draftTextarea = document.getElementById("aiDraftContent");
    if (draftTextarea) {
      draftTextarea.value = "กำลังวิเคราะห์ข้อความและร่างคำตอบอัตโนมัติ...";
      setTimeout(() => {
        const reply = AIEngine ? AIEngine.generateGmailReply(email, tone) : "ขอบพระคุณสำหรับข้อมูลครับ";
        draftTextarea.value = reply;
      }, 300);
    }
  },

  async handleSendEmail() {
    const email = this.emails.find((e) => e.id === this.activeEmailId);
    if (!email) return;

    const draftTextarea = document.getElementById("aiDraftContent");
    if (!draftTextarea || !draftTextarea.value.trim()) {
      window.App?.showToast("กรุณากรอกข้อความก่อนส่ง");
      return;
    }

    const replyContent = draftTextarea.value.trim();
    const sendBtn = document.getElementById("sendEmailReplyBtn");
    sendBtn.disabled = true;
    sendBtn.innerHTML = "กำลังส่งผ่าน Gmail SMTP...";

    try {
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email.senderEmail,
          subject: "Re: " + email.subject,
          text: replyContent
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        window.App?.showToast(`✓ ส่งอีเมลจริงสำเร็จผ่าน Gmail SMTP ไปยัง ${email.senderEmail}`, "success");
        window.App?.logTerminal("SMTP_SUCCESS", `Delivered to ${email.senderEmail}`, "tag-gmail");
      } else {
        window.App?.showToast(`💡 บันทึกคำตอบในระบบแล้ว (หากต้องการส่งเมลจริง กรุณาใส่ App Password ในหน้า API CONFIG)`);
        window.App?.logTerminal("GMAIL_SIM", `Reply queued for ${email.senderEmail}`, "tag-gmail");
      }
    } catch (err) {
      window.App?.showToast(`💡 บันทึกคำตอบในระบบแล้ว (จำลอง)`);
    }

    email.replied = true;
    email.status = "replied";
    sendBtn.disabled = false;
    sendBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      <span>ส่งอีเมลจริงทันที (SMTP)</span>
    `;

    this.renderEmailList();
    this.loadEmail(email.id);

    if (window.App && window.App.soundEnabled && window.LineSimulator) {
      LineSimulator.playChime(1000, 0.15);
    }
  },

  simulateIncomingEmail() {
    const newId = "em-" + (this.emails.length + 1);
    const newEmail = {
      id: newId,
      senderName: "ดร. ธีรภัทร เอกมัย",
      senderEmail: "theerapat.doc@bangkok-innovate.org",
      subject: "สอบถามรายละเอียดการเชื่อมต่อ API ของ AIZEN กับระบบหลังบ้าน",
      preview: "สนใจนำระบบตอบไลน์และอีเมลตัวนี้ไปเชื่อมต่อเข้ากับฐานข้อมูล CRM...",
      body: `เรียน ทีมพัฒนาระบบ AIZEN,

กระผมได้เข้าชมระบบ AI Auto-Responder และสนใจที่จะนำ API ตัวนี้ไปเชื่อมต่อเข้ากับระบบ Customer Portal เดิมของทางองค์กร

อยากสอบถามว่ามี REST API Docs และ Webhook Signature verification ให้สำหรับทีม Developer ศึกษาเพิ่มเติมหรือไม่ครับ?

ขอขอบพระคุณล่วงหน้าครับ
ดร. ธีรภัทร เอกมัย`,
      time: "เมื่อสักครู่",
      status: "pending",
      replied: false
    };

    this.emails.unshift(newEmail);
    this.renderEmailList();
    this.loadEmail(newId);

    window.App?.showToast("🔔 มีอีเมลลูกค้าฉบับใหม่เข้ามา! AI กำลังร่างคำตอบ");
    window.App?.logTerminal("GMAIL_IN", `From: ${newEmail.senderName} (${newEmail.subject})`, "tag-gmail");
    if (window.App && window.App.soundEnabled && window.LineSimulator) {
      LineSimulator.playChime(750, 0.1);
    }
  },

  filterEmails(query) {
    const q = query.toLowerCase();
    document.querySelectorAll(".thread-item").forEach((card) => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(q) ? "block" : "none";
    });
  }
};

window.GmailSimulator = GmailSimulator;
