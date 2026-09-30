/**
 * AIZEN RESPONDER - Official LINE Messaging API Service
 * Handles Webhook Events, HMAC Signature Verification, and Auto-Reply
 */

const crypto = require('crypto');
const db = require('./db');
const aiService = require('./aiService');

class LineService {
  /**
   * Verify HMAC-SHA256 signature from LINE
   */
  validateSignature(rawBody, signature, channelSecret) {
    if (!channelSecret || !signature) return true; // allow if secret not configured yet for testing
    const hash = crypto
      .createHmac('sha256', channelSecret)
      .update(rawBody)
      .digest('base64');
    return hash === signature;
  }

  /**
   * Handle incoming LINE Webhook payload
   * @param {object} payload 
   * @param {function} broadcastWs 
   */
  async handleWebhook(payload, broadcastWs) {
    const config = db.getConfig();
    const events = payload.events || [];

    for (const ev of events) {
      if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        const userText = ev.message.text;
        const replyToken = ev.replyToken;
        const userId = ev.source ? ev.source.userId : 'unknown';

        console.log(`[LINE Message Received] From: ${userId}, Text: "${userText}"`);

        // Get user profile if access token is available
        let userName = 'ลูกค้า LINE';
        let userAvatar = '';
        if (config.lineAccessToken && userId !== 'unknown') {
          try {
            const profile = await this.getUserProfile(userId, config.lineAccessToken);
            if (profile) {
              userName = profile.displayName || userName;
              userAvatar = profile.pictureUrl || '';
            }
          } catch (e) {
            console.log('[LINE Profile Fetch]', e.message);
          }
        }


        // Generate AI Reply
        const aiReply = await aiService.generateReply(userText, 'line');

        // Check Mode: Auto-Pilot vs Copilot
        if (config.mode === 'copilot') {
          // Save customer message with draft reply for admin approval
          const chatItem = db.addLineMessage({
            userId,
            userName,
            userAvatar,
            replyToken,
            text: userText,
            reply: aiReply,
            isBot: false,
            status: 'pending_approval'
          });

          if (broadcastWs) {
            broadcastWs({
              type: 'line_message_pending',
              data: chatItem
            });
          }
        } else {
          // Auto-Pilot: Send reply directly via LINE API
          let delivered = false;
          if (config.lineAccessToken && replyToken) {
            delivered = await this.sendReply(replyToken, aiReply, config.lineAccessToken);
          }

          // Save customer message
          const userMsgItem = db.addLineMessage({
            userId,
            userName,
            userAvatar,
            replyToken,
            text: userText,
            reply: '',
            isBot: false,
            status: 'received'
          });

          // Save bot reply
          const botMsgItem = db.addLineMessage({
            userId,
            userName: db.getKnowledge().shopName,
            userAvatar: '',
            replyToken: '',
            text: aiReply,
            reply: '',
            isBot: true,
            status: delivered ? 'delivered' : (config.lineAccessToken ? 'sent' : 'simulated')
          });

          if (broadcastWs) {
            broadcastWs({
              type: 'line_message_delivered',
              data: { userMsg: userMsgItem, botMsg: botMsgItem }
            });
          }
        }
      }
    }
  }

  /**
   * Send a reply message using LINE Messaging API
   */
  async sendReply(replyToken, replyText, accessToken) {
    if (!replyToken || !accessToken) {
      console.warn('[LINE SendReply] Missing replyToken or accessToken');
      return false;
    }

    try {
      const payload = {
        replyToken: replyToken,
        messages: [
          {
            type: 'text',
            text: replyText
          }
        ]
      };

      const res = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.trim()}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.text();
      console.log(`[LINE API Reply Response] Status: ${res.status}`, data);
      return res.ok;
    } catch (err) {
      console.error('[LINE API Error]', err.message);
      return false;
    }
  }

  /**
   * Send a push message directly to a LINE user by userId
   */
  async sendPushMessage(userId, text, accessToken) {
    if (!userId || !text || !accessToken) {
      console.warn('[LINE PushMessage] Missing userId, text, or accessToken');
      return false;
    }

    try {
      const payload = {
        to: userId,
        messages: [
          {
            type: 'text',
            text: text
          }
        ]
      };

      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.trim()}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.text();
      console.log(`[LINE Push Message Response] Status: ${res.status}`, data);
      return res.ok;
    } catch (err) {
      console.error('[LINE Push Message Error]', err.message);
      return false;
    }
  }

  /**
   * Fetch LINE user profile
   */
  async getUserProfile(userId, accessToken) {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken.trim()}`
      }
    });
    if (res.ok) {
      return await res.json();
    }
    return null;
  }
}

module.exports = new LineService();
