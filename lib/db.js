/**
 * AIZEN RESPONDER - Database Controller
 * Manages persistent JSON storage for settings, messages, emails, and knowledge base
 */

const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_DIR, 'database.json');

// Default initial database state
const DEFAULT_DATA = {
  config: {
    mode: 'autopilot', // 'autopilot' | 'copilot' | 'manual'
    aiProvider: 'gemini', // 'gemini' | 'openai' | 'smart_nlp'
    geminiApiKey: '',
    geminiModel: 'gemini-1.5-flash',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    lineChannelSecret: '',
    lineAccessToken: '',
    gmailUser: '',
    gmailAppPassword: '',
    webhookDomain: '',
    activeDatabase: 'airtable', // 'airtable' | 'sheets' | 'both'
    autoSyncEnabled: true,
    autoSyncIntervalMinutes: 2,
    googleSheetUrl: '',
    googleSheetProductsGid: '0',
    googleSheetFaqsGid: '',
    googleSheetOrdersGid: '',
    airtableApiKey: '',
    airtableBaseId: 'appvGIwch0gFueHpo',
    airtableProductTable: 'tblFPwHZuIRWoMEpu',
    airtableFaqTable: 'tbllQAiYzuIaS8KOC',
    airtableOrderTable: 'tblYGurp3oPOVs9JH',
    adminPin: '1234'
  },
  knowledge: {
    shopName: 'AIZEN Store & Fashion',
    openingHours: 'เปิดทุกวัน 09:00 - 21:00 น. (ระบบ AI ตอบแชท 24 ชม.)',
    contactInfo: 'โทร 02-999-9999, อีเมล support@aizenstore.com',
    products: '1. Orange Puffer Jacket (เสื้อกันหนาวพองสีส้มพรีเมียม) ไซส์ 36, 38, 40 ราคา $149 (ปกติ $199)\n2. Black Urban Puffer Jacket สีดำมินิมอล ราคา $149\n3. Winter Hoodie Collection ราคาเริ่มต้น $89',
    promotions: 'ซื้อชิ้นใดก็ได้ ส่งฟรีด่วน Flash/EMS ทั่วประเทศ! ใส่โค้ด AIZEN10 ลดเพิ่ม 10% ทันที',
    payment: 'ธนาคารกสิกรไทย 123-4-56789-0 บจก. ไอเซน, บัตรเครดิต, และมีบริการเก็บเงินปลายทาง (COD +30 บาท)',
    delivery: 'กรุงเทพฯ และปริมณฑล 1-2 วันทำการ, ต่างจังหวัด 2-3 วันทำการ, รับเปลี่ยนไซส์ฟรีภายใน 7 วัน',
    persona: 'สุภาพ เป็นมิตร อบอุ่น มีหางเสียง (ครับ/ค่ะ) ให้ข้อมูลสินค้าครบถ้วน ช่วยปิดการขายอย่างนุ่มนวล'
  },
  airtableData: {
    products: [],
    faqs: [],
    orderGuides: [],
    lastSync: null
  },
  sheetsData: {
    products: [],
    faqs: [],
    orderGuides: [],
    lastSync: null
  },
  lineChats: [], // Array of { id, userId, userName, userAvatar, text, reply, isBot, status, timestamp }
  emails: []    // Array of { id, senderName, senderEmail, subject, body, draftReply, status, timestamp }
};

class Database {
  constructor() {
    this.data = { ...DEFAULT_DATA };
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        // Ensure defaults if properties missing
        this.data.config = { ...DEFAULT_DATA.config, ...this.data.config };
        this.data.knowledge = { ...DEFAULT_DATA.knowledge, ...this.data.knowledge };
        if (!Array.isArray(this.data.lineChats)) this.data.lineChats = [];
        if (!Array.isArray(this.data.emails)) this.data.emails = [];
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[DB Init Error]', err.message);
      this.data = { ...DEFAULT_DATA };
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB Save Error]', err.message);
    }
  }

  getConfig() {
    return this.data.config;
  }

  verifyAdminPin(pin) {
    const currentPin = this.data.config.adminPin || '1234';
    return String(pin).trim() === String(currentPin).trim();
  }

  setAdminPin(newPin) {
    this.data.config.adminPin = String(newPin).trim();
    this.save();
    return true;
  }

  updateConfig(newConfig) {
    this.data.config = { ...this.data.config, ...newConfig };
    this.save();
    return this.data.config;
  }

  getKnowledge() {
    return this.data.knowledge;
  }

  updateKnowledge(newKb) {
    this.data.knowledge = { ...this.data.knowledge, ...newKb };
    this.save();
    return this.data.knowledge;
  }

  saveKnowledge(newKb) {
    return this.updateKnowledge(newKb);
  }

  // LINE Chat Methods
  addLineMessage(msg) {
    const item = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      userId: msg.userId || 'anonymous',
      userName: msg.userName || 'LINE Customer',
      userAvatar: msg.userAvatar || '',
      replyToken: msg.replyToken || '',
      text: msg.text || '',
      reply: msg.reply || '',
      isBot: Boolean(msg.isBot),
      status: msg.status || 'delivered', // 'pending_approval' | 'delivered' | 'failed'
      timestamp: new Date().toISOString()
    };
    this.data.lineChats.unshift(item);
    if (this.data.lineChats.length > 200) this.data.lineChats.pop();
    this.save();
    return item;
  }

  getLineChats(limit = 50) {
    return this.data.lineChats.slice(0, limit);
  }

  updateLineMessage(id, updates) {
    const msg = this.data.lineChats.find(m => m.id === id);
    if (msg) {
      Object.assign(msg, updates);
      this.save();
    }
    return msg;
  }

  // Email Methods
  addEmail(email) {
    const item = {
      id: 'em_' + Date.now(),
      senderName: email.senderName || 'Anonymous',
      senderEmail: email.senderEmail || '',
      subject: email.subject || 'No Subject',
      body: email.body || '',
      draftReply: email.draftReply || '',
      status: email.status || 'unread', // 'unread' | 'replied' | 'draft'
      timestamp: new Date().toISOString()
    };
    this.data.emails.unshift(item);
    this.save();
    return item;
  }

  getEmails() {
    return this.data.emails;
  }

  updateEmail(id, updates) {
    const item = this.data.emails.find(e => e.id === id);
    if (item) {
      Object.assign(item, updates);
      this.save();
    }
    return item;
  }

  // Airtable Data Methods
  getAirtableData() {
    return this.data.airtableData || { products: [], faqs: [], orderGuides: [], lastSync: null };
  }

  saveAirtableData(airtableData) {
    this.data.airtableData = airtableData;
    this.save();
    return this.data.airtableData;
  }

  // Google Sheets Data Methods
  getSheetsData() {
    return this.data.sheetsData || { products: [], faqs: [], orderGuides: [], lastSync: null };
  }

  saveSheetsData(sheetsData) {
    this.data.sheetsData = sheetsData;
    this.save();
    return this.data.sheetsData;
  }
}

module.exports = new Database();
