/**
 * AIZEN RESPONDER - Production Backend Server
 * Express + WebSockets + Real LINE Messaging API + Gmail Integration
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');

const db = require('./lib/db');
const lineService = require('./lib/lineService');
const gmailService = require('./lib/gmailService');
const aiService = require('./lib/aiService');
const airtableService = require('./lib/airtableService');
const googleSheetsService = require('./lib/googleSheetsService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Raw body capture for LINE Webhook signature verification
app.use('/api/webhook/line', express.raw({ type: '*/*' }));

// JSON parser for other API routes
app.use(express.json());

// Serve static frontend assets
app.use(express.static(__dirname));

// Broadcast message to all connected WebSocket clients
function broadcastWs(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected for realtime updates');
  // Send current state on connection
  ws.send(JSON.stringify({
    type: 'init_state',
    data: {
      config: db.getConfig(),
      knowledge: db.getKnowledge(),
      lineChats: db.getLineChats(20)
    }
  }));
});

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

    // Verify signature if secret provided
    const secret = (config.lineChannelSecret || '').trim();
    if (secret && signature && !lineService.validateSignature(rawBody, signature, secret)) {
      console.warn('[LINE Webhook] Signature verification failed! Check Channel Secret in API settings.');
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

app.post('/api/emails/test-connection', async (req, res) => {
  const result = await gmailService.verifyConnection();
  res.json(result);
});


// ==========================================
// 3.2 AIRTABLE DATABASE & RAG ENDPOINTS
// ==========================================
app.post('/api/airtable/sync', async (req, res) => {
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

app.post('/api/airtable/test', async (req, res) => {
  try {
    const { token, baseId, tableId } = req.body;
    const config = db.getConfig();
    const useToken = token || config.airtableApiKey;
    const useBase = baseId || config.airtableBaseId || 'appvGIwch0gFueHpo';
    const useTable = tableId || config.airtableProductTable || 'tblFPwHZuIRWoMEpu';

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
app.post('/api/sheets/sync', async (req, res) => {
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

app.post('/api/sheets/test', async (req, res) => {
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
app.get('/api/sheets/apps-script', (req, res) => {
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
  const conf = { ...db.getConfig() };
  delete conf.adminPin; // Mask admin PIN for staff security
  res.json({
    config: conf,
    knowledge: db.getKnowledge()
  });
});

app.post('/api/config', (req, res) => {
  const { config: newConfig, knowledge: newKnowledge } = req.body;
  if (newConfig) {
    // Don't accidentally overwrite adminPin via general config update unless explicitly passed
    const safeConfig = { ...newConfig };
    if (!safeConfig.adminPin) {
      delete safeConfig.adminPin;
    }
    db.updateConfig(safeConfig);
  }
  if (newKnowledge) db.updateKnowledge(newKnowledge);

  const conf = { ...db.getConfig() };
  delete conf.adminPin;

  broadcastWs({
    type: 'config_updated',
    data: { config: conf, knowledge: db.getKnowledge() }
  });

  res.json({ success: true, config: conf, knowledge: db.getKnowledge() });
});

// ==========================================
// 4.1 ROLE & AUTH / ADMIN PIN SECURITY
// ==========================================
app.post('/api/auth/verify-pin', (req, res) => {
  const { pin } = req.body || {};
  if (!pin) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกรหัส PIN' });
  }
  const isValid = db.verifyAdminPin(pin);
  if (isValid) {
    return res.json({ success: true, role: 'admin' });
  }
  return res.status(401).json({ success: false, error: 'รหัส PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
});

app.post('/api/auth/change-pin', (req, res) => {
  const { oldPin, newPin } = req.body || {};
  if (!db.verifyAdminPin(oldPin)) {
    return res.status(401).json({ success: false, error: 'รหัส PIN เดิมไม่ถูกต้อง' });
  }
  if (!newPin || String(newPin).trim().length < 4) {
    return res.status(400).json({ success: false, error: 'รหัส PIN ใหม่ต้องมีอย่างน้อย 4 ตัวเลข/ตัวอักษร' });
  }
  db.setAdminPin(newPin);
  return res.json({ success: true, message: 'เปลี่ยนรหัส PIN สำเร็จเรียบร้อย' });
});

// ==========================================
// 4.2 OPENAI API TEST ENDPOINT
// ==========================================
app.post('/api/openai/test', async (req, res) => {
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

// Fallback to index.html for single-page routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 AIZEN Production Server running on port ${PORT}`);
  console.log(`🌐 Dashboard UI: http://localhost:${PORT}`);
  console.log(`⚡ Official LINE Webhook: http://localhost:${PORT}/api/webhook/line`);
  console.log(`📡 WebSocket Realtime Stream attached`);
  console.log(`====================================================`);
});
