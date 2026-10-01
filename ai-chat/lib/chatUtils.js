/**
 * Pure helpers for LINE session/chat UI logic.
 * Shared by the React frontend and node:test unit tests (CommonJS so tests can require()).
 */

/**
 * Group raw messages into per-customer sessions.
 * Input is expected newest-first (server returns newest first).
 * Skips the synthetic 'admin' pseudo-user created when sending without a userId.
 */
function buildSessions(messages) {
  const map = new Map();
  for (const m of Array.isArray(messages) ? messages : []) {
    const uid = m.userId || 'unknown';
    if (uid === 'admin') continue;
    if (!map.has(uid)) {
      map.set(uid, {
        userId: uid,
        userName: m.userName || 'ลูกค้า LINE',
        userAvatar: m.userAvatar || '',
        lastText: m.text || '',
        lastTs: m.timestamp || '',
        lastIsBot: Boolean(m.isBot),
        pending: false
      });
    }
    if (m.status === 'pending_approval') map.get(uid).pending = true;
  }
  // Map preserves first-insert order; input is newest-first so sessions are newest-first.
  return Array.from(map.values());
}

/** Keep only one customer's messages, oldest-first for display. */
function filterMessages(messages, userId) {
  if (!userId) return [];
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m.userId === userId);
  return list.slice().reverse();
}

/** Latest pending Copilot draft for a customer, or null. */
function findPendingDraft(messages, userId) {
  if (!userId) return null;
  const list = Array.isArray(messages) ? messages : [];
  return list.find((m) => m.userId === userId && m.status === 'pending_approval' && m.reply) || null;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/** Returns an error message, or null when the compose form is valid. */
function validateCompose({ to, text }) {
  if (!isEmail(to)) return 'กรุณากรอกอีเมลผู้รับให้ถูกต้อง';
  if (!String(text || '').trim()) return 'กรุณากรอกเนื้อหาอีเมล';
  return null;
}

/** Draft must not be dispatched without a selected real customer. */
function canSendMessage({ text, activeUserId, sending }) {
  if (sending) return false;
  if (!activeUserId || activeUserId === 'admin') return false;
  return Boolean(String(text || '').trim());
}

function formatTime(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '-';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch (e) {
    return '-';
  }
}

module.exports = {
  buildSessions,
  filterMessages,
  findPendingDraft,
  isEmail,
  validateCompose,
  canSendMessage,
  formatTime
};
