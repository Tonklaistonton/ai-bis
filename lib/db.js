/**
 * AIZEN RESPONDER - Storage Controller (SQLite via node:sqlite)
 *
 * Keeps the exact public API the rest of the codebase already calls, but stores
 * data in a real SQLite file instead of rewriting a whole JSON blob per message.
 *
 * IMPORTANT: every read returns a FRESH object parsed from the database. Never
 * hold on to a returned object across requests - call save*() to persist changes.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(__dirname, '..', 'data', 'aizen.db');

// Ship-shape defaults. No demo shop, no contact details, no vendor-specific IDs —
// every customer installs this and fills in their own details in the setup wizard.
const DEFAULT_CONFIG = {
  mode: 'copilot',
  aiProvider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  lineChannelSecret: '',
  lineAccessToken: '',
  gmailUser: '',
  gmailAppPassword: '',
  webhookDomain: '',
  activeDatabase: 'airtable',
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 2,
  googleSheetUrl: '',
  googleSheetProductsGid: '0',
  googleSheetFaqsGid: '',
  googleSheetOrdersGid: '',
  airtableApiKey: '',
  airtableBaseId: '',
  airtableProductTable: '',
  airtableFaqTable: '',
  airtableOrderTable: ''
};

const DEFAULT_KNOWLEDGE = {
  shopName: '',
  openingHours: '',
  contactInfo: '',
  products: '',
  promotions: '',
  payment: '',
  delivery: '',
  persona: 'สุภาพ เป็นมิตร อบอุ่น มีหางเสียง (ครับ/ค่ะ) ให้ข้อมูลสินค้าครบถ้วน และไม่กุผิดข้อมูลที่ไม่มีในระบบ'
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  scope TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS line_chats (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  user_name    TEXT,
  user_avatar  TEXT,
  reply_token  TEXT,
  text         TEXT,
  reply        TEXT,
  is_bot       INTEGER NOT NULL DEFAULT 0,
  status       TEXT,
  timestamp    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_line_chats_ts ON line_chats (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_line_chats_user ON line_chats (user_id, timestamp DESC);
CREATE TABLE IF NOT EXISTS emails (
  id          TEXT PRIMARY KEY,
  sender_name TEXT,
  sender_email TEXT,
  subject     TEXT,
  body        TEXT,
  draft_reply TEXT,
  status      TEXT,
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emails_ts ON emails (timestamp DESC);
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);
`;

function emptySyncCache() {
  return { products: [], faqs: [], orderGuides: [], lastSync: null };
}

// Secrets can be supplied by environment instead of the database, so a customer
// can keep them out of the file they back up. No dependency needed - Node reads
// .env into process.env before this module loads.
const ENV_OVERRIDES = {
  lineAccessToken: 'LINE_ACCESS_TOKEN',
  lineChannelSecret: 'LINE_CHANNEL_SECRET',
  gmailAppPassword: 'GMAIL_APP_PASSWORD',
  geminiApiKey: 'GEMINI_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
  airtableApiKey: 'AIRTABLE_API_KEY'
};

function applyEnvOverrides(config) {
  for (const [key, envName] of Object.entries(ENV_OVERRIDES)) {
    const value = process.env[envName];
    if (value) config[key] = value;
  }
  return config;
}

class Database {
  constructor() {
    this.sqlite = null;
    this.isNewInstall = !fs.existsSync(DB_FILE);
    this.open();
    if (this.isNewInstall) {
      const { migrateLegacyJson } = require('./migrate');
      const result = migrateLegacyJson(this);
      if (result.migrated) {
        console.log(
          `[Migration] Imported legacy database.json → SQLite (${result.chats} chats, ${result.emails} emails). Original kept as database.json.migrated.json`
        );
      }
    }
  }

  open() {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    this.sqlite = new DatabaseSync(DB_FILE);
    this.sqlite.exec('PRAGMA journal_mode = WAL');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    this.sqlite.exec(SCHEMA);
  }

  // ---- key/value helpers (config + knowledge + synced caches) ----
  readKv(scope) {
    const rows = this.sqlite.prepare('SELECT key, value FROM kv WHERE scope = ?').all(scope);
    const out = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch (e) {
        console.error(`[DB] Corrupt value at ${scope}.${row.key}, skipping`);
      }
    }
    return out;
  }

  writeKv(scope, obj) {
    const stmt = this.sqlite.prepare(
      'INSERT INTO kv (scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value'
    );
    // Nest-safe: reuse an open transaction instead of throwing on a second BEGIN.
    const alreadyInTransaction = this.sqlite.isTransaction;
    if (!alreadyInTransaction) this.sqlite.exec('BEGIN');
    try {
      for (const [key, value] of Object.entries(obj)) {
        stmt.run(scope, key, JSON.stringify(value ?? null));
      }
      if (!alreadyInTransaction) this.sqlite.exec('COMMIT');
    } catch (err) {
      if (!alreadyInTransaction) this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- config ----
  getConfig() {
    return applyEnvOverrides({ ...DEFAULT_CONFIG, ...this.readKv('config') });
  }

  updateConfig(newConfig) {
    if (newConfig && typeof newConfig === 'object') {
      this.writeKv('config', newConfig);
    }
    return this.getConfig();
  }

  // ---- knowledge base ----
  getKnowledge() {
    return { ...DEFAULT_KNOWLEDGE, ...this.readKv('knowledge') };
  }

  updateKnowledge(newKb) {
    if (newKb && typeof newKb === 'object') {
      this.writeKv('knowledge', newKb);
    }
    return this.getKnowledge();
  }

  saveKnowledge(newKb) {
    return this.updateKnowledge(newKb);
  }

  // ---- LINE chats ----
  addLineMessage(msg) {
    const item = {
      id: msg.id || 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      userId: msg.userId || 'anonymous',
      userName: msg.userName || 'LINE Customer',
      userAvatar: msg.userAvatar || '',
      replyToken: msg.replyToken || '',
      text: msg.text || '',
      reply: msg.reply || '',
      isBot: Boolean(msg.isBot),
      status: msg.status || 'delivered',
      // Migration passes the original timestamp; live messages get "now".
      timestamp: msg.timestamp || new Date().toISOString()
    };
    this.sqlite
      .prepare(
        `INSERT INTO line_chats (id, user_id, user_name, user_avatar, reply_token, text, reply, is_bot, status, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.userId,
        item.userName,
        item.userAvatar,
        item.replyToken,
        item.text,
        item.reply,
        item.isBot ? 1 : 0,
        item.status,
        item.timestamp
      );
    this.trimTable('line_chats', 'id', 'timestamp', 200);
    return item;
  }

  getLineChats(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const rows = this.sqlite
      .prepare('SELECT * FROM line_chats ORDER BY timestamp DESC LIMIT ?')
      .all(safeLimit);
    return rows.map(rowToChat);
  }

  getLineMessagesByUser(userId, limit = 200) {
    const rows = this.sqlite
      .prepare('SELECT * FROM line_chats WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(userId, limit);
    return rows.map(rowToChat);
  }

  updateLineMessage(id, updates) {
    const existing = this.sqlite.prepare('SELECT * FROM line_chats WHERE id = ?').get(id);
    if (!existing) return null;
    const merged = { ...rowToChat(existing), ...updates };
    this.sqlite
      .prepare(
        'UPDATE line_chats SET user_name = ?, user_avatar = ?, reply_token = ?, text = ?, reply = ?, is_bot = ?, status = ? WHERE id = ?'
      )
      .run(
        merged.userName,
        merged.userAvatar,
        merged.replyToken,
        merged.text,
        merged.reply,
        merged.isBot ? 1 : 0,
        merged.status,
        id
      );
    return merged;
  }

  // ---- emails ----
  addEmail(email) {
    const item = {
      id: email.id || 'em_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      senderName: email.senderName || 'Anonymous',
      senderEmail: email.senderEmail || '',
      subject: email.subject || 'No Subject',
      body: email.body || '',
      draftReply: email.draftReply || '',
      status: email.status || 'unread',
      timestamp: email.timestamp || new Date().toISOString()
    };
    this.sqlite
      .prepare(
        `INSERT INTO emails (id, sender_name, sender_email, subject, body, draft_reply, status, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.senderName,
        item.senderEmail,
        item.subject,
        item.body,
        item.draftReply,
        item.status,
        item.timestamp
      );
    this.trimTable('emails', 'id', 'timestamp', 200);
    return item;
  }

  getEmails() {
    return this.sqlite.prepare('SELECT * FROM emails ORDER BY timestamp DESC LIMIT 200').all().map(rowToEmail);
  }

  updateEmail(id, updates) {
    const existing = this.sqlite.prepare('SELECT * FROM emails WHERE id = ?').get(id);
    if (!existing) return null;
    const merged = { ...rowToEmail(existing), ...updates };
    this.sqlite
      .prepare(
        'UPDATE emails SET sender_name = ?, sender_email = ?, subject = ?, body = ?, draft_reply = ?, status = ? WHERE id = ?'
      )
      .run(merged.senderName, merged.senderEmail, merged.subject, merged.body, merged.draftReply, merged.status, id);
    return merged;
  }

  // ---- synced product database caches ----
  getAirtableData() {
    return { ...emptySyncCache(), ...(this.readKv('airtable_data').main || {}) };
  }

  saveAirtableData(data) {
    const cache = data || emptySyncCache();
    this.writeKv('airtable_data', { main: cache });
    return cache;
  }

  getSheetsData() {
    return { ...emptySyncCache(), ...(this.readKv('sheets_data').main || {}) };
  }

  saveSheetsData(data) {
    const cache = data || emptySyncCache();
    this.writeKv('sheets_data', { main: cache });
    return cache;
  }

  // Keep history bounded so the database file cannot grow without limit.
  // Trims by primary key (unique) using the given ordering column, so rows
  // sharing a timestamp can never be deleted by mistake.
  trimTable(table, idColumn, orderColumn, keep) {
    this.sqlite
      .prepare(
        `DELETE FROM ${table} WHERE ${idColumn} NOT IN (
           SELECT ${idColumn} FROM ${table} ORDER BY ${orderColumn} DESC LIMIT ?
         )`
      )
      .run(keep);
  }

  close() {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
    }
  }
}

function rowToChat(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userAvatar: row.user_avatar,
    replyToken: row.reply_token,
    text: row.text,
    reply: row.reply,
    isBot: Boolean(row.is_bot),
    status: row.status,
    timestamp: row.timestamp
  };
}

function rowToEmail(row) {
  return {
    id: row.id,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    subject: row.subject,
    body: row.body,
    draftReply: row.draft_reply,
    status: row.status,
    timestamp: row.timestamp
  };
}

module.exports = new Database();
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
module.exports.DEFAULT_KNOWLEDGE = DEFAULT_KNOWLEDGE;
module.exports.DB_FILE = DB_FILE;