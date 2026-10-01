/**
 * AIZEN PRO - Airtable Database & RAG Service
 * Connects directly to Airtable REST API for Products, FAQs, and Order Guides
 */

const db = require('./db');

class AirtableService {
  /**
   * Fetch records from an Airtable table
   * @param {string} token - Personal Access Token (pat...)
   * @param {string} baseId - Base ID (e.g. appvGIwch0gFueHpo)
   * @param {string} tableId - Table ID or Name (e.g. tblFPwHZuIRWoMEpu)
   * @param {object} queryParams
   */
  async getTableRecords(token, baseId, tableId, queryParams = {}) {
    if (!token || !baseId || !tableId) {
      throw new Error('Airtable Token, Base ID, and Table ID are required');
    }

    const cleanToken = token.trim();
    const cleanBase = baseId.trim();
    const cleanTable = tableId.trim();

    const url = new URL(`https://api.airtable.com/v0/${cleanBase}/${encodeURIComponent(cleanTable)}`);
    if (queryParams.maxRecords) url.searchParams.set('maxRecords', queryParams.maxRecords);
    if (queryParams.view) url.searchParams.set('view', queryParams.view);

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data.error ? (data.error.message || JSON.stringify(data.error)) : res.statusText;
      throw new Error(`Airtable API Error (${res.status}): ${msg}`);
    }

    return data.records || [];
  }

  /**
   * Test connection to Airtable Base
   */
  async testConnection(token, baseId, tableId) {
    try {
      const records = await this.getTableRecords(token, baseId, tableId, { maxRecords: 3 });
      return {
        success: true,
        count: records.length,
        sample: records.map(r => r.fields)
      };
    } catch (err) {
      return {
        success: false,
        message: err.message
      };
    }
  }

  /**
   * Sync all Airtable tables into local AI Knowledge Base
   */
  async syncToKnowledge() {
    const config = db.getConfig();
    const token = config.airtableApiKey;
    const baseId = config.airtableBaseId || 'appvGIwch0gFueHpo';
    const prodTable = config.airtableProductTable || 'tblFPwHZuIRWoMEpu';
    const faqTable = config.airtableFaqTable || 'tbllQAiYzuIaS8KOC';
    const orderTable = config.airtableOrderTable || 'tblYGurp3oPOVs9JH';

    if (!token || !token.trim()) {
      return { success: false, message: 'กรุณากรอก Airtable Personal Access Token (PAT) ก่อนทำการซิงก์' };
    }

    try {
      console.log('[Airtable Sync] Starting sync from Base:', baseId);

      // 1. Fetch Products
      let productsList = [];
      try {
        const prodRecords = await this.getTableRecords(token, baseId, prodTable, { maxRecords: 100 });
        productsList = prodRecords.map(r => {
          const f = r.fields;
          const name = f['ชื่อสินค้า/บริการ'] || f['ชื่อสินค้า'] || f['Name'] || f['Title'] || '';
          if (!name || !name.trim()) return null; // Filter empty default Airtable rows

          const rawPrice = f['ราคาที่ขายจริง (บาท)'] || f['ราคาโปรโมชัน (บาท)'] || f['ราคาปกติ (บาท)'] || f['ราคา'] || f['Price'] || '-';
          const price = typeof rawPrice === 'number' ? `${rawPrice} บาท` : String(rawPrice);
          const detail = f['รายละเอียด/จุดเด่น'] || f['รายละเอียด'] || f['Description'] || '';
          const options = f['ตัวเลือก (ไซซ์/สี/รุ่น)'] || f['ตัวเลือก'] || '';
          const category = f['หมวดหมู่'] || f['หมวด'] || '';
          const status = f['สถานะ'] || f['Status'] || 'ขายอยู่';

          return {
            id: r.id,
            name: name.trim(),
            price: price,
            detail: detail.trim(),
            options: options.trim(),
            category: category.trim(),
            status: status
          };
        }).filter(p => p !== null && p.status !== 'ปิดการขาย' && p.status !== 'Inactive');
      } catch (e) {
        console.warn('[Airtable Products Sync Error]', e.message);
      }

      // 2. Fetch FAQs
      let faqsList = [];
      try {
        const faqRecords = await this.getTableRecords(token, baseId, faqTable, { maxRecords: 50 });
        faqsList = faqRecords.map(r => {
          const f = r.fields;
          const question = f['คำถามที่ลูกค้าถามบ่อย'] || f['คำถาม'] || f['Question'] || f['Title'] || '';
          const answer = f['คำตอบมาตรฐาน (ให้ AI ใช้ตอบ)'] || f['คำตอบ'] || f['Answer'] || f['Details'] || '';
          const rawKeywords = f['คำสำคัญ (Keyword)'] || f['Keyword'] || [];
          const keywords = Array.isArray(rawKeywords) ? rawKeywords : [String(rawKeywords)];
          const category = f['หมวด'] || '';
          const status = f['สถานะ'] || 'ใช้งาน';

          if (!question || !answer || !question.trim() || !answer.trim()) return null;

          return {
            id: r.id,
            question: question.trim(),
            answer: answer.trim(),
            keywords: keywords,
            category: category,
            status: status
          };
        }).filter(q => q !== null && q.status !== 'ปิดใช้งาน');
      } catch (e) {
        console.warn('[Airtable FAQs Sync Error]', e.message);
      }

      // 3. Fetch Order Guides
      let orderGuidesList = [];
      try {
        const orderRecords = await this.getTableRecords(token, baseId, orderTable, { maxRecords: 30 });
        orderGuidesList = orderRecords.map(r => {
          const f = r.fields;
          const topic = f['หัวข้อ'] || f['ขั้นตอน'] || f['Topic'] || '';
          const content = f['รายละเอียด (ให้ AI ใช้ตอบ)'] || f['รายละเอียด'] || f['วิธีสั่งซื้อ'] || f['Content'] || '';
          const order = typeof f['ลำดับ'] === 'number' ? f['ลำดับ'] : 99;

          if (!topic || !topic.trim()) return null;

          return {
            id: r.id,
            topic: topic.trim(),
            content: content.trim(),
            order: order
          };
        }).filter(g => g !== null && (g.topic || g.content))
          .sort((a, b) => a.order - b.order);
      } catch (e) {
        console.warn('[Airtable Order Guides Sync Error]', e.message);
      }

      // Format into Knowledge strings
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

      // Update Knowledge in Database if records found
      const currentKb = db.getKnowledge();
      const newKb = { ...currentKb };
      if (formattedProducts) newKb.products = formattedProducts;
      if (formattedFaq) newKb.faq = formattedFaq;
      if (formattedOrder) {
        newKb.payment = formattedOrder;
      }

      db.saveKnowledge(newKb);

      // Save synced cache in database
      db.saveAirtableData({
        products: productsList,
        faqs: faqsList,
        orderGuides: orderGuidesList,
        lastSync: new Date().toISOString()
      });

      console.log(`[Airtable Sync Success] Products: ${productsList.length}, FAQs: ${faqsList.length}, Guides: ${orderGuidesList.length}`);

      return {
        success: true,
        counts: {
          products: productsList.length,
          faqs: faqsList.length,
          orderGuides: orderGuidesList.length
        },
        lastSync: new Date().toISOString()
      };
    } catch (err) {
      console.error('[Airtable Sync Error]', err.message);
      return { success: false, message: err.message };
    }
  }
}

module.exports = new AirtableService();
