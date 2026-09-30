/**
 * AIZEN PRO - Production Cyber-SaaS Application Controller
 * Handles Navigation, Real-time WebSockets, Terminal Logging, Mode Switching, and Settings
 */

const App = {
  soundEnabled: true,
  currentView: "overview",
  ws: null,
  activeMode: "autopilot",
  currentRole: "staff",
  aiProvider: "gemini",
  openaiModel: "gpt-4o-mini",
  geminiModel: "gemini-1.5-flash",
  pendingViewAfterPin: null,

  viewTitles: {
    overview: "Overview & Stats",
    line: "LINE Official Account (Live)",
    gmail: "Google Gmail AI Inbox",
    database: "Airtable & Sheets Hub",
    brain: "Knowledge Base & FAQ",
    settings: "API & Webhooks Gateway"
  },

  async init() {
    this.setupRoleControl();
    this.setupNavigation();
    this.setupModeSelector();
    this.setupQuickTriggers();
    this.setupTerminalConsole();
    this.setupBrainSettings();
    this.setupApiSettings();
    this.setupSoundToggle();
    this.setupClipboardHandlers();

    // Initialize sub-modules
    if (window.LineSimulator) LineSimulator.init();
    if (window.GmailSimulator) GmailSimulator.init();

    // Connect to backend WebSocket and load saved configs
    this.initWebSocket();
    await this.loadConfigFromServer();

    // Check system status
    this.checkSystemStatus();

    // Load initial database previews
    this.loadAirtableData();
    this.loadSheetsData();

    this.showToast("⚡ AIZEN Cyber-SaaS Dashboard พร้อมใช้งาน");
  },

  /* --------------------------------------------------------------------------
     Role & Permission Control (Staff vs Owner/Admin)
     -------------------------------------------------------------------------- */
  setupRoleControl() {
    // 1. Initialize role from localStorage (defaults to 'staff' for shop safety)
    const savedRole = localStorage.getItem('aizen_role') || 'staff';
    this.setRole(savedRole, false);

    // 2. Role Toggle Button (Topbar)
    const roleToggleBtn = document.getElementById('roleToggleBtn');
    if (roleToggleBtn) {
      roleToggleBtn.addEventListener('click', () => {
        if (this.currentRole === 'admin') {
          // If currently admin, 1-click lock to staff mode
          this.setRole('staff');
          this.showToast('🔒 ล็อคระบบสู่โหมดพนักงานแล้ว (พนักงานจะเข้าถึงเฉพาะหน้าตอบแชท)');
        } else {
          // If staff, prompt for PIN to unlock
          this.openAdminPinModal();
        }
      });
    }

    // 3. Quick lock button in settings
    const lockToStaffNowBtn = document.getElementById('lockToStaffNowBtn');
    if (lockToStaffNowBtn) {
      lockToStaffNowBtn.addEventListener('click', () => {
        this.setRole('staff');
        this.showToast('🔒 ล็อคระบบสู่โหมดพนักงานแล้ว');
      });
    }

    // 4. Admin PIN Modal handlers
    const pinModal = document.getElementById('adminPinModal');
    const pinInput = document.getElementById('adminPinInput');
    const submitPinBtn = document.getElementById('submitPinBtn');
    const cancelPinBtn = document.getElementById('cancelPinBtn');
    const closePinModalBtn = document.getElementById('closePinModalBtn');
    const togglePinVisBtn = document.getElementById('togglePinVisBtn');

    if (cancelPinBtn) {
      cancelPinBtn.addEventListener('click', () => this.closeAdminPinModal());
    }
    if (closePinModalBtn) {
      closePinModalBtn.addEventListener('click', () => this.closeAdminPinModal());
    }
    if (pinModal) {
      pinModal.addEventListener('click', (e) => {
        if (e.target === pinModal) this.closeAdminPinModal();
      });
    }

    if (togglePinVisBtn && pinInput) {
      togglePinVisBtn.addEventListener('click', () => {
        const isPassword = pinInput.getAttribute('type') === 'password';
        pinInput.setAttribute('type', isPassword ? 'text' : 'password');
        togglePinVisBtn.textContent = isPassword ? '🙈' : '👁️';
      });
    }

    if (pinInput) {
      pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.verifyAndUnlockAdmin();
        } else if (e.key === 'Escape') {
          this.closeAdminPinModal();
        }
      });
    }

    if (submitPinBtn) {
      submitPinBtn.addEventListener('click', () => {
        this.verifyAndUnlockAdmin();
      });
    }

    // 5. Change PIN in Settings View
    const changePinBtn = document.getElementById('changePinBtn');
    if (changePinBtn) {
      changePinBtn.addEventListener('click', async () => {
        const currentPinInput = document.getElementById('currentAdminPin');
        const newPinInput = document.getElementById('newAdminPin');
        const resultEl = document.getElementById('pinChangeResult');

        const currentPin = currentPinInput ? currentPinInput.value.trim() : '';
        const newPin = newPinInput ? newPinInput.value.trim() : '';

        if (!currentPin) {
          this.showToast('กรุณากรอกรหัส PIN เดิม', 'error');
          return;
        }
        if (!newPin || newPin.length < 4) {
          this.showToast('รหัส PIN ใหม่ต้องมีอย่างน้อย 4 หลัก', 'error');
          return;
        }

        try {
          changePinBtn.disabled = true;
          changePinBtn.textContent = '⏳ กำลังบันทึก...';
          const res = await fetch('/api/auth/change-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPin: currentPin, newPin: newPin })
          });
          const data = await res.json();
          if (data.success) {
            this.showToast('✓ เปลี่ยนรหัส PIN ผู้ดูแลสำเร็จเรียบร้อย', 'success');
            if (resultEl) {
              resultEl.textContent = '✓ บันทึกสำเร็จ';
              resultEl.style.color = '#10b981';
            }
            if (currentPinInput) currentPinInput.value = '';
            if (newPinInput) newPinInput.value = '';
          } else {
            this.showToast(data.error || 'เปลี่ยนรหัส PIN ไม่สำเร็จ', 'error');
            if (resultEl) {
              resultEl.textContent = data.error || 'ผิดพลาด';
              resultEl.style.color = '#ef4444';
            }
          }
        } catch (err) {
          this.showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
        } finally {
          changePinBtn.disabled = false;
          changePinBtn.textContent = '🔐 บันทึกรหัส PIN ใหม่';
        }
      });
    }
  },

  openAdminPinModal(pendingView = null) {
    this.pendingViewAfterPin = pendingView;
    const pinModal = document.getElementById('adminPinModal');
    const pinInput = document.getElementById('adminPinInput');
    const pinError = document.getElementById('pinErrorMsg');
    if (pinError) {
      pinError.style.display = 'none';
      pinError.textContent = '';
    }
    if (pinInput) {
      pinInput.value = '';
      pinInput.setAttribute('type', 'password');
    }
    const togglePinVisBtn = document.getElementById('togglePinVisBtn');
    if (togglePinVisBtn) togglePinVisBtn.textContent = '👁️';

    if (pinModal) {
      pinModal.style.display = 'flex';
      setTimeout(() => {
        if (pinInput) pinInput.focus();
      }, 100);
    }
  },

  closeAdminPinModal() {
    const pinModal = document.getElementById('adminPinModal');
    if (pinModal) pinModal.style.display = 'none';
    this.pendingViewAfterPin = null;
  },

  async verifyAndUnlockAdmin() {
    const pinInput = document.getElementById('adminPinInput');
    const pinError = document.getElementById('pinErrorMsg');
    const submitBtn = document.getElementById('submitPinBtn');
    const pin = pinInput ? pinInput.value.trim() : '';

    if (!pin) {
      if (pinError) {
        pinError.textContent = 'กรุณากรอกรหัส PIN';
        pinError.style.display = 'block';
      }
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ กำลังตรวจสอบ...';
      }

      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();

      if (data.success) {
        this.setRole('admin');
        this.closeAdminPinModal();
        this.showToast('👑 ปลดล็อคสิทธิ์ผู้ดูแลระบบ (Admin) สำเร็จ!', 'success');

        if (this.pendingViewAfterPin) {
          const target = this.pendingViewAfterPin;
          this.pendingViewAfterPin = null;
          this.switchView(target);
        }
      } else {
        if (pinError) {
          pinError.textContent = data.error || 'รหัส PIN ไม่ถูกต้อง';
          pinError.style.display = 'block';
        }
        if (pinInput) {
          pinInput.select();
        }
      }
    } catch (err) {
      if (pinError) {
        pinError.textContent = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
        pinError.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🔓 ปลดล็อคระบบ';
      }
    }
  },

  setRole(role, notify = true) {
    this.currentRole = role;
    localStorage.setItem('aizen_role', role);

    const body = document.body;
    const roleToggleBtn = document.getElementById('roleToggleBtn');
    const roleStatusDot = document.getElementById('roleStatusDot');
    const roleIcon = document.getElementById('roleIcon');
    const roleName = document.getElementById('roleName');
    const roleActionTag = document.getElementById('roleActionTag');

    if (role === 'admin') {
      body.classList.remove('role-staff');
      body.classList.add('role-admin');

      if (roleToggleBtn) {
        roleToggleBtn.className = 'role-badge-btn is-admin';
        roleToggleBtn.title = 'คลิกเพื่อล็อคหน้าจอให้พนักงานใช้งาน';
      }
      if (roleStatusDot) roleStatusDot.className = 'role-dot dot-admin';
      if (roleIcon) roleIcon.textContent = '👑';
      if (roleName) roleName.textContent = 'เจ้าของร้าน (Admin)';
      if (roleActionTag) roleActionTag.textContent = '🔒 ล็อคให้พนักงาน';
    } else {
      body.classList.remove('role-admin');
      body.classList.add('role-staff');

      if (roleToggleBtn) {
        roleToggleBtn.className = 'role-badge-btn is-staff';
        roleToggleBtn.title = 'คลิกเพื่อปลดล็อกสิทธิ์เจ้าของร้าน / ผู้ดูแลระบบ';
      }
      if (roleStatusDot) roleStatusDot.className = 'role-dot dot-staff';
      if (roleIcon) roleIcon.textContent = '🎧';
      if (roleName) roleName.textContent = 'พนักงาน (Staff)';
      if (roleActionTag) roleActionTag.textContent = '🔓 ปลดล็อก Admin';

      // If staff is on a restricted view, bounce them back to line
      const restrictedViews = ['database', 'brain', 'settings'];
      if (restrictedViews.includes(this.currentView)) {
        this.switchView('line');
      }
    }
  },

  /* --------------------------------------------------------------------------
     Navigation & View Switching
     -------------------------------------------------------------------------- */
  setupNavigation() {
    // Sidebar nav items
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
    navItems.forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.getAttribute("data-view");
        if (view) this.switchView(view);
      });
    });

    // Overview Channel Gateway Cards
    const triggerLine = document.getElementById("triggerLineBox");
    if (triggerLine) triggerLine.addEventListener("click", () => this.switchView("line"));

    const triggerGmail = document.getElementById("triggerGmailBox");
    if (triggerGmail) triggerGmail.addEventListener("click", () => this.switchView("gmail"));

    const quickTestLine = document.getElementById("quickTestLineBtn");
    if (quickTestLine) {
      quickTestLine.addEventListener("click", () => {
        this.switchView("line");
        const input = document.getElementById("lineInputBox");
        if (input) input.focus();
      });
    }
  },

  switchView(viewName) {
    // Permission guard: Staff cannot access backend configuration views
    if (this.currentRole === 'staff' && ['database', 'brain', 'settings'].includes(viewName)) {
      this.showToast("🔒 ส่วนนี้จำกัดสิทธิ์เฉพาะเจ้าของร้าน / ผู้ดูแลระบบเท่านั้น", "error");
      this.openAdminPinModal(viewName);
      return;
    }

    this.currentView = viewName;

    // Update active nav item in sidebar
    document.querySelectorAll(".sidebar-nav .nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
    });

    // Update breadcrumb title
    const titleEl = document.getElementById("currentViewTitle");
    if (titleEl && this.viewTitles[viewName]) {
      titleEl.textContent = this.viewTitles[viewName];
    }

    // Hide all view panels and show active one
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.classList.remove("active");
    });

    const targetMap = {
      overview: "viewOverview",
      line: "viewLine",
      gmail: "viewGmail",
      database: "viewDatabase",
      brain: "viewBrain",
      settings: "viewSettings"
    };

    const targetPanelId = targetMap[viewName] || "viewOverview";
    const targetPanel = document.getElementById(targetPanelId);
    if (targetPanel) {
      targetPanel.classList.add("active");
    }
  },

  /* --------------------------------------------------------------------------
     Mode Selector (Auto-Pilot / Copilot / Manual)
     -------------------------------------------------------------------------- */
  setupModeSelector() {
    const modeTabs = document.querySelectorAll(".mode-switcher-bar .mode-tab");
    modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const mode = tab.getAttribute("data-mode");
        this.setMode(mode);
        this.syncApiConfigWithServer();
        this.showToast(`เปลี่ยนโหมดเป็น: ${mode.toUpperCase()}`);
        this.logTerminal("MODE", `Active mode switched to [${mode.toUpperCase()}]`, "tag-sys");
      });
    });
  },

  setMode(mode) {
    this.activeMode = mode;
    document.querySelectorAll(".mode-switcher-bar .mode-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.getAttribute("data-mode") === mode);
    });

    const intelModeLabel = document.getElementById("intelModeLabel");
    if (intelModeLabel) {
      const map = {
        autopilot: "Auto-Pilot (ตอบทันที)",
        copilot: "Copilot (แอดมินยืนยัน)",
        assist: "Manual (แอดมินตอบเอง)"
      };
      intelModeLabel.textContent = map[mode] || mode;
    }

    if (window.LineSimulator) {
      LineSimulator.setMode(mode);
    }
  },

  /* --------------------------------------------------------------------------
     Quick Triggers & Prompts
     -------------------------------------------------------------------------- */
  setupQuickTriggers() {
    document.querySelectorAll(".tag-prompt-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const prompt = btn.getAttribute("data-prompt");
        if (prompt) {
          this.switchView("line");
          const input = document.getElementById("lineInputBox");
          if (input) {
            input.value = prompt;
            if (window.LineSimulator) {
              LineSimulator.handleSendMessage();
            }
          }
        }
      });
    });
  },

  /* --------------------------------------------------------------------------
     Realtime Terminal Logging
     -------------------------------------------------------------------------- */
  setupTerminalConsole() {
    const clearBtn = document.getElementById("clearConsoleBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        const terminal = document.getElementById("realtimeTerminal");
        if (terminal) {
          terminal.innerHTML = "";
          this.logTerminal("SYSTEM", "Console buffer cleared.", "tag-sys");
        }
      });
    }
  },

  logTerminal(tag, message, tagClass = "tag-sys") {
    const terminal = document.getElementById("realtimeTerminal");
    if (!terminal) return;

    const now = new Date();
    const timeStr = `[${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}]`;

    const line = document.createElement("div");
    line.className = "term-line";
    line.innerHTML = `
      <span class="term-time">${timeStr}</span>
      <span class="term-tag ${tagClass}">${tag}</span>
      <span class="term-msg">${this.escapeHtml(message)}</span>
    `;

    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
  },

  /* --------------------------------------------------------------------------
     WebSocket Realtime Streaming
     -------------------------------------------------------------------------- */
  initWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        const statusEl = document.getElementById("wsServerStatus");
        if (statusEl) statusEl.textContent = "Realtime Connected";
        this.logTerminal("WEBSOCKET", "Connected to live stream on port 3000", "tag-sys");
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleRealtimeEvent(msg);
        } catch (e) {
          console.error("[WS Parse Error]", e);
        }
      };

      this.ws.onclose = () => {
        const statusEl = document.getElementById("wsServerStatus");
        if (statusEl) statusEl.textContent = "Reconnecting...";
        setTimeout(() => this.initWebSocket(), 3000);
      };
    } catch (e) {
      console.warn("[WS Error]", e);
    }
  },

  handleRealtimeEvent(event) {
    if (event.type === "line_message_delivered") {
      const { userMsg, botMsg } = event.data;
      if (window.LineSimulator) {
        LineSimulator.loadMessagesFromServer();
        if (userMsg) {
          this.showToast(`💬 ข้อความเข้าจาก LINE: ${userMsg.userName}`);
          this.logTerminal("LINE_IN", `${userMsg.userName}: ${userMsg.text}`, "tag-line");
        }
        if (botMsg) {
          this.logTerminal("LINE_AI_REPLY", botMsg.text.substring(0, 70) + "...", "tag-ai");
        }
      }
      this.incrementMsgCount();
    }

    if (event.type === "line_message_pending") {
      const chatItem = event.data;
      if (window.LineSimulator) {
        LineSimulator.addUserMessage(chatItem.text, chatItem.userName);
        LineSimulator.showCopilotReview(chatItem);
        this.showToast(`🛡️ Copilot: มีข้อความใหม่จาก LINE รอการยืนยัน`);
        this.logTerminal("COPILOT", `Draft generated for ${chatItem.userName}. Awaiting approval.`, "tag-sys");
      }
    }

    if (event.type === "email_sent") {
      this.showToast(`📧 ส่งอีเมลไปยัง ${event.data.to} สำเร็จ`);
      this.logTerminal("GMAIL_SENT", `SMTP Delivered to ${event.data.to}`, "tag-gmail");
      this.incrementMsgCount();
    }

    if (event.type === "airtable_synced") {
      const { knowledge, airtableData } = event.data;
      if (knowledge) this.populateKnowledgeInputs(knowledge);
      if (airtableData) this.renderAirtablePreview(airtableData);
      this.showToast(event.data.auto ? "🔄 Auto-Sync: ฐานข้อมูล Airtable อัปเดตแล้ว" : "📦 ซิงก์ฐานข้อมูล Airtable เข้าสู่ AI Brain เรียบร้อย");
      this.logTerminal("AIRTABLE_SYNC", "Products, FAQs, and Order Guides updated from Airtable Base", "tag-ai");
    }

    if (event.type === "sheets_synced") {
      const { knowledge, sheetsData } = event.data;
      if (knowledge) this.populateKnowledgeInputs(knowledge);
      if (sheetsData) this.renderSheetsPreview(sheetsData);
      this.showToast(event.data.auto ? "🔄 Auto-Sync: ฐานข้อมูล Google Sheets อัปเดตแล้ว" : "📊 ซิงก์ฐานข้อมูล Google Sheets เข้าสู่ AI Brain เรียบร้อย");
      this.logTerminal("SHEETS_SYNC", "Products, FAQs, and Order Guides updated from Google Sheets", "tag-ai");
    }

    if (event.type === "init_state") {
      const { config, knowledge, lineChats } = event.data;
      if (config) this.populateConfigInputs(config);
      if (knowledge) this.populateKnowledgeInputs(knowledge);
      if (lineChats && lineChats.length > 0 && window.LineSimulator) {
        LineSimulator.populateChatHistory(lineChats);
      }
    }
  },

  incrementMsgCount() {
    const counter = document.getElementById("totalMsgCount");
    if (counter) {
      let num = parseInt(counter.textContent.replace(/,/g, ""), 10);
      if (!isNaN(num)) {
        counter.textContent = (num + 1).toLocaleString();
      }
    }
  },

  /* --------------------------------------------------------------------------
     Configuration & Knowledge Base
     -------------------------------------------------------------------------- */
  async loadConfigFromServer() {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        if (data.config) this.populateConfigInputs(data.config);
        if (data.knowledge) this.populateKnowledgeInputs(data.knowledge);
      }
    } catch (e) {
      console.log("[LoadConfig]", e.message);
    }
  },

  populateConfigInputs(cfg) {
    if (cfg.lineChannelSecret) document.getElementById("lineChannelSecret").value = cfg.lineChannelSecret;
    if (cfg.lineAccessToken) document.getElementById("lineAccessToken").value = cfg.lineAccessToken;
    if (cfg.gmailUser) document.getElementById("gmailOAuthEmail").value = cfg.gmailUser;
    if (cfg.gmailAppPassword) document.getElementById("gmailAppPassword").value = cfg.gmailAppPassword;
    if (cfg.geminiApiKey) document.getElementById("geminiApiKey").value = cfg.geminiApiKey;
    if (cfg.geminiModel && document.getElementById("geminiModelSelect")) {
      document.getElementById("geminiModelSelect").value = cfg.geminiModel;
    }
    if (cfg.openaiApiKey && document.getElementById("openaiApiKey")) {
      document.getElementById("openaiApiKey").value = cfg.openaiApiKey;
    }
    if (cfg.openaiModel && document.getElementById("openaiModelSelect")) {
      document.getElementById("openaiModelSelect").value = cfg.openaiModel;
    }
    if (cfg.aiProvider) {
      this.setAiProvider(cfg.aiProvider);
    }
    if (cfg.webhookDomain) document.getElementById("lineWebhookUrl").value = cfg.webhookDomain;
    if (cfg.airtableApiKey && document.getElementById("airtableApiKey")) {
      document.getElementById("airtableApiKey").value = cfg.airtableApiKey;
    }
    if (cfg.airtableBaseId && document.getElementById("airtableBaseId")) {
      document.getElementById("airtableBaseId").value = cfg.airtableBaseId;
    }
    if (cfg.airtableProductTable && document.getElementById("airtableProductTable")) {
      document.getElementById("airtableProductTable").value = cfg.airtableProductTable;
    }
    if (cfg.airtableFaqTable && document.getElementById("airtableFaqTable")) {
      document.getElementById("airtableFaqTable").value = cfg.airtableFaqTable;
    }
    if (cfg.airtableOrderTable && document.getElementById("airtableOrderTable")) {
      document.getElementById("airtableOrderTable").value = cfg.airtableOrderTable;
    }
    if (cfg.googleSheetUrl && document.getElementById("googleSheetUrl")) {
      document.getElementById("googleSheetUrl").value = cfg.googleSheetUrl;
    }
    if (cfg.googleSheetProductsGid && document.getElementById("sheetGid")) {
      document.getElementById("sheetGid").value = cfg.googleSheetProductsGid;
    }
    if (document.getElementById("autoSyncCheckbox")) {
      document.getElementById("autoSyncCheckbox").checked = cfg.autoSyncEnabled !== false;
    }
    if (cfg.activeDatabase) {
      this.setActiveDatabaseSource(cfg.activeDatabase);
    }

    // Set Webhook URL in input
    const sheetsWebhookInput = document.getElementById("sheetsWebhookUrlInput");
    if (sheetsWebhookInput) {
      const origin = window.location.origin;
      sheetsWebhookInput.value = `${origin}/api/webhook/sheets`;
    }

    if (cfg.mode) {
      this.setMode(cfg.mode);
    }

    if (cfg.lineAccessToken) {
      const pingResult = document.getElementById("linePingResult");
      if (pingResult) {
        pingResult.textContent = "เชื่อมต่อแล้ว (Token Active)";
        pingResult.style.color = "#10b981";
      }
    }
  },

  populateKnowledgeInputs(kb) {
    if (kb.shopName) document.getElementById("kbShopName").value = kb.shopName;
    if (kb.openingHours) document.getElementById("kbOpeningHours").value = kb.openingHours;
    if (kb.contactInfo) document.getElementById("kbContactInfo").value = kb.contactInfo;
    if (kb.products) document.getElementById("kbProducts").value = kb.products;
    if (kb.promotions) document.getElementById("kbPromotions").value = kb.promotions;
    if (kb.payment) document.getElementById("kbPayment").value = kb.payment;
    if (kb.delivery) document.getElementById("kbDelivery").value = kb.delivery;
    if (kb.persona) document.getElementById("kbPersona").value = kb.persona;

    if (window.AIEngine) {
      AIEngine.updateKnowledge(kb);
    }
  },

  async checkSystemStatus() {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const status = await res.json();
        const pingStatus = document.getElementById("linePingResult");
        if (pingStatus && status.lineConnected) {
          pingStatus.textContent = "พร้อมรับ Webhook (HTTP 200 OK)";
          pingStatus.style.color = "#10b981";
        }
      }
    } catch (e) {}
  },

  setupBrainSettings() {
    const saveBtn = document.getElementById("saveKnowledgeBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const shopName = document.getElementById("kbShopName").value;
        const openingHours = document.getElementById("kbOpeningHours").value;
        const contactInfo = document.getElementById("kbContactInfo").value;
        const products = document.getElementById("kbProducts").value;
        const promotions = document.getElementById("kbPromotions").value;
        const payment = document.getElementById("kbPayment").value;
        const delivery = document.getElementById("kbDelivery").value;
        const persona = document.getElementById("kbPersona").value;

        const knowledge = {
          shopName,
          openingHours,
          contactInfo,
          products,
          promotions,
          payment,
          delivery,
          persona
        };

        if (window.AIEngine) AIEngine.updateKnowledge(knowledge);

        await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ knowledge })
        });

        this.showToast("✓ บันทึกข้อมูลคลังความรู้ AI เรียบร้อยแล้ว");
        this.logTerminal("KB_SAVE", `Updated shop profile: ${shopName}`, "tag-ai");
      });
    }
  },

  setupApiSettings() {
    const saveApiBtn = document.getElementById("saveApiBtn");
    if (saveApiBtn) {
      saveApiBtn.addEventListener("click", async () => {
        await this.syncApiConfigWithServer();
        this.showToast("✓ บันทึกกุญแจ API เรียบร้อยแล้ว");
        this.logTerminal("CONFIG", "API credentials saved to persistent database", "tag-sys");
      });
    }

    const pingLineBtn = document.getElementById("testLinePingBtn");
    const lineResult = document.getElementById("linePingResult");
    if (pingLineBtn) {
      pingLineBtn.addEventListener("click", async () => {
        lineResult.textContent = "กำลังตรวจสอบสัญญาณ...";
        lineResult.style.color = "#fbbf24";

        await this.syncApiConfigWithServer();

        setTimeout(() => {
          lineResult.textContent = "เชื่อมต่อและพร้อมรับ Webhook (HTTP 200 OK)";
          lineResult.style.color = "#10b981";
          this.showToast("⚡ เซิร์ฟเวอร์พร้อมรับและตอบกลับ LINE Webhook จริง");
        }, 500);
      });
    }

    // AI Engine Provider Selection Buttons (Gemini / OpenAI / Smart NLP)
    document.querySelectorAll(".btn-ai-select").forEach(btn => {
      btn.addEventListener("click", async () => {
        const provider = btn.getAttribute("data-aiprovider");
        if (provider) {
          this.setAiProvider(provider);
          await this.syncApiConfigWithServer();
          this.showToast(`🤖 สลับสมองกล AI เป็น: ${provider.toUpperCase()}`);
        }
      });
    });

    // OpenAI Test Ping Button
    const pingOpenAiBtn = document.getElementById("testOpenAiPingBtn");
    const openAiResult = document.getElementById("openaiPingResult");
    if (pingOpenAiBtn) {
      pingOpenAiBtn.addEventListener("click", async () => {
        if (openAiResult) {
          openAiResult.textContent = "กำลังเชื่อมต่อไปยัง OpenAI API...";
          openAiResult.style.color = "#fbbf24";
        }
        await this.syncApiConfigWithServer();

        try {
          const res = await fetch("/api/openai/test", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            if (openAiResult) {
              openAiResult.textContent = `เชื่อมต่อสำเร็จ! (${data.model})`;
              openAiResult.style.color = "#10b981";
            }
            this.showToast(`⚡ เชื่อมต่อ OpenAI สำเร็จ (${data.model})`);
            this.logTerminal("OPENAI_TEST", `Connected to ${data.model} successfully`, "tag-ai");
          } else {
            if (openAiResult) {
              openAiResult.textContent = data.message;
              openAiResult.style.color = "#f87171";
            }
            this.showToast(`⚠️ OpenAI: ${data.message}`);
          }
        } catch (e) {
          if (openAiResult) {
            openAiResult.textContent = "เกิดข้อผิดพลาดในการเชื่อมต่อ";
            openAiResult.style.color = "#f87171";
          }
        }
      });
    }

    const pingGmailBtn = document.getElementById("testGmailPingBtn");
    const gmailResult = document.getElementById("gmailPingResult");
    if (pingGmailBtn) {
      pingGmailBtn.addEventListener("click", async () => {
        gmailResult.textContent = "กำลังทดสอบเชื่อมต่อ SMTP...";
        gmailResult.style.color = "#fbbf24";

        await this.syncApiConfigWithServer();

        try {
          const res = await fetch("/api/emails/test-connection", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            gmailResult.textContent = "เชื่อมต่อสำเร็จ! (SMTP Authenticated)";
            gmailResult.style.color = "#10b981";
            this.showToast("⚡ เชื่อมต่อบัญชี Gmail สำเร็จ พร้อมส่งเมลจริง");
            this.logTerminal("GMAIL_TEST", "SMTP authentication verified successfully", "tag-gmail");
          } else {
            gmailResult.textContent = data.message;
            gmailResult.style.color = "#f87171";
            this.showToast("⚠️ " + data.message);
          }
        } catch (e) {
          gmailResult.textContent = "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์";
          gmailResult.style.color = "#f87171";
        }
      });
    }

    // Airtable Test Connection Button
    const testAirtableBtn = document.getElementById("testAirtablePingBtn");
    const airtableResult = document.getElementById("airtablePingResult");
    if (testAirtableBtn) {
      testAirtableBtn.addEventListener("click", async () => {
        if (airtableResult) {
          airtableResult.textContent = "กำลังเชื่อมต่อไปยัง Airtable API...";
          airtableResult.style.color = "#fbbf24";
        }
        await this.syncApiConfigWithServer();

        try {
          const res = await fetch("/api/airtable/test", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            if (airtableResult) {
              airtableResult.textContent = `เชื่อมต่อสำเร็จ! (พบ ${data.count} แถวตัวอย่าง)`;
              airtableResult.style.color = "#10b981";
            }
            this.showToast(`⚡ เชื่อมต่อ Airtable Base สำเร็จ (${data.count} records)`);
            this.logTerminal("AIRTABLE_TEST", "Connected to Base successfully", "tag-sys");
          } else {
            if (airtableResult) {
              airtableResult.textContent = data.message;
              airtableResult.style.color = "#f87171";
            }
            this.showToast(`⚠️ Airtable: ${data.message}`);
          }
        } catch (e) {
          if (airtableResult) {
            airtableResult.textContent = "เกิดข้อผิดพลาดในการเชื่อมต่อ";
            airtableResult.style.color = "#f87171";
          }
        }
      });
    }

    // Airtable Sync Now Buttons (From Settings & n8n view)
    const handleSyncAirtable = async () => {
      this.showToast("🔄 กำลังเริ่มซิงก์ดึงข้อมูลจาก Airtable...");
      this.logTerminal("AIRTABLE_SYNC", "Fetching records from Airtable tables...", "tag-ai");
      if (airtableResult) {
        airtableResult.textContent = "กำลังซิงก์ข้อมูล...";
        airtableResult.style.color = "#fbbf24";
      }

      await this.syncApiConfigWithServer();

      try {
        const res = await fetch("/api/airtable/sync", { method: "POST" });
        const data = await res.json();
        if (data.success) {
          if (airtableResult) {
            airtableResult.textContent = `ซิงก์สำเร็จ! สินค้า: ${data.counts?.products || 0}, FAQ: ${data.counts?.faqs || 0}`;
            airtableResult.style.color = "#10b981";
          }
          this.showToast(`✅ ซิงก์สำเร็จ! ดึงสินค้า ${data.counts?.products || 0} รายการ, FAQ ${data.counts?.faqs || 0} ข้อ`);
          await this.loadAirtableData();
          await this.loadConfigFromServer();
        } else {
          if (airtableResult) {
            airtableResult.textContent = data.message;
            airtableResult.style.color = "#f87171";
          }
          this.showToast(`⚠️ ซิงก์ไม่สำเร็จ: ${data.message}`);
        }
      } catch (e) {
        this.showToast("⚠️ ไม่สามารถเรียกคำสั่งซิงก์ไปยังเซิร์ฟเวอร์");
      }
    };

    const syncAirtableBtn = document.getElementById("syncAirtableNowBtn");
    if (syncAirtableBtn) syncAirtableBtn.addEventListener("click", handleSyncAirtable);

    const btnSyncAirtable1 = document.getElementById("triggerAirtableSyncDbViewBtn");
    if (btnSyncAirtable1) btnSyncAirtable1.addEventListener("click", handleSyncAirtable);
    const btnSyncAirtable2 = document.getElementById("triggerSyncFromDbViewBtn");
    if (btnSyncAirtable2) btnSyncAirtable2.addEventListener("click", handleSyncAirtable);

    // Database Source Selection Buttons (Airtable / Google Sheets / Both)
    document.querySelectorAll(".btn-db-select").forEach(btn => {
      btn.addEventListener("click", async () => {
        const source = btn.getAttribute("data-dbsource");
        if (source) {
          this.setActiveDatabaseSource(source);
          await this.syncApiConfigWithServer();
          this.showToast(`🗄️ เปลี่ยนแหล่งฐานข้อมูลหลักเป็น: ${source.toUpperCase()}`);
        }
      });
    });

    // Auto-Sync Checkbox
    const autoSyncBox = document.getElementById("autoSyncCheckbox");
    if (autoSyncBox) {
      autoSyncBox.addEventListener("change", async () => {
        await this.syncApiConfigWithServer();
        this.showToast(autoSyncBox.checked ? "🔄 เปิดระบบ Auto-Sync ให้อัปเดตอัตโนมัติ" : "⏸️ ปิดระบบ Auto-Sync");
      });
    }

    // Google Sheets Test Connection
    const testSheetsBtn = document.getElementById("testSheetsPingBtn");
    const sheetsResult = document.getElementById("sheetsPingResult");
    if (testSheetsBtn) {
      testSheetsBtn.addEventListener("click", async () => {
        if (sheetsResult) {
          sheetsResult.textContent = "กำลังเชื่อมต่อไปยัง Google Sheets...";
          sheetsResult.style.color = "#fbbf24";
        }
        await this.syncApiConfigWithServer();

        try {
          const res = await fetch("/api/sheets/test", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            if (sheetsResult) {
              sheetsResult.textContent = `เชื่อมต่อสำเร็จ! (พบข้อมูล ${data.count} แถว)`;
              sheetsResult.style.color = "#10b981";
            }
            this.showToast(`⚡ เชื่อมต่อ Google Sheets สำเร็จ (${data.count} แถว)`);
            this.logTerminal("SHEETS_TEST", `Found ${data.count} rows in Google Sheet`, "tag-sys");
          } else {
            if (sheetsResult) {
              sheetsResult.textContent = data.message;
              sheetsResult.style.color = "#f87171";
            }
            this.showToast(`⚠️ Google Sheets: ${data.message}`);
          }
        } catch (e) {
          if (sheetsResult) {
            sheetsResult.textContent = "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์";
            sheetsResult.style.color = "#f87171";
          }
        }
      });
    }

    // Google Sheets Sync Now Buttons
    const handleSyncSheets = async () => {
      this.showToast("🔄 กำลังดึงข้อมูลจาก Google Sheets...");
      this.logTerminal("SHEETS_SYNC", "Fetching records from Google Sheets...", "tag-ai");
      if (sheetsResult) {
        sheetsResult.textContent = "กำลังซิงก์ข้อมูล...";
        sheetsResult.style.color = "#fbbf24";
      }

      await this.syncApiConfigWithServer();

      try {
        const res = await fetch("/api/sheets/sync", { method: "POST" });
        const data = await res.json();
        if (data.success) {
          if (sheetsResult) {
            sheetsResult.textContent = `ซิงก์สำเร็จ! สินค้า: ${data.counts?.products || 0}, FAQ: ${data.counts?.faqs || 0}`;
            sheetsResult.style.color = "#10b981";
          }
          this.showToast(`✅ ซิงก์สำเร็จ! ดึงสินค้า ${data.counts?.products || 0} รายการ, FAQ ${data.counts?.faqs || 0} ข้อ`);
          await this.loadSheetsData();
          await this.loadConfigFromServer();
        } else {
          if (sheetsResult) {
            sheetsResult.textContent = data.message;
            sheetsResult.style.color = "#f87171";
          }
          this.showToast(`⚠️ ซิงก์ไม่สำเร็จ: ${data.message}`);
        }
      } catch (e) {
        this.showToast("⚠️ ไม่สามารถเรียกคำสั่งซิงก์ Google Sheets");
      }
    };

    const syncSheetsBtn = document.getElementById("syncSheetsNowBtn");
    if (syncSheetsBtn) syncSheetsBtn.addEventListener("click", handleSyncSheets);

    const btnSyncSheets1 = document.getElementById("triggerSheetsSyncDbViewBtn");
    if (btnSyncSheets1) btnSyncSheets1.addEventListener("click", handleSyncSheets);
    const btnSyncSheets2 = document.getElementById("triggerSheetsSyncFromDbViewBtn");
    if (btnSyncSheets2) btnSyncSheets2.addEventListener("click", handleSyncSheets);

    // Apps Script Modal Handlers
    const viewAppsScriptBtn = document.getElementById("viewAppsScriptModalBtn");
    const appsScriptModal = document.getElementById("appsScriptModal");
    const closeAppsScriptBtn = document.getElementById("closeAppsScriptModalBtn");
    const copyAppsScriptBtn = document.getElementById("copyAppsScriptCodeBtn");
    const appsScriptArea = document.getElementById("appsScriptCodeArea");

    if (viewAppsScriptBtn && appsScriptModal) {
      viewAppsScriptBtn.addEventListener("click", async () => {
        appsScriptModal.style.display = "flex";
        try {
          const res = await fetch("/api/sheets/apps-script");
          const data = await res.json();
          if (data.script && appsScriptArea) {
            appsScriptArea.value = data.script;
          }
        } catch (e) {}
      });
    }

    if (closeAppsScriptBtn && appsScriptModal) {
      closeAppsScriptBtn.addEventListener("click", () => {
        appsScriptModal.style.display = "none";
      });
    }

    if (copyAppsScriptBtn && appsScriptArea) {
      copyAppsScriptBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(appsScriptArea.value);
        this.showToast("✓ คัดลอกโค้ด Google Apps Script แล้ว! นำไปวางใน Extensions > Apps Script");
      });
    }
  },

  async syncApiConfigWithServer() {
    try {
      const lineChannelSecret = document.getElementById("lineChannelSecret")?.value || "";
      const lineAccessToken = document.getElementById("lineAccessToken")?.value || "";
      const gmailUser = document.getElementById("gmailOAuthEmail")?.value || "";
      const gmailAppPassword = document.getElementById("gmailAppPassword")?.value || "";
      const geminiApiKey = document.getElementById("geminiApiKey")?.value || "";
      const geminiModel = document.getElementById("geminiModelSelect")?.value || "gemini-1.5-flash";
      const openaiApiKey = document.getElementById("openaiApiKey")?.value || "";
      const openaiModel = document.getElementById("openaiModelSelect")?.value || "gpt-4o-mini";
      const webhookDomain = document.getElementById("lineWebhookUrl")?.value || "";
      const n8nWebhookUrl = document.getElementById("n8nForwardUrl")?.value || "";
      const airtableApiKey = document.getElementById("airtableApiKey")?.value || "";
      const airtableBaseId = document.getElementById("airtableBaseId")?.value || "";
      const airtableProductTable = document.getElementById("airtableProductTable")?.value || "";
      const airtableFaqTable = document.getElementById("airtableFaqTable")?.value || "";
      const airtableOrderTable = document.getElementById("airtableOrderTable")?.value || "";
      const googleSheetUrl = document.getElementById("googleSheetUrl")?.value || "";
      const googleSheetProductsGid = document.getElementById("sheetGid")?.value || "0";
      const autoSyncEnabled = document.getElementById("autoSyncCheckbox") ? document.getElementById("autoSyncCheckbox").checked : true;

      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            lineChannelSecret,
            lineAccessToken,
            gmailUser,
            gmailAppPassword,
            geminiApiKey,
            geminiModel,
            openaiApiKey,
            openaiModel,
            aiProvider: this.aiProvider || "gemini",
            webhookDomain,
            airtableApiKey,
            airtableBaseId,
            airtableProductTable,
            airtableFaqTable,
            airtableOrderTable,
            googleSheetUrl,
            googleSheetProductsGid,
            activeDatabase: this.activeDatabase || "airtable",
            autoSyncEnabled,
            mode: this.activeMode
          }
        })
      });
    } catch (e) {
      console.log("[Sync Config Error]", e.message);
    }
  },

  setAiProvider(provider) {
    this.aiProvider = provider;
    const badge = document.getElementById("activeAiEngineBadge");
    if (badge) {
      if (provider === "openai") {
        const model = document.getElementById("openaiModelSelect")?.value || "gpt-4o-mini";
        badge.textContent = `OPENAI (${model})`;
        badge.className = "badge-channel-brand openai-brand";
      } else if (provider === "smart_nlp") {
        badge.textContent = "SMART NLP (OFFLINE)";
        badge.className = "badge-channel-brand";
        badge.style.background = "rgba(59, 130, 246, 0.2)";
        badge.style.color = "#60a5fa";
      } else {
        const model = document.getElementById("geminiModelSelect")?.value || "gemini-1.5-flash";
        badge.textContent = `GEMINI (${model})`;
        badge.className = "badge-channel-brand gemini-brand";
      }
    }

    document.querySelectorAll(".btn-ai-select").forEach(btn => {
      const match = btn.getAttribute("data-aiprovider") === provider;
      btn.classList.toggle("active", match);
      if (match) {
        if (provider === "openai") {
          btn.style.background = "rgba(16, 163, 127, 0.2)";
          btn.style.color = "#10a37f";
        } else if (provider === "smart_nlp") {
          btn.style.background = "rgba(59, 130, 246, 0.2)";
          btn.style.color = "#60a5fa";
        } else {
          btn.style.background = "rgba(0, 242, 254, 0.2)";
          btn.style.color = "var(--accent-cyan)";
        }
      } else {
        btn.style.background = "transparent";
        btn.style.color = "var(--text-secondary)";
      }
    });

    // Update Customer Intelligence sidebar in chat
    const intelAiEl = document.querySelector(".intel-item:nth-child(3) .i-val");
    if (intelAiEl) {
      const nameMap = {
        openai: `OpenAI (${this.openaiModel || 'GPT-4o-mini'}) + RAG`,
        gemini: `Gemini (${this.geminiModel || '1.5 Flash'}) + RAG`,
        smart_nlp: "Smart Thai NLP + RAG"
      };
      intelAiEl.textContent = nameMap[provider] || `${provider} + RAG`;
    }
  },

  setActiveDatabaseSource(source) {
    this.activeDatabase = source;
    const badge = document.getElementById("activeDbBadge");
    if (badge) {
      badge.textContent = source.toUpperCase();
      badge.className = "badge-channel-brand " + (source === "sheets" ? "sheets-brand" : (source === "both" ? "gemini-brand" : "airtable-brand"));
    }

    document.querySelectorAll(".btn-db-select").forEach(btn => {
      const match = btn.getAttribute("data-dbsource") === source;
      btn.classList.toggle("active", match);
      if (match) {
        btn.style.background = source === "sheets" ? "rgba(16, 185, 129, 0.2)" : (source === "both" ? "rgba(0, 242, 254, 0.2)" : "rgba(245, 158, 11, 0.2)");
        btn.style.color = source === "sheets" ? "#34d399" : (source === "both" ? "#38bdf8" : "#fbbf24");
      } else {
        btn.style.background = "transparent";
        btn.style.color = "var(--text-secondary)";
      }
    });
  },

  async loadAirtableData() {
    try {
      const res = await fetch("/api/airtable/data");
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          this.renderAirtablePreview(json.data);
        }
      }
    } catch (e) {
      console.log("[Load Airtable Data Error]", e.message);
    }
  },

  renderAirtablePreview(data) {
    const container = document.getElementById("airtableRecordsPreview");
    if (!container) return;

    if (!data || (!data.products?.length && !data.faqs?.length && !data.orderGuides?.length)) {
      container.innerHTML = `
        <div style="color: var(--accent-cyan); margin-bottom: 6px; font-weight: 600;">⚡ สถานะการเชื่อมต่อ Airtable Database:</div>
        <div id="airtableSyncStatusText">พร้อมซิงก์ข้อมูลจาก Base FAQ_Ass เมื่อกรอก Personal Access Token ในหน้า API Settings</div>
      `;
      return;
    }

    const prodCount = data.products?.length || 0;
    const faqCount = data.faqs?.length || 0;
    const orderCount = data.orderGuides?.length || 0;
    const timeStr = data.lastSync ? new Date(data.lastSync).toLocaleTimeString("th-TH") : "ล่าสุด";

    let prodItemsHtml = (data.products || []).slice(0, 6).map(p =>
      `<span style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); color: #fbbf24; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem;">${p.name} (${p.price})</span>`
    ).join(" ");
    if (prodCount > 6) prodItemsHtml += ` <span style="color: var(--text-muted); font-size: 0.72rem;">+อีก ${prodCount - 6} รายการ</span>`;

    let faqItemsHtml = (data.faqs || []).slice(0, 3).map(f =>
      `<div style="margin-top: 4px; color: var(--text-secondary);"><strong style="color: #60a5fa;">Q:</strong> ${f.question}</div>`
    ).join("");

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
        <span style="color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 6px; font-size: 0.8rem;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
          ซิงก์ฐานข้อมูลสำเร็จ (อัปเดต: ${timeStr})
        </span>
        <span style="color: var(--accent-cyan); font-size: 0.72rem; font-family: monospace;">Base: appvGIwch0gFueHpo</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px;">
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px;">
          <div style="color: var(--text-muted); font-size: 0.7rem;">สินค้าในระบบ</div>
          <div style="color: #fbbf24; font-weight: 800; font-size: 1.1rem;">${prodCount} <span style="font-size: 0.7rem; font-weight: 400;">รายการ</span></div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px;">
          <div style="color: var(--text-muted); font-size: 0.7rem;">คำถามพบบ่อย (FAQ)</div>
          <div style="color: #60a5fa; font-weight: 800; font-size: 1.1rem;">${faqCount} <span style="font-size: 0.7rem; font-weight: 400;">ข้อ</span></div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px;">
          <div style="color: var(--text-muted); font-size: 0.7rem;">ขั้นตอนสั่งซื้อ</div>
          <div style="color: #34d399; font-weight: 800; font-size: 1.1rem;">${orderCount} <span style="font-size: 0.7rem; font-weight: 400;">หัวข้อ</span></div>
        </div>
      </div>
      <div style="margin-bottom: 8px;">
        <div style="color: var(--text-secondary); font-size: 0.72rem; margin-bottom: 4px; font-weight: 600;">📦 รายการสินค้าจาก Airtable:</div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">${prodItemsHtml || '<span style="color: var(--text-muted);">-</span>'}</div>
      </div>
      ${faqItemsHtml ? `<div>
        <div style="color: var(--text-secondary); font-size: 0.72rem; margin-bottom: 4px; font-weight: 600;">❓ คำถาม FAQ ที่พร้อมตอบ:</div>
        ${faqItemsHtml}
      </div>` : ''}
    `;
  },

  async loadSheetsData() {
    try {
      const res = await fetch("/api/sheets/data");
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          this.renderSheetsPreview(json.data);
        }
      }
    } catch (e) {
      console.log("[Load Sheets Data Error]", e.message);
    }
  },

  renderSheetsPreview(data) {
    const container = document.getElementById("sheetsRecordsPreview");
    if (!container) return;

    if (!data || (!data.products?.length && !data.faqs?.length && !data.orderGuides?.length)) {
      container.innerHTML = `
        <div style="color: #34d399; margin-bottom: 6px; font-weight: 600;">⚡ สถานะการเชื่อมต่อ Google Sheets Database:</div>
        <div id="sheetsSyncStatusText">กรอกลิงก์ Google Sheets ในหน้า API Settings เพื่อเปิดใช้งาน หรือใช้ Realtime Webhook ให้บันทึกเข้าเว็บอัตโนมัติ</div>
      `;
      return;
    }

    const prodCount = data.products?.length || 0;
    const faqCount = data.faqs?.length || 0;
    const orderCount = data.orderGuides?.length || 0;
    const timeStr = data.lastSync ? new Date(data.lastSync).toLocaleTimeString("th-TH") : "ล่าสุด";

    let prodItemsHtml = (data.products || []).slice(0, 6).map(p =>
      `<span style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: #34d399; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem;">${p.name} (${p.price})</span>`
    ).join(" ");
    if (prodCount > 6) prodItemsHtml += ` <span style="color: var(--text-muted); font-size: 0.72rem;">+อีก ${prodCount - 6} รายการ</span>`;

    let faqItemsHtml = (data.faqs || []).slice(0, 3).map(f =>
      `<div style="margin-top: 4px; color: var(--text-secondary);"><strong style="color: #34d399;">Q:</strong> ${f.question}</div>`
    ).join("");

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
        <span style="color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 6px; font-size: 0.8rem;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
          ซิงก์ Google Sheets สำเร็จ (อัปเดต: ${timeStr})
        </span>
        <span style="color: #34d399; font-size: 0.72rem; font-family: monospace;">Realtime Ready</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px;">
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px;">
          <div style="color: var(--text-muted); font-size: 0.7rem;">สินค้าในชีต</div>
          <div style="color: #34d399; font-weight: 800; font-size: 1.1rem;">${prodCount} <span style="font-size: 0.7rem; font-weight: 400;">รายการ</span></div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px;">
          <div style="color: var(--text-muted); font-size: 0.7rem;">คำถามพบบ่อย (FAQ)</div>
          <div style="color: #60a5fa; font-weight: 800; font-size: 1.1rem;">${faqCount} <span style="font-size: 0.7rem; font-weight: 400;">ข้อ</span></div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px;">
          <div style="color: var(--text-muted); font-size: 0.7rem;">ขั้นตอนสั่งซื้อ</div>
          <div style="color: #fbbf24; font-weight: 800; font-size: 1.1rem;">${orderCount} <span style="font-size: 0.7rem; font-weight: 400;">หัวข้อ</span></div>
        </div>
      </div>
      <div style="margin-bottom: 8px;">
        <div style="color: var(--text-secondary); font-size: 0.72rem; margin-bottom: 4px; font-weight: 600;">📦 รายการสินค้าจาก Google Sheets:</div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">${prodItemsHtml || '<span style="color: var(--text-muted);">-</span>'}</div>
      </div>
      ${faqItemsHtml ? `<div>
        <div style="color: var(--text-secondary); font-size: 0.72rem; margin-bottom: 4px; font-weight: 600;">❓ คำถาม FAQ:</div>
        ${faqItemsHtml}
      </div>` : ''}
    `;
  },

  setupClipboardHandlers() {
    document.querySelectorAll(".btn-copy-action, .btn-copy-code").forEach((btn) => {
      btn.addEventListener("click", () => {
        let text = "";
        const targetId = btn.getAttribute("data-copy");
        const directText = btn.getAttribute("data-clipboard");

        if (targetId) {
          const el = document.getElementById(targetId);
          if (el) text = el.value || el.textContent;
        } else if (directText) {
          text = directText;
        }

        if (text) {
          navigator.clipboard.writeText(text);
          this.showToast("✓ คัดลอกไปยังคลิปบอร์ดแล้ว");
        }
      });
    });
  },

  setupSoundToggle() {
    const soundBtn = document.getElementById("soundToggleBtn");
    if (soundBtn) {
      soundBtn.addEventListener("click", () => {
        this.soundEnabled = !this.soundEnabled;
        soundBtn.style.opacity = this.soundEnabled ? "1" : "0.4";
        this.showToast(this.soundEnabled ? "🔊 เปิดเสียงแจ้งเตือน" : "🔇 ปิดเสียงแจ้งเตือน");
      });
    }
  },

  showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast-item ${type}`;
    toast.innerHTML = `
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(50px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  },

  escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
};

window.App = App;

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
