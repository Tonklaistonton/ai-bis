/**
 * Storage + authentication tests.
 *
 * Every test runs against a throwaway SQLite file so the real data/aizen.db is
 * never opened, read or written.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `aizen-test-${process.pid}.db`);
process.env.DB_FILE = TMP_DB;

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TMP_DB + suffix, { force: true });

const db = require('../lib/db');
const auth = require('../lib/auth');
const { migrateLegacyJson, legacyPathFor } = require('../lib/migrate');

// A migration source placed next to THIS process's SQLite file. The migrator must
// only ever look there, never in the repo's real data/ folder.
const legacyPath = path.join(path.dirname(TMP_DB), 'database.json');
const legacyArchive = legacyPath + '.migrated.json';

test.after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TMP_DB + suffix, { force: true });
  for (const f of [legacyPath, legacyArchive]) fs.rmSync(f, { force: true });
});

// ---------------- storage ----------------

test('chat round-trips through SQLite with the same field names', () => {
  const saved = db.addLineMessage({ userId: 'U1', userName: 'สมชาย', text: 'สวัสดี', isBot: false });
  const loaded = db.getLineChats(10).find((m) => m.id === saved.id);
  assert.ok(loaded, 'saved message should be readable');
  assert.strictEqual(loaded.userId, 'U1');
  assert.strictEqual(loaded.userName, 'สมชาย');
  assert.strictEqual(loaded.isBot, false);
  assert.strictEqual(loaded.text, 'สวัสดี');
});

test('every read returns a fresh object, so stale references cannot leak', () => {
  const first = db.getConfig();
  first.mode = 'tampered';
  const second = db.getConfig();
  assert.notStrictEqual(second.mode, 'tampered');
});

test('updateLineMessage patches status without touching other fields', () => {
  const msg = db.addLineMessage({ userId: 'U2', text: 'ขอเช็คสถานะ', reply: 'ร่างคำตอบ' });
  db.updateLineMessage(msg.id, { status: 'delivered' });
  const after = db.getLineChats(50).find((m) => m.id === msg.id);
  assert.strictEqual(after.status, 'delivered');
  assert.strictEqual(after.reply, 'ร่างคำตอบ');
});

test('emails round-trip and update', () => {
  const mail = db.addEmail({ senderEmail: 'a@b.com', subject: 'สั่งของ', body: 'รายละเอียด' });
  db.updateEmail(mail.id, { status: 'replied' });
  const found = db.getEmails().find((e) => e.id === mail.id);
  assert.strictEqual(found.status, 'replied');
  assert.strictEqual(found.subject, 'สั่งของ');
});

test('knowledge and sync caches persist independently', () => {
  db.saveSheetsData({ products: [], faqs: [], orderGuides: [], lastSync: null });
  db.updateKnowledge({ shopName: 'ร้านทดสอบ' });
  db.saveAirtableData({ products: [{ name: 'กาแฟ' }], faqs: [], orderGuides: [], lastSync: 'now' });
  assert.strictEqual(db.getKnowledge().shopName, 'ร้านทดสอบ');
  assert.strictEqual(db.getAirtableData().products.length, 1);
  assert.strictEqual(db.getSheetsData().products.length, 0);
});

// ---------------- passwords ----------------

test('password hashes verify, and the same password hashes differently each time', () => {
  const a = auth.hashPassword('correct horse battery');
  const b = auth.hashPassword('correct horse battery');
  assert.notStrictEqual(a, b, 'salted hashes must differ');
  assert.ok(auth.verifyPassword('correct horse battery', a));
  assert.ok(auth.verifyPassword('correct horse battery', b));
  assert.ok(!auth.verifyPassword('wrong password', a));
});

test('password hash never contains the plaintext', () => {
  const hash = auth.hashPassword('hunter2000');
  assert.ok(!hash.includes('hunter2000'));
  assert.ok(hash.startsWith('scrypt$'));
});

test('authenticate rejects a wrong password and an unknown user', () => {
  auth.createUser('alice', 'alicepass123', 'admin');
  assert.ok(auth.authenticate('alice', 'alicepass123'), 'correct credentials succeed');
  assert.strictEqual(auth.authenticate('alice', 'nope'), null);
  assert.strictEqual(auth.authenticate('ghost', 'whatever'), null);
});

test('createUser refuses weak passwords, bad usernames and duplicates', () => {
  assert.ok(auth.createUser('bob', 'short').error, 'rejects short password');
  assert.ok(auth.createUser('b', 'longenough123').error, 'rejects short username');
  assert.ok(auth.createUser('alice', 'anotherpass123').error, 'rejects duplicate username');
});

// ---------------- sessions ----------------

test('a session resolves to its user, and stops working once deleted', () => {
  const alice = auth.authenticate('alice', 'alicepass123');
  const { token } = auth.createSession(alice.id);

  const live = auth.getSessionUser(token);
  assert.ok(live, 'fresh session must resolve');
  assert.strictEqual(live.username, 'alice');

  auth.deleteSession(token);
  assert.strictEqual(auth.getSessionUser(token), null, 'deleted session must not resolve');
});

test('an expired session is rejected', () => {
  const alice = auth.authenticate('alice', 'alicepass123');
  const { token } = auth.createSession(alice.id);
  db.sqlite
    .prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
    .run(new Date(Date.now() - 1000).toISOString(), token);
  assert.strictEqual(auth.getSessionUser(token), null);
});

test('changing a password invalidates every session for that user', () => {
  const carol = auth.createUser('carol', 'carolpass123', 'staff').user;
  const { token } = auth.createSession(carol.id);
  assert.ok(auth.getSessionUser(token));

  const result = auth.changePassword(carol.id, 'carolpass123', 'newcarol123');
  assert.ok(result.ok, 'password change should succeed');
  assert.strictEqual(auth.getSessionUser(token), null, 'old sessions must be destroyed');
  assert.ok(auth.authenticate('carol', 'newcarol123'));
  assert.strictEqual(auth.authenticate('carol', 'carolpass123'), null);
});

test('changing a password with the wrong current password is refused', () => {
  const dave = auth.createUser('dave', 'davepass12345', 'staff').user;
  const result = auth.changePassword(dave.id, 'not-the-password', 'whatever12345');
  assert.ok(result.error);
});

// ---------------- cookies ----------------

test('cookie parsing handles multiple pairs and encoded values', () => {
  const parsed = auth.parseCookies('a=1; aizen_session=abc123; b=hello%20world');
  assert.strictEqual(parsed.a, '1');
  assert.strictEqual(parsed.aizen_session, 'abc123');
  assert.strictEqual(parsed.b, 'hello world');
});

test('cookie parsing tolerates a missing or empty header', () => {
  assert.deepStrictEqual(auth.parseCookies(undefined), {});
  assert.deepStrictEqual(auth.parseCookies(''), {});
});

// ---------------- legacy migration ----------------

test('legacy JSON migration imports config, knowledge and chats, then archives the source', () => {
  fs.writeFileSync(
    legacyPath,
    JSON.stringify({
      config: { mode: 'autopilot', adminPin: '1234', geminiApiKey: 'AIzaSy-test' },
      knowledge: { shopName: 'ร้านเก่า' },
      lineChats: [
        { id: 'old-1', userId: 'U9', userName: 'ลูกค้าเก่า', text: 'สวัสดี', isBot: false, timestamp: '2026-01-01T00:00:00.000Z' }
      ],
      emails: [{ id: 'old-e1', senderEmail: 'x@y.com', subject: 'เก่า', timestamp: '2026-01-01T00:00:00.000Z' }]
    })
  );

  const result = migrateLegacyJson(db);
  assert.strictEqual(result.migrated, true);
  assert.strictEqual(result.chats, 1);
  assert.strictEqual(result.emails, 1);

  assert.strictEqual(db.getConfig().mode, 'autopilot');
  assert.strictEqual(db.getKnowledge().shopName, 'ร้านเก่า');
  assert.strictEqual(db.getConfig().adminPin, undefined, 'legacy PIN must not be migrated');
  assert.ok(db.getLineChats(500).some((m) => m.id === 'old-1'));
  assert.ok(db.getEmails().some((e) => e.id === 'old-e1'));

  assert.ok(fs.existsSync(legacyArchive), 'original must be kept as an archive');
  assert.ok(!fs.existsSync(legacyPath), 'source must be renamed, not deleted');
});

test('a second migration run is a no-op', () => {
  const again = migrateLegacyJson(db);
  assert.strictEqual(again.migrated, false);
  assert.strictEqual(db.getLineChats(500).filter((m) => m.id === 'old-1').length, 1);
});

test('the migrator never reaches outside the directory of its own database file', () => {
  // Regression guard: a test/preview run with DB_FILE set must not rename the
  // customer's real data/database.json.
  const repoReal = path.join(__dirname, '..', 'data', 'database.json.migrated.json');
  const scoped = legacyPathFor();
  assert.strictEqual(path.dirname(scoped.json), path.dirname(db.DB_FILE));
  assert.notStrictEqual(scoped.json, repoReal, 'this test DB is in a temp dir, not the repo data folder');
  assert.ok(fs.existsSync(repoReal), "the repo's real archived database must be untouched");
});