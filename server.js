/**
 * AIZEN RESPONDER - Production Backend Server
 * Express + WebSockets + Real LINE Messaging API + Gmail Integration
 */

const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dependency). Existing process.env always wins.
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
})();

const express = require('express');
const http = require('http');
const next = require('next');
const WebSocket = require('ws');

const db = require('./lib/db');
const auth = require('./lib/auth');
const lineService = require('./lib/lineService');
const gmailService = require('./lib/gmailService');
const aiService = require('./lib/aiService');
const airtableService = require('./lib/airtableService');
const googleSheetsService = require('./lib/googleSheetsService');

const PORT = process.env.PORT || 3000;

// Next.js serves the React UI; Express keeps owning /api/* + LINE/SMTP integrations.
const dev = !(process.argv.includes('--prod') || process.env.NODE_ENV === 'production');
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();
// getUpgradeHandler() requires prepare() first — resolved in start().
let handleUpgrade = null;

const app = express();
const server = http.createServer(app);

// WebSocket lives on /ws only (noServer) so Next dev HMR keeps its own upgrade path.
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (e) {
    pathname = '';
  }
  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (handleUpgrade) {
    handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// Raw body capture for LINE Webhook signature verification
app.use('/api/webhook/line', express.raw({ type: '*/*' }));

// JSON parser for other API routes
app.use(express.json());

// Broadcast message to all connected WebSocket clients
function broadcastWs(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws, req) => {
  const cookies = auth.parseCookies(req.headers.cookie);
  const user = auth.getSessionUser(cookies[auth.SESSION_COOKIE]);
  if (!user) {
    // Same-origin browser sockets send the session cookie automatically, so an
    // unauthenticated socket means someone without a valid account.
    ws.close(4401, 'authentication required');
    return;
  }
  console.log(`[WebSocket] ${user.username} connected for realtime updates`);
  // Send current state on connection
  ws.send(JSON.stringify({
    type: 'init_state',
    data: {
      config: redactConfig(db.getConfig()),
      knowledge: db.getKnowledge(),
      lineChats: db.getLineChats(20)
    }
  }));
});

// ==========================================
// 0. AUTHENTICATION MIDDLEWARE
// ==========================================

// Webhooks are called by LINE and Google, not by a logged-in browser, so they
// authenticate by their own signature checks instead of a session cookie.
const PUBLIC_API_PATHS = new Set([
  '/api/auth/setup-status',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/webhook/line',
  '/api/webhook/sheets'
]);

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();

  const cookies = auth.parseCookies(req.headers.cookie);
  const user = auth.getSessionUser(cookies[auth.SESSION_COOKIE]);
  req.user = user;

  if (!user && !PUBLIC_API_PATHS.has(req.path)) {
    return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  next();
});

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'ต้องใช้สิทธิ์ผู้ดูแลระบบ' });
  }
  next();
}

// Credentials never leave the server. The UI gets a masked hint instead.
const SECRET_FIELDS = [
  'lineAccessToken',
  'lineChannelSecret',
  'gmailAppPassword',
  'geminiApiKey',
  'openaiApiKey',
  'airtableApiKey'
];
const MASK_PREFIX = '<set>';

function maskValue(value) {
  const str = String(value || '');
  if (!str) return '';
  return `${MASK_PREFIX}${str.slice(-4)}`;
}

function redactConfig(config) {
  const out = { ...config };
  for (const field of SECRET_FIELDS) {
    if (field in out) out[field] = maskValue(out[field]);
  }
  return out;
}

// A masked value coming back from the browser means "unchanged" - writing it
// verbatim would replace the real token with the literal mask string.
function stripMaskedSecrets(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (SECRET_FIELDS.includes(key) && String(value).startsWith(MASK_PREFIX)) continue;
    out[key] = value;
  }
  return out;
}

// ==========================================
// 1. LINE WEBHOOK ENDPOINT
// ==========================================
app.all('/api/webhook/line', async (req, res) => {
  // Always return 200 OK immediately as required by LINE Developers Console
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });

  if (req.method !== 'POST') return;

  try {
    let rawBody = '';
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf-8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else if (req.body && typeof req.body === 'object') {
      rawBody = JSON.stringify(req.body);
    }

    const signature = req.headers['x-line-signature'] || '';
    const config = db.getConfig();

    console.log(`[LINE Webhook Event Received] Size: ${rawBody.length} bytes, Signature: ${signature ? 'Present' : 'None'}`);

    if (!lineService.validateSignature(rawBody, signature, (config.lineChannelSecret || '').trim())) {
      console.warn('[LINE Webhook] Signature verification failed — request dropped. Check Channel Secret in Settings.');
      return;
    }

    const payload = JSON.parse(rawBody || '{}');
    const eventsCount = Array.isArray(payload.events) ? payload.events.length : 0;
    console.log(`[LINE Webhook Parsed] Events Count: ${eventsCount}`);

    await lineService.handleWebhook(payload, broadcastWs);
  } catch (err) {
    console.error('[LINE Webhook Handler Error]', err.message);
  }
});

