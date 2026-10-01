import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { db, initDatabase } from './lib/db.js';
import { parseSlipOrInvoice } from './lib/vision.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3001;

initDatabase();

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // Dashboard Summary API
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    const income = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type='income' AND status='verified'").get();
    const expense = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type='expense' AND status='verified'").get();
    const pending = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE status='pending'").get();

    return sendJson(res, 200, {
      income: income.total,
      expense: expense.total,
      net: income.total - expense.total,
      pendingCount: pending.count,
      pendingTotal: pending.total
    });
  }

  // List Transactions
  if (req.method === 'GET' && url.pathname === '/api/transactions') {
    const status = url.searchParams.get('status') || 'all';
    let query = 'SELECT t.*, c.name as category_name FROM transactions t LEFT JOIN categories c ON t.category_id = c.id';
    let params = [];

    if (status !== 'all') {
      query += ' WHERE t.status = ?';
      params.push(status);
    }
    query += ' ORDER BY t.created_at DESC LIMIT 100';

    const rows = db.prepare(query).all(...params);
    return sendJson(res, 200, rows);
  }

  // Webhook for ai-chat / External upload
  if (req.method === 'POST' && url.pathname === '/api/webhook/slip') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { imageBase64, mimeType = 'image/jpeg', source = 'ai-chat', sourceRefId, provider } = payload;

        if (!imageBase64) {
          return sendJson(res, 400, { error: 'imageBase64 is required' });
        }

        const buffer = Buffer.from(imageBase64, 'base64');
        const activeProvider = provider || process.env.AI_VISION_PROVIDER || 'gemini';

        // Parse with selected Vision engine
        const parsed = await parseSlipOrInvoice({
          imageBuffer: buffer,
          mimeType,
          provider: activeProvider
        });

        // Check duplicate reference
        if (parsed.reference_no) {
          const existing = db.prepare('SELECT id FROM transactions WHERE reference_no = ?').get(parsed.reference_no);
          if (existing) {
            return sendJson(res, 409, { error: 'Duplicate transaction (สลิปนี้เคยบันทึกแล้ว)', reference_no: parsed.reference_no });
          }
        }

        const isIncome = parsed.doc_type === 'slip' || parsed.doc_type === 'receipt';
        const type = isIncome ? 'income' : 'expense';

        const insert = db.prepare(`
          INSERT INTO transactions (type, amount, status, reference_no, description, source, source_ref_id, raw_ai_payload)
          VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
        `);

        const result = insert.run(
          type,
          parsed.amount || 0,
          parsed.reference_no || null,
          `สแกนจาก ${activeProvider}: ${parsed.sender_name || ''} -> ${parsed.receiver_name || parsed.vendor_name || ''}`,
          source,
          sourceRefId || null,
          JSON.stringify(parsed)
        );

        return sendJson(res, 201, {
          success: true,
          transaction_id: Number(result.lastInsertRowid),
          parsed
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  // Confirm/Verify transaction (Human-in-the-loop)
  if (req.method === 'POST' && url.pathname.startsWith('/api/transactions/') && url.pathname.endsWith('/verify')) {
    const parts = url.pathname.split('/');
    const id = parts[3];

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const update = db.prepare(`
          UPDATE transactions
          SET status = 'verified',
              amount = COALESCE(?, amount),
              verified_by = ?,
              verified_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        update.run(payload.amount || null, payload.verified_by || 'admin', id);
        return sendJson(res, 200, { success: true, id });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  // Reject transaction
  if (req.method === 'POST' && url.pathname.startsWith('/api/transactions/') && url.pathname.endsWith('/reject')) {
    const parts = url.pathname.split('/');
    const id = parts[3];
    const update = db.prepare("UPDATE transactions SET status = 'rejected' WHERE id = ?");
    update.run(id);
    return sendJson(res, 200, { success: true, id });
  }

  // Static files / Dashboard HTML
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const htmlPath = path.resolve(__dirname, 'public/index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(htmlPath).pipe(res);
    }
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, () => {
  console.log(`[ai-Account] Server running on http://localhost:${PORT}`);
});
