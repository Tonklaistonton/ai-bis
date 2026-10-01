export async function parseSlipOrInvoice({ imageBuffer, mimeType, provider = 'gemini', options = {} }) {
  const base64Image = imageBuffer.toString('base64');

  if (provider === 'gemini') {
    return parseWithGemini(base64Image, mimeType, options.apiKey || process.env.GEMINI_API_KEY);
  } else if (provider === 'openai') {
    return parseWithOpenAI(base64Image, mimeType, options.apiKey || process.env.OPENAI_API_KEY);
  } else if (provider === 'slipok') {
    return parseWithSlipOK(base64Image, options);
  } else {
    throw new Error(`Unsupported vision provider: ${provider}`);
  }
}

async function parseWithGemini(base64Image, mimeType, apiKey) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const prompt = `คุณคือผู้เชี่ยวชาญด้านบัญชีและการเงิน วิเคราะห์รูปภาพสลิปโอนเงิน หรือใบเสร็จ/ใบแจ้งหนี้ต่อไปนี้
สกัดข้อมูลให้ออกมาเป็น JSON เท่านั้นในรูปแบบ:
{
  "doc_type": "slip" | "invoice" | "receipt" | "unknown",
  "amount": number,
  "transfer_time": "YYYY-MM-DD HH:mm:ss" | null,
  "reference_no": string | null,
  "sender_bank": string | null,
  "sender_name": string | null,
  "receiver_bank": string | null,
  "receiver_name": string | null,
  "receiver_account": string | null,
  "vendor_name": string | null,
  "vat_amount": number | null,
  "confidence": number
}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Image } }
        ]
      }],
      generationConfig: { response_mime_type: 'application/json' }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API Error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text || '{}');
}

async function parseWithOpenAI(base64Image, mimeType, apiKey) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'สกัดข้อมูลสลิปโอนเงินหรือใบเสร็จเป็น JSON: { doc_type, amount, transfer_time, reference_no, sender_bank, sender_name, receiver_bank, receiver_name, receiver_account, vendor_name, vat_amount, confidence }'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'สกัดข้อมูลบัญชีจากภาพนี้' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API Error: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return JSON.parse(content || '{}');
}

async function parseWithSlipOK(base64Image, options) {
  const apiKey = options.apiKey || process.env.SLIPOK_API_KEY;
  const branchId = options.branchId || process.env.SLIPOK_BRANCH_ID;
  if (!apiKey || !branchId) throw new Error('SlipOK API Key or Branch ID not configured');

  const res = await fetch(`https://api.slipok.com/api/line/apikey/${branchId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-authorization': apiKey
    },
    body: JSON.stringify({
      data: base64Image,
      log: true
    })
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(`SlipOK Error: ${json.message || 'Verification failed'}`);
  }

  const data = json.data;
  return {
    doc_type: 'slip',
    amount: data.amount,
    transfer_time: data.transDate + ' ' + (data.transTime || ''),
    reference_no: data.transRef,
    sender_bank: data.sendingBank,
    sender_name: data.sender?.name,
    receiver_bank: data.receivingBank,
    receiver_name: data.receiver?.name,
    receiver_account: data.receiver?.account?.value,
    confidence: 1.0,
    raw: data
  };
}