// ==========================================
// 2. LINE CHAT MANAGEMENT API
// ==========================================
app.get('/api/line/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ success: true, messages: db.getLineChats(limit) });
});

app.post('/api/line/reply', handleLineSend);
app.post('/api/line/send', handleLineSend);

async function handleLineSend(req, res) {
  try {
    const { userId, replyToken, text, messageId } = req.body;
    const config = db.getConfig();

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const cleanText = text.trim();
    let delivered = false;

    // 1. If valid LINE userId provided, send directly via Push Message (instant & reliable)
    if (config.lineAccessToken && userId && userId.startsWith('U')) {
      console.log(`[LINE Dispatch] Sending Push Message to user: ${userId}`);
      delivered = await lineService.sendPushMessage(userId, cleanText, config.lineAccessToken);
    }
    // 2. Fallback to Reply Token if present
    else if (config.lineAccessToken && replyToken) {
      console.log(`[LINE Dispatch] Sending Reply Message via token: ${replyToken}`);
      delivered = await lineService.sendReply(replyToken, cleanText, config.lineAccessToken);
    }

    if (messageId) {
      db.updateLineMessage(messageId, { status: delivered ? 'delivered' : 'sent', reply: cleanText });
    }

    const botMsg = db.addLineMessage({
      userId: userId || 'admin',
      userName: db.getKnowledge().shopName,
      text: cleanText,
      isBot: true,
      status: delivered ? 'delivered' : (config.lineAccessToken ? 'sent' : 'simulated')
    });

    broadcastWs({
      type: 'line_message_delivered',
      data: { botMsg }
    });

    res.json({ success: true, delivered, botMsg });
  } catch (err) {
    console.error('[LINE Dispatch Error]', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ==========================================
// 3. GMAIL API & REAL EMAIL SENDING
// ==========================================
app.get('/api/emails', (req, res) => {
  res.json({ success: true, emails: db.getEmails() });
});

app.post('/api/emails/send', async (req, res) => {
  try {
    const { to, subject, text } = req.body;
    if (!to || !text) {
      return res.status(400).json({ error: 'Recipient (to) and message text are required' });
    }

    const result = await gmailService.sendEmail({ to, subject, text });
    broadcastWs({
      type: 'email_sent',
      data: { to, subject, timestamp: new Date().toISOString() }
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/emails/test-connection', requireAdmin, async (req, res) => {
  const result = await gmailService.verifyConnection();
  res.json(result);
});


// ==========================================
// 3.2 AIRTABLE DATABASE & RAG ENDPOINTS
// ==========================================
app.post('/api/airtable/sync', requireAdmin, async (req, res) => {
  try {
    const result = await airtableService.syncToKnowledge();
    if (result.success) {
      broadcastWs({
        type: 'airtable_synced',
        data: {
          knowledge: db.getKnowledge(),
          airtableData: db.getAirtableData()
        }
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/airtable/test', requireAdmin, async (req, res) => {
  try {
    const { token, baseId, tableId } = req.body;
    const config = db.getConfig();
    const useToken = token || config.airtableApiKey;
    const useBase = baseId || config.airtableBaseId;
    const useTable = tableId || config.airtableProductTable;

    if (!useToken || !useBase || !useTable) {
      return res.json({
        success: false,
        message: 'กรุณาตั้งค่า Airtable API Key, Base ID และ Table ID ในหน้าตั้งค่าก่อนทดสอบ'
      });
    }

    const result = await airtableService.testConnection(useToken, useBase, useTable);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/airtable/data', (req, res) => {
  res.json({
    success: true,
    data: db.getAirtableData()
  });
});

// ==========================================
// 3.3 GOOGLE SHEETS DATABASE & REALTIME WEBHOOK
// ==========================================
app.post('/api/sheets/sync', requireAdmin, async (req, res) => {
  try {
    const { url } = req.body || {};
    const result = await googleSheetsService.syncToKnowledge(url);
    if (result.success) {
      broadcastWs({
        type: 'sheets_synced',
        data: {
          knowledge: db.getKnowledge(),
          sheetsData: db.getSheetsData()
        }
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sheets/test', requireAdmin, async (req, res) => {
  try {
    const { url, gid } = req.body || {};
    const config = db.getConfig();
    const useUrl = url || config.googleSheetUrl;
    const result = await googleSheetsService.testConnection(useUrl, gid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/sheets/data', (req, res) => {
  res.json({
    success: true,
    data: db.getSheetsData()
  });
});

// Realtime Webhook for Google Apps Script
app.post('/api/webhook/sheets', async (req, res) => {
  try {
    const result = await googleSheetsService.handleWebhookEvent(req.body || {});
    broadcastWs({
      type: 'sheets_synced',
      data: {
        knowledge: db.getKnowledge(),
        sheetsData: db.getSheetsData(),
        realtime: true
      }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to get Apps Script template
app.get('/api/sheets/apps-script', requireAdmin, (req, res) => {
  const config = db.getConfig();
  const domain = config.webhookDomain ? config.webhookDomain.replace(/\/api\/webhook\/line$/, '') : `http://localhost:${PORT}`;
  const scriptUrl = `${domain}/api/webhook/sheets`;
  res.json({
    success: true,
    webhookUrl: scriptUrl,
    script: googleSheetsService.getAppsScriptTemplate(scriptUrl)
  });
});

// Auto-Sync Background Scheduler (every 2 minutes)
setInterval(async () => {
  try {
    const config = db.getConfig();
    if (!config.autoSyncEnabled) return;

    if (config.activeDatabase === 'airtable' || config.activeDatabase === 'both') {
      if (config.airtableApiKey) {
        const res = await airtableService.syncToKnowledge();
        if (res.success) {
          broadcastWs({
            type: 'airtable_synced',
            data: { knowledge: db.getKnowledge(), airtableData: db.getAirtableData(), auto: true }
          });
        }
      }
    }

    if (config.activeDatabase === 'sheets' || config.activeDatabase === 'both') {
      if (config.googleSheetUrl) {
        const res = await googleSheetsService.syncToKnowledge();
        if (res.success) {
          broadcastWs({
            type: 'sheets_synced',
            data: { knowledge: db.getKnowledge(), sheetsData: db.getSheetsData(), auto: true }
          });
        }
      }
    }
  } catch (err) {
    console.warn('[AutoSync Background Poll Error]', err.message);
  }
}, (2 * 60 * 1000));

// ==========================================
// 4. CONFIGURATION & KNOWLEDGE BASE
// ==========================================
app.get('/api/config', (req, res) => {
  res.json({
    config: redactConfig(db.getConfig()),
    knowledge: db.getKnowledge()
  });
});

app.post('/api/config', requireAdmin, (req, res) => {
  const { config: newConfig, knowledge: newKnowledge } = req.body || {};
  if (newConfig) {
    db.updateConfig(stripMaskedSecrets(newConfig));
  }
  if (newKnowledge) db.updateKnowledge(newKnowledge);

  const conf = redactConfig(db.getConfig());

  broadcastWs({
    type: 'config_updated',
    data: { config: conf, knowledge: db.getKnowledge() }
  });

  res.json({ success: true, config: conf, knowledge: db.getKnowledge() });
});

// ==========================================
// 4.1 ACCOUNTS, SESSIONS & PERMISSIONS
// ==========================================
app.get('/api/auth/setup-status', (req, res) => {
  res.json({ success: true, needsSetup: auth.countUsers() === 0 });
});

// First-run only. Once any account exists this endpoint is permanently closed,
// so nobody can register a second admin over the network.
app.post('/api/auth/setup', (req, res) => {
  // An install is claimed the moment it serves its first request. Checking this
  // BEFORE the database is opened by getUserByUsername race is not possible, so
  // this is the primary gate: if any account already exists, refuse outright.
  if (auth.countUsers() > 0) {
    return res.status(409).json({ success: false, error: 'ระบบได้ตั้งค่าผู้ดูแลระบบแล้ว' });
  }

  const { username, password, confirmPassword, shopName, openingHours, contactInfo, persona } = req.body || {};
  if (!shopName || !String(shopName).trim()) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกชื่อร้าน/องค์กร' });
  }
  // The wizard confirms the password twice. A client that does not send the
  // confirmation at all is rejected rather than silently trusted.
  if (confirmPassword !== undefined && confirmPassword !== password) {
    return res.status(400).json({ success: false, error: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' });
  }

  // Two simultaneous setup requests could otherwise both see "no users" and
  // create two admins; the UNIQUE constraint aborts the second insert.
  let created;
  try {
    created = auth.createUser(username, password, 'admin');
  } catch (err) {
    return res.status(409).json({ success: false, error: 'ระบบได้ตั้งค่าผู้ดูแลระบบแล้ว' });
  }
  if (created.error) {
    const taken = String(created.error).includes('ถูกใช้แล้ว');
    return res.status(taken ? 409 : 400).json({ success: false, error: created.error });
  }

  db.updateKnowledge({
    shopName: String(shopName).trim(),
    openingHours: openingHours || '',
    contactInfo: contactInfo || '',
    persona: persona || db.getKnowledge().persona
  });

  const session = auth.createSession(created.user.id);
  auth.setSessionCookie(req, res, session.token, session.expiresAt);
  res.json({ success: true, user: created.user });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = auth.authenticate(username, password);
  if (!user) {
    return res.status(401).json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  const session = auth.createSession(user.id);
  auth.setSessionCookie(req, res, session.token, session.expiresAt);
  res.json({ success: true, user });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.user) auth.deleteSession(req.user.sessionToken);
  auth.clearSessionCookie(req, res);
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  // Never echo the session token back - it is the credential, and the browser
  // only ever needs to know WHO it is. This route doubles as the 401 probe the
  // client uses to detect an expired session, so it must never set a cookie.
  const { sessionToken, expiresAt, ...user } = req.user;
  res.json({ success: true, user });
});

app.post('/api/auth/change-password', (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const result = auth.changePassword(req.user.id, oldPassword, newPassword);
  if (result.error) {
    return res.status(400).json({ success: false, error: result.error });
  }
  auth.clearSessionCookie(req, res);
  res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่' });
});

app.get('/api/auth/users', requireAdmin, (req, res) => {
  res.json({ success: true, users: auth.listUsers() });
});

app.post('/api/auth/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  const result = auth.createUser(username, password, role === 'admin' ? 'admin' : 'staff');
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, user: result.user });
});

app.delete('/api/auth/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'รหัสผู้ใช้ไม่ถูกต้อง' });
  if (id === req.user.id) {
    return res.status(400).json({ success: false, error: 'ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่' });
  }
  const admins = auth.listUsers().filter((u) => u.role === 'admin');
  const target = auth.getUserById(id);
  if (!target) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้' });
  if (target.role === 'admin' && admins.length <= 1) {
    return res.status(400).json({ success: false, error: 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 บัญชี' });
  }
  auth.deleteSessionsForUser(id);
  db.sqlite.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

// ==========================================
// 4.2 OPENAI API TEST ENDPOINT
// ==========================================
app.post('/api/openai/test', requireAdmin, async (req, res) => {
  try {
    const { apiKey, model } = req.body || {};
    const config = db.getConfig();
    const useKey = apiKey || config.openaiApiKey;
    const useModel = model || config.openaiModel || 'gpt-4o-mini';
    const result = await aiService.testOpenAIConnection(useKey, useModel);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 5. TEST CONNECTIVITY & STATUS
// ==========================================
app.get('/api/status', (req, res) => {
  const config = db.getConfig();
  res.json({
    status: 'online',
    lineConnected: Boolean(config.lineAccessToken),
    gmailConfigured: Boolean(config.gmailUser && config.gmailAppPassword),
    geminiConfigured: Boolean(config.geminiApiKey),
    openaiConfigured: Boolean(config.openaiApiKey),
    aiProvider: config.aiProvider || 'gemini',
    mode: config.mode,
    timestamp: new Date().toISOString()
  });
});

// Everything that is not /api/* goes to Next.js (no static serving of the project root,
// so data/, lib/, server.js and dotfiles are never exposed as files).
app.use((req, res) => {
  handle(req, res);
});

async function start() {
  await nextApp.prepare();
  handleUpgrade = nextApp.getUpgradeHandler();
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 AIZEN server running on port ${PORT} (${dev ? 'dev' : 'production'} mode)`);
    console.log(`🌐 Dashboard UI: http://localhost:${PORT}`);
    console.log(`⚡ Official LINE Webhook: http://localhost:${PORT}/api/webhook/line`);
    console.log(`📡 WebSocket Realtime Stream: ws://localhost:${PORT}/ws`);
    console.log(`====================================================`);
  });
}

start().catch((err) => {
  console.error('[Startup Error]', err);
  process.exit(1);
});
