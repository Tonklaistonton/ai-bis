/**
 * AIZEN PRO - LINE Official Account Simulator & Real Stream Handler
 * Displays live messages from real LINE customers and manages Copilot approval
 */

const LineSimulator = {
  chatContainer: null,
  inputBox: null,
  sendBtn: null,
  typingBar: null,
  copilotCard: null,
  copilotDraftEl: null,
  activeItem: null,
  activeMode: "autopilot",
  allChats: [],
  activeUserId: null,

  async init() {
    this.chatContainer = document.getElementById("lineMessagesList");
    this.inputBox = document.getElementById("lineInputBox");
    this.sendBtn = document.getElementById("lineSendBtn");
    this.typingBar = document.getElementById("lineTypingBar");
    this.copilotCard = document.getElementById("copilotReviewCard");
    this.copilotDraftEl = document.getElementById("copilotDraftContent");

    if (this.sendBtn) {
      this.sendBtn.addEventListener("click", () => this.handleSendMessage());
    }

    if (this.inputBox) {
      this.inputBox.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.handleSendMessage();
        }
      });
    }

    const resetBtn = document.getElementById("resetLineChatBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => this.resetChat());
    }

    // Rich shortcut buttons
    document.querySelectorAll(".rich-shortcut-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.getAttribute("data-preset");
        let query = "";
        if (preset === "โปรโมชั่น") query = "สอบถามโปรโมชั่นและส่วนลดปัจจุบันครับ";
        else if (preset === "สินค้าขายดี") query = "ขอดูเสื้อ Puffer Jacket ตัวยอดฮิตหน่อยครับ มีสีและไซส์อะไรบ้าง";
        else if (preset === "วิธีสั่งซื้อ") query = "ขอเลขบัญชีโอนเงิน และวิธีการสั่งซื้อหน่อยครับ";
        else if (preset === "เวลาเปิดปิด") query = "ร้านเปิดกี่โมงครับ?";

        if (this.inputBox && query) {
          this.inputBox.value = query;
          this.handleSendMessage();
        }
      });
    });

    // Copilot Buttons
    const approveBtn = document.getElementById("approveCopilotBtn");
    if (approveBtn) {
      approveBtn.addEventListener("click", () => this.approveCopilotDraft());
    }

    const rejectBtn = document.getElementById("rejectCopilotBtn");
    if (rejectBtn) {
      rejectBtn.addEventListener("click", () => this.rejectCopilotDraft());
    }

    // Fetch existing chat history from server on startup
    await this.loadMessagesFromServer();
  },

  async loadMessagesFromServer() {
    try {
      const res = await fetch("/api/line/messages");
      if (res.ok) {
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          this.populateChatHistory(data.messages);
        }
      }
    } catch (e) {
      console.log("[Load Messages Error]", e);
    }
  },

  setMode(mode) {
    this.activeMode = mode;
    if (mode === "autopilot" && this.copilotCard) {
      this.copilotCard.style.display = "none";
    }
  },

  populateChatHistory(chats) {
    if (!chats || chats.length === 0) return;
    this.allChats = chats;

    // Render session sidebar
    this.renderSessions(chats);

    // If an active user isn't selected, pick the latest user
    if (!this.activeUserId) {
      const firstUserChat = chats.find(c => !c.isBot && c.userId && c.userId !== 'unknown');
      if (firstUserChat) {
        this.activeUserId = firstUserChat.userId;
      }
    }

    // Render messages
    this.renderCurrentMessages();
  },

  renderSessions(chats) {
    const sessionsList = document.getElementById("lineSessionsList");
    if (!sessionsList) return;

    // Extract unique users
    const usersMap = new Map();
    chats.forEach(c => {
      const uid = c.userId || 'guest';
      if (!usersMap.has(uid)) {
        usersMap.set(uid, {
          userId: uid,
          userName: c.userName || 'LINE Customer',
          userAvatar: c.userAvatar || '',
          lastText: c.text,
          time: this.formatTime(c.timestamp),
          isBot: c.isBot
        });
      }
    });

    if (usersMap.size === 0) return;

    sessionsList.innerHTML = "";
    usersMap.forEach((u) => {
      const item = document.createElement("div");
      const isActive = this.activeUserId === u.userId;
      item.className = `session-item ${isActive ? "active" : ""}`;
      item.setAttribute("data-userid", u.userId);

      const avatarHtml = u.userAvatar
        ? `<img src="${u.userAvatar}" class="session-avatar" style="object-fit:cover;" alt="${u.userName}">`
        : `<div class="session-avatar line-av">${u.userName.charAt(0).toUpperCase()}</div>`;

      item.innerHTML = `
        ${avatarHtml}
        <div class="session-body">
          <div class="session-name-row">
            <span class="session-user-name">${this.escapeHtml(u.userName)}</span>
            <span class="session-time">${u.time}</span>
          </div>
          <div class="session-preview">${this.escapeHtml(u.lastText)}</div>
        </div>
      `;

      item.addEventListener("click", () => {
        this.activeUserId = u.userId;
        document.querySelectorAll("#lineSessionsList .session-item").forEach(s => s.classList.remove("active"));
        item.classList.add("active");
        this.renderCurrentMessages();
        window.App?.showToast(`เปิดแชทของ: ${u.userName}`);
      });

      sessionsList.appendChild(item);
    });
  },

  renderCurrentMessages() {
    if (!this.chatContainer) return;
    this.chatContainer.innerHTML = '<div class="chat-date-chip">LINE Official Account (Live Stream)</div>';

    // Filter messages for active session, or display all recent
    let displayChats = this.allChats;
    if (this.activeUserId) {
      displayChats = this.allChats.filter(c => c.userId === this.activeUserId || c.isBot);
    }

    const ordered = [...displayChats].reverse();
    ordered.forEach((item) => {
      if (item.isBot) {
        this.addAdminMessage(item.text, false, this.formatTime(item.timestamp));
      } else {
        this.addCustomerMessage(item.text, item.userName, false, this.formatTime(item.timestamp));
      }
    });

    this.scrollToBottom();
  },

  async handleSendMessage() {
    if (!this.inputBox) return;
    const text = this.inputBox.value.trim();
    if (!text) return;

    this.inputBox.value = "";

    // Target active customer (e.g. Tonton) or find latest active LINE user
    let targetUserId = this.activeUserId;
    if (!targetUserId || targetUserId === "admin" || targetUserId === "unknown") {
      const userChat = this.allChats.find(c => c.userId && c.userId.startsWith("U"));
      if (userChat) targetUserId = userChat.userId;
    }
    if (!targetUserId) targetUserId = "Uc17ea54a77a4bacc38249dd89d01d6ec";

    // Show message immediately on the RIGHT (Admin Outgoing)
    this.addAdminMessage(text);

    // Dispatch real push message to customer's LINE app
    try {
      const res = await fetch("/api/line/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetUserId,
          text: text
        })
      });

      const data = await res.json();
      if (res.ok && data.delivered) {
        window.App?.showToast("✓ ส่งข้อความเข้าแอป LINE ลูกค้าเรียบร้อยแล้ว", "success");
        window.App?.logTerminal("ADMIN_SENT", `Delivered to LINE: "${text}"`, "tag-line");
      } else {
        window.App?.showToast("✓ ส่งข้อความและบันทึกในระบบแล้ว", "info");
      }
    } catch (e) {
      console.error("[Send Message Error]", e);
      window.App?.showToast("⚠️ เกิดข้อผิดพลาดในการส่งข้อความ", "error");
    }
  },

  // ข้อความที่เรา/แอดมินพิมพ์ส่งหาลูกค้า -> อยู่ฝั่งขวา (Right)
  addAdminMessage(text, playAudio = true, customTime = null) {
    if (!this.chatContainer) return;
    const timeStr = customTime || this.getCurrentTime();
    const formattedText = text.replace(/\n/g, "<br>");
    const msgEl = document.createElement("div");
    msgEl.className = "chat-bubble-row admin-row";
    msgEl.innerHTML = `
      <div style="font-size: 0.68rem; color: rgba(255,255,255,0.7); margin-bottom: 2px; text-align: right;">เรา (แอดมิน / AI)</div>
      <div class="msg-bubble-admin">${formattedText}</div>
      <span class="msg-time-label" style="text-align: right;">ส่งแล้ว ${timeStr}</span>
    `;
    this.chatContainer.appendChild(msgEl);
    this.scrollToBottom();

    if (playAudio && window.App && window.App.soundEnabled) {
      this.playChime(880, 0.12);
    }
  },

  // ข้อความที่ลูกค้าพิมพ์ส่งมาหาเรา -> อยู่ฝั่งซ้าย (Left)
  addCustomerMessage(text, userName = "ลูกค้า", playAudio = true, customTime = null) {
    if (!this.chatContainer) return;
    const timeStr = customTime || this.getCurrentTime();
    const formattedText = text.replace(/\n/g, "<br>");
    const msgEl = document.createElement("div");
    msgEl.className = "chat-bubble-row customer-row";
    msgEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px; margin-bottom: 2px;">
        <span style="font-size: 0.72rem; font-weight:700; color: #38bdf8;">${this.escapeHtml(userName)}</span>
      </div>
      <div class="msg-bubble-customer">${formattedText}</div>
      <span class="msg-time-label">${timeStr}</span>
    `;
    this.chatContainer.appendChild(msgEl);
    this.scrollToBottom();

    if (playAudio && window.App && window.App.soundEnabled) {
      this.playChime(600, 0.08);
    }
  },

  // Backward compatibility alias methods
  addUserMessage(text, userName = "ลูกค้า", playAudio = true, customTime = null) {
    this.addCustomerMessage(text, userName, playAudio, customTime);
  },

  addBotMessage(text, playAudio = true, customTime = null) {
    this.addAdminMessage(text, playAudio, customTime);
  },

  showCopilotReview(chatItem) {
    this.activeItem = chatItem;
    if (this.copilotCard && this.copilotDraftEl) {
      this.copilotCard.style.display = "block";
      this.copilotDraftEl.innerHTML = `
        <div style="font-size: 0.72rem; color: #fbbf24; margin-bottom: 4px;">ลูกค้า (${chatItem.userName}): "${this.escapeHtml(chatItem.text)}"</div>
        <div style="color: #fff;">${this.escapeHtml(chatItem.reply).replace(/\n/g, "<br>")}</div>
      `;
    }
  },

  async approveCopilotDraft() {
    if (!this.activeItem) return;

    const { replyToken, reply, id } = this.activeItem;
    this.addBotMessage(reply);

    try {
      await fetch("/api/line/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyToken: replyToken || "",
          text: reply,
          messageId: id || ""
        })
      });
    } catch (e) {
      console.log("[Approve Error]", e.message);
    }

    this.activeItem = null;
    if (this.copilotCard) {
      this.copilotCard.style.display = "none";
    }
    window.App?.showToast("✓ อนุมัติส่งข้อความตอบกลับไปยัง LINE เรียบร้อยแล้ว");
    window.App?.logTerminal("COPILOT", "Draft approved and transmitted to LINE", "tag-ai");
  },

  rejectCopilotDraft() {
    this.activeItem = null;
    if (this.copilotCard) {
      this.copilotCard.style.display = "none";
    }
    window.App?.showToast("✕ ยกเลิกข้อความร่าง แอดมินสามารถพิมพ์ตอบเองได้");
    if (this.inputBox) this.inputBox.focus();
  },

  processAIResponse(userQuery) {
    if (this.typingBar) {
      this.typingBar.style.display = "flex";
      this.scrollToBottom();
    }

    const latency = Math.floor(Math.random() * 400) + 500;
    setTimeout(() => {
      if (this.typingBar) this.typingBar.style.display = "none";

      const reply = AIEngine ? AIEngine.generateLineReply(userQuery) : "สวัสดีครับ ยินดีให้บริการครับ";

      if (this.activeMode === "copilot") {
        this.showCopilotReview({
          userName: "ลูกค้า",
          text: userQuery,
          reply: reply,
          replyToken: ""
        });
        window.App?.showToast("⚡ Copilot: ร่างคำตอบเสร็จแล้ว รอการยืนยันส่ง");
      } else {
        this.addBotMessage(reply);
        window.App?.logTerminal("AI_REPLY", reply.substring(0, 70) + "...", "tag-ai");
      }
    }, latency);
  },

  resetChat() {
    if (this.chatContainer) {
      this.chatContainer.innerHTML = `
        <div class="chat-date-chip">วันนี้ (Live Stream)</div>
        <div class="chat-bubble-row bot-row">
          <div class="msg-bubble-bot">
            สวัสดีครับ ยินดีต้อนรับสู่ <strong>AIZEN Store</strong> 🎉<br>
            ระบบ AI อัจฉริยะพร้อมให้บริการเช็คสต็อกสินค้า สอบถามราคา และแจ้งโปรโมชั่น 24 ชม. ครับ! มีอะไรให้ผมช่วยดูแลดีครับ?
          </div>
          <span class="msg-time-label">${this.getCurrentTime()}</span>
        </div>
      `;
      window.App?.showToast("รีเซ็ตหน้าแชทเรียบร้อยแล้ว");
    }
  },

  scrollToBottom() {
    if (this.chatContainer) {
      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
  },

  formatTime(isoString) {
    if (!isoString) return this.getCurrentTime();
    try {
      const d = new Date(isoString);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch (e) {
      return this.getCurrentTime();
    }
  },

  getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  },

  escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  },

  playChime(freq = 600, duration = 0.1) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }
};

window.LineSimulator = LineSimulator;
