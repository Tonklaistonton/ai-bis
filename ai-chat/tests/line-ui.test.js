/**
 * Regression tests for the React LINE/email UI helpers (lib/chatUtils.js).
 * These cover the behaviors the legacy js/lineSimulator.js tests asserted:
 * session isolation, no-recipient guard, draft retention, Copilot draft binding,
 * plus compose validation for the email page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSessions,
  filterMessages,
  findPendingDraft,
  isEmail,
  validateCompose,
  canSendMessage,
  formatTime
} = require('../lib/chatUtils');

const MESSAGES = [
  // newest first, as the server returns them
  { id: 'm5', userId: 'U2', userName: 'บี', text: 'บอทตอบบี', isBot: true, status: 'sent', timestamp: '2026-09-30T10:05:00Z' },
  { id: 'm4', userId: 'U1', userName: 'สมชาย', text: 'บอทตอบสมชาย', isBot: true, status: 'sent', timestamp: '2026-09-30T10:04:00Z' },
  {
    id: 'm3',
    userId: 'U1',
    userName: 'สมชาย',
    text: 'สินค้าราคาเท่าไหร่',
    reply: 'ราคา 500 บาทครับ',
    replyToken: 'tok-3',
    messageId: 'm3',
    isBot: false,
    status: 'pending_approval',
    timestamp: '2026-09-30T10:03:00Z'
  },
  { id: 'm2', userId: 'U2', userName: 'บี', text: 'สวัสดีครับ', isBot: false, status: 'delivered', timestamp: '2026-09-30T10:02:00Z' },
  { id: 'm1', userId: 'U1', userName: 'สมชาย', text: 'สวัสดีครับ', isBot: false, status: 'delivered', timestamp: '2026-09-30T10:01:00Z' },
  { id: 'm0', userId: 'admin', text: 'ข้อความทดสอบโดยไม่ระบุผู้รับ', isBot: true, status: 'simulated', timestamp: '2026-09-30T10:00:00Z' }
];

test('buildSessions splits customers and never mixes their previews', () => {
  const sessions = buildSessions(MESSAGES);
  const ids = sessions.map((s) => s.userId);
  assert.deepEqual(ids, ['U2', 'U1']); // newest activity first
  const u1 = sessions.find((s) => s.userId === 'U1');
  const u2 = sessions.find((s) => s.userId === 'U2');
  assert.equal(u1.userName, 'สมชาย');
  assert.equal(u2.userName, 'บี');
  // last activity preview must come from that user's newest message
  assert.equal(u1.lastText, 'บอทตอบสมชาย');
  assert.equal(u2.lastText, 'บอทตอบบี');
});

test('buildSessions drops the synthetic admin pseudo-user', () => {
  const ids = buildSessions(MESSAGES).map((s) => s.userId);
  assert.ok(!ids.includes('admin'));
});

test('filterMessages returns only the active room, oldest first', () => {
  const list = filterMessages(MESSAGES, 'U1');
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((m) => m.id), ['m1', 'm3', 'm4']);
  assert.ok(list.every((m) => m.userId === 'U1'));
  assert.deepEqual(filterMessages(MESSAGES, null), []);
});

test('drafts are per-user: cannot send without a selected real recipient', () => {
  assert.equal(canSendMessage({ text: 'สวัสดี', activeUserId: null, sending: false }), false);
  assert.equal(canSendMessage({ text: 'สวัสดี', activeUserId: 'admin', sending: false }), false);
  assert.equal(canSendMessage({ text: '   ', activeUserId: 'U1', sending: false }), false);
  assert.equal(canSendMessage({ text: 'สวัสดี', activeUserId: 'U1', sending: true }), false);
  assert.equal(canSendMessage({ text: 'สวัสดี', activeUserId: 'U1', sending: false }), true);
  // after a failed send the draft is kept → still sendable on retry
  assert.equal(canSendMessage({ text: 'ข้อความเดิมหลังส่งพลาด', activeUserId: 'U1', sending: false }), true);
});

test('findPendingDraft binds a Copilot draft to its own room only', () => {
  const draft = findPendingDraft(MESSAGES, 'U1');
  assert.ok(draft);
  assert.equal(draft.reply, 'ราคา 500 บาทครับ');
  assert.equal(draft.replyToken, 'tok-3');
  assert.equal(draft.messageId, 'm3');
  // U2 has no pending draft even though U1 does
  assert.equal(findPendingDraft(MESSAGES, 'U2'), null);
  assert.equal(findPendingDraft(MESSAGES, null), null);
});

test('buildSessions flags rooms that have a pending Copilot draft', () => {
  const u1 = buildSessions(MESSAGES).find((s) => s.userId === 'U1');
  const u2 = buildSessions(MESSAGES).find((s) => s.userId === 'U2');
  assert.equal(u1.pending, true);
  assert.equal(u2.pending, false);
});

test('email compose validation: invalid recipient never sends, empty body never sends', () => {
  assert.equal(isEmail('shop@mail.com'), true);
  assert.equal(isEmail('not-an-email'), false);
  assert.equal(isEmail(''), false);
  assert.equal(validateCompose({ to: 'shop@mail.com', text: 'สวัสดีครับ' }), null);
  assert.match(validateCompose({ to: 'bad', text: 'สวัสดีครับ' }), /อีเมล/);
  assert.match(validateCompose({ to: 'shop@mail.com', text: '   ' }), /เนื้อหา/);
  // history being empty does not affect compose validity (pure function)
  assert.equal(validateCompose({ to: 'a@b.co', text: 'ok' }), null);
});

test('formatTime renders HH:MM and fails safe on garbage', () => {
  assert.equal(formatTime('2026-09-30T10:05:00Z').length, 5);
  assert.equal(formatTime(''), '-');
  assert.equal(formatTime('not-a-date'), '-');
  assert.equal(formatTime(null), '-');
});
