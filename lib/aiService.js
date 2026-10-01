/**
 * AIZEN RESPONDER - AI Intelligence Service
 * Combines Google Gemini API with Smart Thai/English NLP Engine fallback
 */

const db = require('./db');

class AIService {
  /**
   * Generate an intelligent reply for a customer query
   * @param {string} userMessage 
   * @param {string} channel - 'line' | 'gmail'
   * @param {object} metadata - e.g. { subject, senderName, tone }
   * @returns {Promise<string>}
   */
  async generateReply(userMessage, channel = 'line', metadata = {}) {
    const config = db.getConfig();
    const kb = db.getKnowledge();
    const provider = config.aiProvider || 'gemini';

    // 1. If OpenAI is selected provider
    if (provider === 'openai' && config.openaiApiKey && config.openaiApiKey.trim()) {
      try {
        const openaiReply = await this.callOpenAIAPI(config.openaiApiKey, config.openaiModel || 'gpt-4o-mini', userMessage, channel, kb, metadata, config.openaiEndpoint);
        if (openaiReply) return openaiReply;
      } catch (err) {
        console.warn('[OpenAI API Error, attempting fallback]', err.message);
      }
    }

    // 2. If Gemini is selected provider (or fallback if OpenAI failed)
    if ((provider === 'gemini' || provider === 'auto') && config.geminiApiKey && config.geminiApiKey.trim().startsWith('AIzaSy')) {
      try {
        const geminiReply = await this.callGeminiAPI(config.geminiApiKey, userMessage, channel, kb, metadata, config.geminiModel);
        if (geminiReply) return geminiReply;
      } catch (err) {
        console.warn('[Gemini API Fallback to Rule Engine]', err.message);
      }
    }

    // 3. Fallback to OpenAI if Gemini was primary but failed
    if (provider !== 'openai' && config.openaiApiKey && config.openaiApiKey.trim()) {
      try {
        const openaiReply = await this.callOpenAIAPI(config.openaiApiKey, config.openaiModel || 'gpt-4o-mini', userMessage, channel, kb, metadata, config.openaiEndpoint);
        if (openaiReply) return openaiReply;
      } catch (err) {
        console.warn('[OpenAI Fallback failed]', err.message);
      }
    }

    // 4. Intelligent Rule-based NLP Engine (Reliable, Instant & Free)
    if (channel === 'gmail') {
      return this.generateGmailRuleReply(userMessage, kb, metadata);
    }
    return this.generateLineRuleReply(userMessage, kb);
  }

  getCombinedDatabaseData() {
    const config = db.getConfig();
    const airtable = db.getAirtableData();
    const sheets = db.getSheetsData();

    let products = [];
    let faqs = [];
    let orderGuides = [];

    if (config.activeDatabase === 'sheets') {
      products = sheets.products?.length ? sheets.products : (airtable.products || []);
      faqs = sheets.faqs?.length ? sheets.faqs : (airtable.faqs || []);
      orderGuides = sheets.orderGuides?.length ? sheets.orderGuides : (airtable.orderGuides || []);
    } else if (config.activeDatabase === 'both') {
      products = [...(sheets.products || []), ...(airtable.products || [])];
      faqs = [...(sheets.faqs || []), ...(airtable.faqs || [])];
      orderGuides = [...(sheets.orderGuides || []), ...(airtable.orderGuides || [])];
    } else {
      // Default: airtable (fallback to sheets if airtable empty)
      products = airtable.products?.length ? airtable.products : (sheets.products || []);
      faqs = airtable.faqs?.length ? airtable.faqs : (sheets.faqs || []);
      orderGuides = airtable.orderGuides?.length ? airtable.orderGuides : (sheets.orderGuides || []);
    }

    return { products, faqs, orderGuides };
  }

