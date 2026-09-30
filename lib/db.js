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

const DEFAULT_CHANNEL_ID = 'ch_line_default';

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

CREATE TABLE IF NOT EXISTS teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);

CREATE TABLE IF NOT EXISTS channels (
  id         TEXT PRIMARY KEY,
  team_id    INTEGER NOT NULL,
  type       TEXT NOT NULL,
  name       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_channels_team ON channels (team_id);

CREATE TABLE IF NOT EXISTS conversations (
  id               TEXT PRIMARY KEY,
  channel_id       TEXT NOT NULL,
  customer_id      TEXT NOT NULL,
  customer_name    TEXT,
  assigned_user_id INTEGER,
  status           TEXT NOT NULL DEFAULT 'open',
  last_message_at  TEXT NOT NULL,
  FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_pair ON conversations (channel_id, customer_id);
`;

// SQLite has no ADD COLUMN IF NOT EXISTS. Existing installs were created before
// teams existed, so add the new columns once and only when they are missing.
const ADDED_COLUMNS = [
  ['line_chats', 'channel_id', 'TEXT'],
  ['line_chats', 'conversation_id', 'TEXT'],
  ['emails', 'channel_id', 'TEXT'],
  ['emails', 'conversation_id', 'TEXT']
];

function addMissingColumns(sqlite) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

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
    addMissingColumns(this.sqlite);
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
      channelId: msg.channelId || '',
      conversationId: msg.conversationId || '',
      // Migration passes the original timestamp; live messages get "now".
      timestamp: msg.timestamp || new Date().toISOString()
    };
    this.sqlite
      .prepare(
        `INSERT INTO line_chats (id, user_id, user_name, user_avatar, reply_token, text, reply, is_bot, status, channel_id, conversation_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        item.channelId,
        item.conversationId,
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

  deleteLineConversation(userId) {
    this.sqlite.prepare('DELETE FROM line_chats WHERE user_id = ?').run(userId);
    this.sqlite.prepare('DELETE FROM conversations WHERE customer_id = ?').run(userId);
    return { success: true };
  }

  deleteLineMessage(id) {
    this.sqlite.prepare('DELETE FROM line_chats WHERE id = ?').run(id);
    return { success: true };
  }

  deleteEmail(id) {
    this.sqlite.prepare('DELETE FROM emails WHERE id = ?').run(id);
    return { success: true };
  }

  clearAllTestChats() {
    this.sqlite.prepare('DELETE FROM line_chats').run();
    this.sqlite.prepare('DELETE FROM conversations').run();
    this.sqlite.prepare('DELETE FROM emails').run();
    return { success: true };
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

  // ---- teams ----
  createTeam(name) {
    const clean = String(name || '').trim();
    if (!clean) return { error: 'กรุณากรอกชื่อทีม' };
    try {
      const info = this.sqlite
        .prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)')
        .run(clean, new Date().toISOString());
      return { team: { id: Number(info.lastInsertRowid), name: clean, members: [] } };
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return { error: 'ชื่อทีมนี้ถูกใช้แล้ว' };
      return { error: err.message };
    }
  }

  listTeams() {
    return this.sqlite.prepare('SELECT id, name, created_at FROM teams ORDER BY id').all().map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      members: this.getTeamMembers(row.id)
    }));
  }

  getTeamMembers(teamId) {
    return this.sqlite
      .prepare(
        `SELECT u.id, u.username, u.role FROM team_members m
         JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY u.id`
      )
      .all(teamId);
  }

  getUserTeams(userId) {
    return this.sqlite
      .prepare(
        `SELECT t.id, t.name FROM team_members m
         JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.id`
      )
      .all(userId);
  }

  addUserToTeam(teamId, userId) {
    this.sqlite
      .prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)')
      .run(teamId, userId);
    return this.getTeamMembers(teamId);
  }

  removeUserFromTeam(teamId, userId) {
    this.sqlite.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId);
    return this.getTeamMembers(teamId);
  }

  // ---- channels ----
  createChannel({ teamId, type, name, config }) {
    if (!this.sqlite.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)) {
      return { error: 'ไม่พบทีมที่ระบุ' };
    }
    const kind = type === 'email' ? 'email' : 'line';
    const id = 'ch_' + kind + '_' + teamId + '_' + Math.random().toString(36).slice(2, 8);
    this.sqlite
      .prepare('INSERT INTO channels (id, team_id, type, name, config, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, teamId, kind, String(name || kind).trim(), JSON.stringify(config || {}), new Date().toISOString());
    return { channel: this.getChannelById(id) };
  }

  getChannelById(channelId) {
    const row = this.sqlite.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    if (!row) return null;
    let config = {};
    try {
      config = JSON.parse(row.config);
    } catch (e) {
      config = {};
    }
    return { id: row.id, teamId: row.team_id, type: row.type, name: row.name, config, createdAt: row.created_at };
  }

  getChannelsByTeam(teamId) {
    return this.sqlite
      .prepare('SELECT id FROM channels WHERE team_id = ? ORDER BY created_at')
      .all(teamId)
      .map((row) => this.getChannelById(row.id));
  }

  // Every channel of every team the user belongs to. Admins see all of them.
  getChannelsForUser(user) {
    if (!user) return [];
    if (user.role === 'admin') {
      return this.sqlite
        .prepare('SELECT id FROM channels ORDER BY created_at')
        .all()
        .map((row) => this.getChannelById(row.id));
    }
    return this.sqlite
      .prepare(
        `SELECT c.id FROM channels c
         JOIN team_members m ON m.team_id = c.team_id
         WHERE m.user_id = ? ORDER BY c.created_at`
      )
      .all(user.id)
      .map((row) => this.getChannelById(row.id));
  }

  // ---- conversations (chat ownership) ----
  listChannels() {
    return this.sqlite.prepare('SELECT id FROM channels ORDER BY created_at').all().map((r) => this.getChannelById(r.id));
  }

  getConversationsForChannels(channelIds) {
    if (!channelIds || !channelIds.length) return [];
    const marks = channelIds.map(() => '?').join(',');
    return this.sqlite
      .prepare(`SELECT * FROM conversations WHERE channel_id IN (${marks}) ORDER BY last_message_at DESC LIMIT 200`)
      .all(...channelIds)
      .map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        customerId: row.customer_id,
        customerName: row.customer_name || '',
        assignedUserId: row.assigned_user_id === null ? null : row.assigned_user_id,
        status: row.status,
        lastMessageAt: row.last_message_at
      }));
  }

  // Installs that never created a team/channel still need a stable channel id
  // so the webhook and the UI agree on which room a message belongs to.
  defaultChannelId() {
    const existing = this.sqlite
      .prepare("SELECT id FROM channels WHERE type = 'line' ORDER BY created_at LIMIT 1")
      .get();
    return existing ? existing.id : DEFAULT_CHANNEL_ID;
  }

  conversationId(channelId, customerId) {
    return `${channelId}:${customerId}`;
  }

  getConversation(conversationId) {
    const row = this.sqlite.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!row) return null;
    return {
      id: row.id,
      channelId: row.channel_id,
      customerId: row.customer_id,
      customerName: row.customer_name || '',
      // null means nobody owns the room: AI keeps working on it.
      assignedUserId: row.assigned_user_id === null ? null : row.assigned_user_id,
      status: row.status,
      lastMessageAt: row.last_message_at
    };
  }

  ensureConversation(channelId, customerId, customerName, timestamp) {
    const id = this.conversationId(channelId, customerId);
    this.sqlite
      .prepare(
        `INSERT INTO conversations (id, channel_id, customer_id, customer_name, last_message_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_message_at = excluded.last_message_at,
                                       customer_name = COALESCE(NULLIF(excluded.customer_name, ''), conversations.customer_name)`
      )
      .run(id, channelId, customerId, customerName || '', timestamp || new Date().toISOString());
    return this.getConversation(id);
  }

  // Returns { conversation } or { error, takenBy } - callers turn a conflict
  // into 409 so two staff cannot silently claim the same room.
  claimConversation(conversationId, userId) {
    const existing = this.getConversation(conversationId);
    if (!existing) return { error: 'ไม่พบห้องสนทนา' };
    if (existing.assignedUserId === userId) return { conversation: existing };
    if (existing.assignedUserId !== null) return { error: 'ห้องนี้ถูกรับผิดชอบอยู่แล้ว', takenBy: existing.assignedUserId };
    this.sqlite.prepare('UPDATE conversations SET assigned_user_id = ? WHERE id = ?').run(userId, conversationId);
    return { conversation: this.getConversation(conversationId) };
  }

  releaseConversation(conversationId, userId, isAdmin) {
    const existing = this.getConversation(conversationId);
    if (!existing) return { error: 'ไม่พบห้องสนทนา' };
    if (!isAdmin && existing.assignedUserId !== null && existing.assignedUserId !== userId) {
      return { error: 'ไม่ใช่เจ้าของห้องนี้', takenBy: existing.assignedUserId };
    }
    this.sqlite.prepare('UPDATE conversations SET assigned_user_id = NULL WHERE id = ?').run(conversationId);
    return { conversation: this.getConversation(conversationId) };
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
    channelId: row.channel_id || '',
    conversationId: row.conversation_id || '',
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