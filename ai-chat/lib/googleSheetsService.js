/**
 * AIZEN PRO - Google Sheets Database & Auto-Sync Service
 * Connects directly to Google Sheets (Public CSV Export / Apps Script Realtime Webhook)
 */

const db = require('./db');

class GoogleSheetsService {
  /**
   * Extract Google Spreadsheet ID from URL or ID string
   */
  extractSheetId(urlOrId) {
    if (!urlOrId) return null;
    const clean = urlOrId.trim();
    const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) return match[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(clean)) return clean;
    return null;
  }

  /**
   * Extract gid from URL if present
   */
  extractGid(url) {
    if (!url) return '0';
    const match = url.match(/[#&?]gid=([0-9]+)/);
    return match ? match[1] : '0';
  }

  /**
   * Robust CSV Parser handling quotes, commas, and newlines
   */
  parseCsv(csvText) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuote = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"') {
        if (insideQuote && nextChar === '"') {
          currentCell += '"';
          i++; // skip escaped quote
        } else {
          insideQuote = !insideQuote;
        }
      } else if (char === ',' && !insideQuote) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if ((char === '\r' || char === '\n') && !insideQuote) {
        if (char === '\r' && nextChar === '\n') {
          i++; // skip \r\n
        }
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
    }

    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.trim());
    const data = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const obj = {};
      let hasValue = false;
      headers.forEach((h, colIdx) => {
        const val = row[colIdx] !== undefined ? row[colIdx] : '';
        obj[h] = val;
        if (val) hasValue = true;
      });
      if (hasValue) data.push(obj);
    }

    return data;
  }

  /**
   * Fetch CSV directly from Google Sheets Export URL
   */
  async fetchSheetData(sheetUrlOrId, gid = '0') {
    const sheetId = this.extractSheetId(sheetUrlOrId);
    if (!sheetId) {
      throw new Error('ไม่พบ Google Sheet ID กรุณาตรวจสอบลิงก์ Google Sheets');
    }

    const useGid = gid || this.extractGid(sheetUrlOrId);
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${useGid}`;

    console.log(`[Google Sheets] Fetching CSV from: ${exportUrl}`);
    const res = await fetch(exportUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AIZEN-Bot/1.0'
      }
    });

    if (!res.ok) {
      throw new Error(`ไม่สามารถเข้าถึง Google Sheet (${res.status} ${res.statusText}) — กรุณาตั้งค่าแชร์ชีตเป็น "ทุกคนที่มีลิงก์มีสิทธิ์ดู (Anyone with the link can view)"`);
    }

    const text = await res.text();
    return this.parseCsv(text);
  }

  /**
   * Test connection to a Google Sheet
   */
  async testConnection(sheetUrlOrId, gid = '0') {
    try {
      const records = await this.fetchSheetData(sheetUrlOrId, gid);
      return {
        success: true,
        count: records.length,
        headers: records.length > 0 ? Object.keys(records[0]) : [],
        sample: records.slice(0, 3)
      };
    } catch (err) {
      return {
        success: false,
        message: err.message
      };
    }
  }

  /**
   * Sync Google Sheets into AI Knowledge Base
   */
  async syncToKnowledge(customUrl = null) {
    const config = db.getConfig();
    const sheetUrl = customUrl || config.googleSheetUrl;

    if (!sheetUrl || !sheetUrl.trim()) {
      return { success: false, message: 'กรุณากรอกลิงก์ Google Sheets ในหน้าตั้งค่าก่อนทำการซิงก์' };
    }

    try {
      const records = await this.fetchSheetData(sheetUrl, config.googleSheetProductsGid || '0');
      console.log(`[Google Sheets Sync] Fetched ${records.length} rows`);

      const productsList = [];
      const faqsList = [];
      const orderGuidesList = [];

      for (let idx = 0; idx < records.length; idx++) {
        const row = records[idx];
        const keys = Object.keys(row);

        // Find product fields
        const nameKey = keys.find(k => /ชื่อสินค้า|สินค้า|name|title|product/i.test(k));
        const priceKey = keys.find(k => /ราคา|price/i.test(k));
        const detailKey = keys.find(k => /รายละเอียด|จุดเด่น|description|detail/i.test(k));
        const optionsKey = keys.find(k => /ตัวเลือก|ไซส์|สี|option|size|color/i.test(k));
        const statusKey = keys.find(k => /สถานะ|status/i.test(k));

        // Find FAQ fields
        const questionKey = keys.find(k => /คำถาม|question|faq/i.test(k));
        const answerKey = keys.find(k => /คำตอบ|answer/i.test(k));
        const keywordKey = keys.find(k => /คำสำคัญ|คีย์เวิร์ด|keyword/i.test(k));

        // Find Order Guide fields
        const topicKey = keys.find(k => /หัวข้อ|ขั้นตอน|topic|step/i.test(k));
        const contentKey = keys.find(k => /วิธีสั่ง|สั่งซื้อ|content/i.test(k));

        // 1. Is it a product row?
        if (nameKey && row[nameKey] && row[nameKey].trim()) {
          const rawPrice = priceKey ? row[priceKey] : '-';
          const price = typeof rawPrice === 'number' || /^\d+$/.test(rawPrice) ? `${rawPrice} บาท` : rawPrice;
          const status = statusKey ? row[statusKey] : 'ขายอยู่';

          if (status !== 'ปิดการขาย' && status !== 'Inactive') {
            productsList.push({
              id: `gs_prod_${idx + 1}`,
              name: row[nameKey].trim(),
              price: price || '-',
              detail: detailKey ? row[detailKey].trim() : '',
              options: optionsKey ? row[optionsKey].trim() : '',
              status: status
            });
          }
        }

        // 2. Is it an FAQ row?
        if (questionKey && answerKey && row[questionKey] && row[answerKey]) {
          const rawKw = keywordKey ? row[keywordKey] : '';
          const keywords = rawKw ? rawKw.split(/[,|\s]+/).map(s => s.trim()).filter(Boolean) : [];
          faqsList.push({
            id: `gs_faq_${idx + 1}`,
            question: row[questionKey].trim(),
            answer: row[answerKey].trim(),
            keywords: keywords
          });
        }

        // 3. Is it an Order Guide row?
        if (topicKey && (contentKey || detailKey) && row[topicKey]) {
          const content = (contentKey ? row[contentKey] : row[detailKey]) || '';
          if (content.trim()) {
            orderGuidesList.push({
              id: `gs_guide_${idx + 1}`,
              topic: row[topicKey].trim(),
              content: content.trim(),
              order: idx + 1
            });
          }
        }
      }

      // Format knowledge text
      let formattedProducts = productsList.map((p, idx) => {
        let line = `${idx + 1}. ${p.name} - ราคา: ${p.price}`;
        if (p.options) line += ` (${p.options})`;
        if (p.detail) line += ` [รายละเอียด: ${p.detail}]`;
        return line;
      }).join('\n');

      let formattedFaq = faqsList.map((q, idx) => 
        `Q${idx + 1}: ${q.question}\nA: ${q.answer}`
      ).join('\n\n');

      let formattedOrder = orderGuidesList.map(g => 
        `• ${g.topic}: ${g.content}`
      ).join('\n');

      // Update Knowledge Base
      const currentKb = db.getKnowledge();
      const newKb = { ...currentKb };
      if (formattedProducts) newKb.products = formattedProducts;
      if (formattedFaq) newKb.faq = formattedFaq;
      if (formattedOrder) newKb.payment = formattedOrder;

      db.saveKnowledge(newKb);

      // Save synced cache
      const sheetsData = {
        products: productsList,
        faqs: faqsList,
        orderGuides: orderGuidesList,
        lastSync: new Date().toISOString()
      };
      db.saveSheetsData(sheetsData);

      console.log(`[Google Sheets Sync Success] Products: ${productsList.length}, FAQs: ${faqsList.length}, Guides: ${orderGuidesList.length}`);

      return {
        success: true,
        counts: {
          products: productsList.length,
          faqs: faqsList.length,
          orderGuides: orderGuidesList.length
        },
        lastSync: sheetsData.lastSync
      };
    } catch (err) {
      console.error('[Google Sheets Sync Error]', err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Handle incoming Webhook from Google Apps Script (Realtime Row Insert/Edit)
   */
  async handleWebhookEvent(payload) {
    console.log('[Google Sheets Webhook Received]', payload);

    if (payload.action === 'sync') {
      return await this.syncToKnowledge();
    }

    const currentData = db.getSheetsData();
    const products = currentData.products || [];
    const faqs = currentData.faqs || [];

    if (payload.type === 'product' && payload.name) {
      const existing = products.find(p => p.name.toLowerCase() === payload.name.toLowerCase());
      if (existing) {
        Object.assign(existing, payload);
      } else {
        products.push({
          id: 'gs_prod_' + Date.now(),
          name: payload.name,
          price: payload.price || '-',
          detail: payload.detail || '',
          options: payload.options || '',
          status: payload.status || 'ขายอยู่'
        });
      }
    } else if (payload.type === 'faq' && payload.question && payload.answer) {
      faqs.push({
        id: 'gs_faq_' + Date.now(),
        question: payload.question,
        answer: payload.answer,
        keywords: payload.keywords || []
      });
    }

    currentData.products = products;
    currentData.faqs = faqs;
    currentData.lastSync = new Date().toISOString();
    db.saveSheetsData(currentData);

    // Update Knowledge string
    const currentKb = db.getKnowledge();
    if (products.length > 0) {
      currentKb.products = products.map((p, idx) => `${idx + 1}. ${p.name} - ราคา: ${p.price} (${p.options || ''}) [${p.detail || ''}]`).join('\n');
    }
    db.saveKnowledge(currentKb);

    return {
      success: true,
      message: 'บันทึกข้อมูลจาก Google Sheets เข้าสู่ระบบเรียบร้อยแล้ว',
      counts: {
        products: products.length,
        faqs: faqs.length
      }
    };
  }

  /**
   * Generates Google Apps Script template for user to copy-paste
   */
  getAppsScriptTemplate(serverWebhookUrl) {
    return `/**
 * AIZEN - Google Sheets Realtime Auto-Sync Script
 * วางโค้ดนี้ใน Google Sheets -> ส่วนขยาย (Extensions) -> Apps Script
 */

const WEBHOOK_URL = "${serverWebhookUrl || 'https://YOUR-DOMAIN/api/webhook/sheets'}";

function onEdit(e) {
  try {
    const sheet = e.source.getActiveSheet();
    const range = e.range;
    const row = range.getRow();
    if (row === 1) return; // ข้าม Header

    // ดึงข้อมูลทั้งแถวที่ถูกแก้ไข
    const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const payload = {
      action: "sync",
      sheetName: sheet.getName(),
      editedRow: row,
      timestamp: new Date().toISOString()
    };

    UrlFetchApp.fetch(WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log("Sync Error: " + err.message);
  }
}`;
  }
}

module.exports = new GoogleSheetsService();
