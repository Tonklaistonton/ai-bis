/**
 * AIZEN RESPONDER - Real Gmail Service via Nodemailer (SMTP / App Password)
 * Handles sending real emails, verifying credentials, and managing email threads
 */

const nodemailer = require('nodemailer');
const db = require('./db');

class GmailService {
  /**
   * Create a configured nodemailer transporter
   */
  getTransporter() {
    const config = db.getConfig();
    if (!config.gmailUser || !config.gmailAppPassword) {
      return null;
    }

    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.gmailUser.trim(),
        pass: config.gmailAppPassword.trim().replace(/\s+/g, '') // remove spaces from 16-char app password
      }
    });
  }

  /**
   * Verify SMTP credentials
   */
  async verifyConnection() {
    const transporter = this.getTransporter();
    if (!transporter) {
      return { success: false, message: 'กรุณากรอก Gmail และ App Password ก่อนทดสอบ' };
    }

    try {
      await transporter.verify();
      return { success: true, message: 'เชื่อมต่อ Gmail SMTP สำเร็จ พร้อมส่งอีเมลจริง' };
    } catch (err) {
      return { success: false, message: `เชื่อมต่อไม่สำเร็จ: ${err.message}` };
    }
  }

  /**
   * Send a real email
   */
  async sendEmail({ to, subject, text, inReplyTo }) {
    const config = db.getConfig();
    const kb = db.getKnowledge();
    const transporter = this.getTransporter();

    if (!transporter) {
      throw new Error('กรุณาตั้งค่า Gmail Account และ App Password ในหน้า API Config ก่อนส่ง');
    }

    const mailOptions = {
      from: `"${kb.shopName}" <${config.gmailUser.trim()}>`,
      to: to.trim(),
      subject: subject,
      text: text,
      inReplyTo: inReplyTo || undefined
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email Sent] MessageId: ${info.messageId} to ${to}`);

    // Log to DB
    db.addEmail({
      senderName: kb.shopName,
      senderEmail: to,
      subject: subject,
      body: text,
      draftReply: '',
      status: 'replied'
    });

    return { success: true, messageId: info.messageId };
  }
}

module.exports = new GmailService();