  buildSystemPrompt(channel, kb, metadata = {}) {
    const dbData = this.getCombinedDatabaseData();
    let dbContext = '';
    if (dbData) {
      if (dbData.products && dbData.products.length > 0) {
        dbContext += '\n\n=== ฐานข้อมูลสินค้าจริง (Database Products) ===\n' + dbData.products.map(p => 
          `- ${p.name}: ราคา ${p.price} | ตัวเลือก: ${p.options || '-'} | จุดเด่น: ${p.detail || '-'}`
        ).join('\n');
      }
      if (dbData.faqs && dbData.faqs.length > 0) {
        dbContext += '\n\n=== ฐานข้อมูลคำถามพบบ่อย (Database FAQ) ===\n' + dbData.faqs.map(f => 
          `คำถาม: ${f.question}\nคำตอบ: ${f.answer}\nคีย์เวิร์ด: ${(f.keywords || []).join(', ')}`
        ).join('\n---\n');
      }
      if (dbData.orderGuides && dbData.orderGuides.length > 0) {
        dbContext += '\n\n=== ขั้นตอนการสั่งซื้อและการจัดส่ง (Database Order Guides) ===\n' + dbData.orderGuides.map(g => 
          `• ${g.topic}: ${g.content}`
        ).join('\n');
      }
    }

    return `You are AIZEN, an intelligent, polite customer support and sales AI assistant for "${kb.shopName}".
Business Knowledge:
- Shop Hours: ${kb.openingHours}
- Contact: ${kb.contactInfo}
- Products & Pricing: ${kb.products}
- Active Promotions: ${kb.promotions}
- Payment Methods: ${kb.payment}
- Delivery & Returns: ${kb.delivery}
- Persona: ${kb.persona}${dbContext}

Channel: ${channel === 'line' ? 'LINE Official Account (Keep concise, polite, natural Thai, use pleasant emojis, give direct and helpful answers)' : 'Gmail (Format as professional formal email with greeting, structured bullet points, and warm closing sign-off)'}
${metadata.subject ? `Email Subject: ${metadata.subject}` : ''}
${metadata.senderName ? `Customer Name: ${metadata.senderName}` : ''}

Answer the customer directly based strictly on the business knowledge and database. Do not invent fake facts outside the knowledge base.`;
  }

  async callOpenAIAPI(apiKey, model, userMessage, channel, kb, metadata, endpoint) {
    const systemPrompt = this.buildSystemPrompt(channel, kb, metadata);
    const chosenModel = model || 'gpt-4o-mini';

    let url = (endpoint && endpoint.trim()) ? endpoint.trim() : 'https://api.openai.com/v1/chat/completions';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    if (!url.endsWith('/chat/completions') && !url.includes('/chat/completions?')) {
      url = url.replace(/\/+$/, '') + '/chat/completions';
    }

    const payload = {
      model: chosenModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: channel === 'gmail' ? 800 : 350
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const replyText = data.choices?.[0]?.message?.content;
    if (!replyText) throw new Error('No content returned from OpenAI');
    return replyText.trim();
  }

  async listOpenAIModels(apiKey, endpoint) {
    if (!apiKey) return { success: false, message: 'กรุณากรอก OpenAI API Key' };
    try {
      let url = (endpoint && endpoint.trim()) ? endpoint.trim() : 'https://api.openai.com/v1/models';
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      if (url.includes('/chat/completions')) {
        url = url.replace(/\/chat\/completions.*$/, '/models');
      } else if (!url.endsWith('/models') && !url.includes('/models?')) {
        url = url.replace(/\/+$/, '') + '/models';
      }

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        const models = rawList
          .map(m => typeof m === 'string' ? m : (m.id || m.name))
          .filter(Boolean)
          .sort();
        return {
          success: true,
          models
        };
      }
      const err = await res.text();
      let parsedErr = err;
      try {
        const errObj = JSON.parse(err);
        if (errObj.error?.message) parsedErr = errObj.error.message;
      } catch (e) {}
      return { success: false, message: `OpenAI Error: ${parsedErr}` };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async testOpenAIConnection(apiKey, model = 'gpt-4o-mini', endpoint) {
    if (!apiKey) return { success: false, message: 'กรุณากรอก OpenAI API Key' };
    try {
      let url = (endpoint && endpoint.trim()) ? endpoint.trim() : 'https://api.openai.com/v1/chat/completions';
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      if (!url.endsWith('/chat/completions') && !url.includes('/chat/completions?')) {
        url = url.replace(/\/+$/, '') + '/chat/completions';
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [
            { role: 'user', content: 'Say "OpenAI Connected OK" in Thai concisely' }
          ],
          max_tokens: 25
        })
      });

      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          message: 'เชื่อมต่อ OpenAI API สำเร็จ!',
          model: data.model || model,
          reply: data.choices?.[0]?.message?.content?.trim()
        };
      }
      const err = await res.text();
      let parsedErr = err;
      try {
        const errObj = JSON.parse(err);
        if (errObj.error?.message) parsedErr = errObj.error.message;
      } catch (e) {}
      return { success: false, message: `OpenAI Error: ${parsedErr}` };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async callGeminiAPI(apiKey, userMessage, channel, kb, metadata, preferredModel) {
    const systemPrompt = this.buildSystemPrompt(channel, kb, metadata);

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nCustomer Message: "${userMessage}"` }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: channel === 'gmail' ? 800 : 350
      }
    };

    const models = preferredModel ? [preferredModel, 'gemini-1.5-flash-latest', 'gemini-2.0-flash', 'gemini-1.5-flash'] : ['gemini-1.5-flash-latest', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastErr = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate) return candidate.trim();
        } else {
          lastErr = await res.text();
        }
      } catch (err) {
        lastErr = err.message;
      }
    }

    if (lastErr) {
      console.warn('[Gemini API Fallback to Rule Engine]', lastErr);
    }
    return null;
  }

  generateLineRuleReply(text, kb) {
    const q = (text || '').toLowerCase().trim();
    const dbData = this.getCombinedDatabaseData();

    // 1. Check FAQs match (Dynamic RAG)
    try {
      if (dbData && Array.isArray(dbData.faqs) && dbData.faqs.length > 0) {
        for (const item of dbData.faqs) {
          if (!item.answer) continue;
          const qClean = (item.question || '').toLowerCase().trim();

          // Match by question title
          let isMatch = qClean && (q.includes(qClean) || qClean.includes(q));

          // Match by keywords
          if (!isMatch && Array.isArray(item.keywords) && item.keywords.length > 0) {
            isMatch = item.keywords.some(kw => kw && q.includes(kw.toLowerCase().trim()));
          }

          if (isMatch) {
            return `💡 ข้อมูลสำหรับคำถาม "${item.question || 'คำถามที่พบบ่อย'}":\n\n${item.answer}\n\nหากต้องการสอบถามเพิ่มเติมหรือสั่งซื้อ ทักแอดมินได้ตลอด 24 ชม. เลยนะครับ 😊`;
          }
        }
      }
    } catch (e) {}

    // 2. Check Order Guide (Dynamic RAG)
    try {
      if (dbData && Array.isArray(dbData.orderGuides) && dbData.orderGuides.length > 0) {
        // Specific topic match
        for (const guide of dbData.orderGuides) {
          if (!guide.topic || !guide.content) continue;
          const tClean = guide.topic.toLowerCase().trim();
          if (q.includes(tClean)) {
            return `📋 ข้อมูล (${guide.topic}):\n\n${guide.content}\n\nสามารถแจ้งรายละเอียดผ่านทางแชตนี้ได้เลยครับผม 😊`;
          }
        }

        // General order inquiry (สั่งซื้อ, สั่งยังไง, วิธีสั่ง, ซื้อของ)
        if (q.includes('สั่ง') || q.includes('ซื้อ') || q.includes('how to order') || q.includes('ขั้นตอน')) {
          const guideSummary = dbData.orderGuides.map(g => `• ${g.topic}: ${g.content}`).join('\n');
          return `🛍️ ขั้นตอนและวิธีการสั่งซื้อสินค้า (${kb.shopName}):\n\n${guideSummary}\n\nลูกค้าสนใจรับสินค้าชิ้นไหน แจ้งชื่อสินค้า สี หรือไซส์ได้เลยนะครับ แอดมินพร้อมดูแลครับ! 🙏`;
        }
      }
    } catch (e) {}

    // 3. Check Products from Database or Knowledge Base
    const isProductQuery = q.includes('มีอะไร') || q.includes('มีของ') || q.includes('ของ') || 
                           q.includes('สินค้า') || q.includes('ขาย') || q.includes('ราคา') || 
                           q.includes('ไซส์') || q.includes('แคตตาล็อก') || q.includes('catalog') || 
                           q.includes('เสื้อ') || q.includes('กระเป๋า') || q.includes('เคส') || 
                           q.includes('สายชาร์จ') || q.includes('แนะนำ');

    if (isProductQuery) {
      if (dbData && Array.isArray(dbData.products) && dbData.products.length > 0) {
        const prodList = dbData.products.map((p, idx) => {
          let line = `${idx + 1}. ✨ ${p.name} — ราคา ${p.price}`;
          if (p.options) line += ` (${p.options})`;
          if (p.detail) line += `\n   จุดเด่น: ${p.detail}`;
          return line;
        }).join('\n\n');

        return `🧥 รายการสินค้าพร้อมส่งจากทางร้าน ${kb.shopName} ครับ:\n\n${prodList}\n\n🎉 ${kb.promotions || 'จัดส่งฟรีทั่วประเทศ!'}\nลูกค้าสนใจรับเป็นชิ้นไหน แจ้งไซส์หรือสีกับแอดมินได้เลยนะครับผม! 😊`;
      } else if (kb.products) {
        return `🧥 รายการสินค้าของ ${kb.shopName}:\n\n${kb.products}\n\n✨ ทุกรุ่นส่งฟรีด่วนทั่วประเทศ รับเป็นสีหรือไซส์ไหนดีครับผม? ยินดีแนะนำขนาดให้ครับ 😊`;
      }
    }

    // 4. Promotions / Discounts
    if (q.includes('โปร') || q.includes('ลด') || q.includes('ส่งฟรี') || q.includes('แถม') || q.includes('โค้ด') || q.includes('discount')) {
      return `🎉 โปรโมชั่นพิเศษวันนี้ครับ!\n\n✨ ${kb.promotions}\n\nลูกค้าสนใจชิ้นไหน แจ้งไซส์ได้เลยนะครับ แอดมิน AI ช่วยคิดราคาส่วนลดให้ทันทีครับผม! 🎁`;
    }

    // 5. Payment / Bank / COD
    if (q.includes('บัญชี') || q.includes('โอน') || q.includes('ชำระ') || q.includes('จ่าย') || q.includes('สลิป') || q.includes('ธนาคาร')) {
      return `💳 ช่องทางชำระเงินของทางร้านครับ:\n\n🏦 ${kb.payment}\n\nโอนเงินเรียบร้อยแล้ว ส่งสลิปพร้อมแจ้งชื่อ ที่อยู่ และเบอร์โทรได้เลยนะครับ ระบบจะบันทึกออเดอร์และเตรียมจัดส่งทันทีครับ 🙏`;
    }

    // 6. COD
    if (q.includes('ปลายทาง') || q.includes('cod')) {
      return `🚚 ทางร้านมีบริการเก็บเงินปลายทาง (COD) ครับผม! ค่าบริการเพิ่มเติมเพียง 30 บาท ลูกค้าแจ้งสินค้า ไซส์ และที่อยู่สำหรับจัดส่งได้เลยครับ`;
    }

    // 7. Delivery / Tracking / Exchange
    if (q.includes('ส่ง') || q.includes('กี่วัน') || q.includes('ขนส่ง') || q.includes('เปลี่ยน') || q.includes('พัสดุ')) {
      return `📦 ข้อมูลการจัดส่งและเปลี่ยนสินค้าครับ:\n\n🚀 ${kb.delivery}\n\nได้รับของแล้วลองสวมใส่ได้สบายใจ หากไม่พอดีแจ้งเปลี่ยนไซส์ได้ฟรีเลยครับผม! 😊`;
    }

    // 8. Opening Hours / Location
    if (q.includes('เปิด') || q.includes('เวลา') || q.includes('กี่โมง') || q.includes('ที่อยู่') || q.includes('สาขา')) {
      return `สวัสดีครับ 😊 ทาง ${kb.shopName} ${kb.openingHours} ครับ\n\nหากต้องการสอบถามเพิ่มเติมหรือติดต่อเจ้าหน้าที่ สามารถโทร ${kb.contactInfo} ได้เลยครับผม มีสินค้าตัวไหนให้แอดมินหรือ AI ช่วยดูแลดีครับ?`;
    }

    // 9. Greetings
    if (q.includes('สวัสดี') || q.includes('ดีครับ') || q.includes('ดีค่ะ') || q.includes('hello') || q.includes('hi')) {
      return `สวัสดีครับ ยินดีต้อนรับสู่ ${kb.shopName} ครับ 🎉\nวันนี้มีโปรโมชั่นส่งฟรีทั่วประเทศ ลูกค้าสนใจดูสินค้าตัวไหนหรือให้ช่วยเหลือด้านใด สอบถามเข้ามาได้ตลอด 24 ชม. เลยนะครับผม 😊`;
    }

    // Default polite closing
    return `ขอบคุณที่ติดต่อ ${kb.shopName} ครับผม 😊\nสำหรับข้อความ "${text}" ทางเรารับทราบเรียบร้อยครับ\n\nหากสนใจสั่งซื้อสินค้า เช็คโปรโมชั่น หรือสอบถามไซส์ สามารถแจ้งเข้ามาได้เลยครับ ทางเราพร้อมให้บริการเต็มที่ครับผม! 🙏✨`;
  }

  generateGmailRuleReply(text, kb, metadata) {
    const clientName = metadata.senderName || 'ท่านผู้ติดต่อ';
    const subject = metadata.subject || 'การสอบถามข้อมูล';
    const tone = metadata.tone || 'formal';

    if (tone === 'english') {
      return `Dear ${clientName},

Thank you for contacting ${kb.shopName} regarding "${subject}".

We have received your inquiry. Here are the key details for your reference:
- Our Offer: ${kb.promotions}
- Products & Pricing: ${kb.products}
- Delivery Terms: ${kb.delivery}
- Payment Options: ${kb.payment}

Please feel free to reply directly to this email if you need official quotations or additional information.

Sincerely,
Customer Support & AI Relations
${kb.shopName}
Contact: ${kb.contactInfo}`;
    }

    return `เรียน คุณ${clientName} ที่นับถือ,

ในนามของ ${kb.shopName} ขอขอบพระคุณเป็นอย่างยิ่งที่ท่านได้ติดต่อสอบถามเข้ามาในหัวข้อเรื่อง "${subject}"

ทางบริษัทฯ ขอเรียนแจ้งรายละเอียดข้อมูลดังต่อไปนี้ครับ:
1. ข้อมูลสินค้าและการให้บริการ: ${kb.products}
2. สิทธิประโยชน์และโปรโมชั่น: ${kb.promotions}
3. การชำระเงินและนโยบายการจัดส่ง: ${kb.delivery}

หากท่านต้องการให้ออกเอกสารใบเสนอราคาอย่างเป็นทางการ (Official Quotation) หรือมีข้อสงสัยประการใดเพิ่มเติม สามารถตอบกลับอีเมลนี้ได้ทันที ทางเจ้าหน้าที่จะประสานงานดูแลท่านโดยเร็วที่สุด

ขอแสดงความนับถือ,

ฝ่ายบริการลูกค้าสัมพันธ์ AIZEN
${kb.shopName}
ช่องทางติดต่อ: ${kb.contactInfo}`;
  }
}

module.exports = new AIService();
