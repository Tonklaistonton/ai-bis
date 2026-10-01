/**
 * AIZEN RESPONDER - Authentication
 *
 * Real server-side accounts and sessions. Passwords are hashed with scrypt;
 * sessions are opaque random tokens in the database, delivered via an
 * httpOnly cookie. No third-party auth dependency.
 */

const crypto = require('crypto');
const db = require('./db');

const SESSION_COOKIE = 'aizen_session';
const SESSION_DAYS = 7;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

// ---------------- password hashing ----------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), hash.toString('hex')].join('$');
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p)
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

// ---------------- accounts ----------------

function countUsers() {
  return db.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function createUser(username, password, role = 'staff') {
  const name = String(username || '').trim();
  if (!USERNAME_RE.test(name)) {
    return { error: 'ชื่อผู้ใช้ต้องเป็น 3-32 ตัว ใช้ได้เฉพาะ ตัวอักษร ตัวเลข . _ -' };
  }
  if (String(password || '').length < 8) {
    return { error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' };
  }
  try {
    const info = db.sqlite
      .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(name, hashPassword(password), role === 'admin' ? 'admin' : 'staff', new Date().toISOString());
    return { user: getUserById(Number(info.lastInsertRowid)) };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' };
    }
    return { error: err.message };
  }
}

function getUserById(id) {
  const row = db.sqlite
    .prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?')
    .get(id);
  return row ? publicUser(row) : null;
}

function getUserByUsername(username) {
  const row = db.sqlite
    .prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?')
    .get(String(username || '').trim());
  return row || null;
}

function listUsers() {
  return db.sqlite
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY id')
    .all()
    .map(publicUser);
}

function publicUser(row) {
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

// ---------------- team access ----------------

/** Admins reach every team; staff only the ones they are a member of. */
function getVisibleTeams(user) {
  if (!user) return [];
  if (user.role === 'admin') return db.listTeams();
  return db.getUserTeams(user.id).map((t) => ({ ...t, members: db.getTeamMembers(t.id) }));
}

function getTeamIds(user) {
  if (!user) return [];
  if (user.role === 'admin') return db.listTeams().map((t) => t.id);
  return db.getUserTeams(user.id).map((t) => t.id);
}

function isTeamMember(user, teamId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return db.getUserTeams(user.id).some((t) => t.id === Number(teamId));
}

/**
 * Strict Claim/Assign rule: Claim-Before-Send.
 * Only the assigned staff member or an admin may reply. Unassigned rooms must be claimed first.
 */
function canReplyToConversation(user, conversation) {
  if (!user || !conversation) return false;
  if (user.role === 'admin') return true;
  return conversation.assignedUserId !== null && conversation.assignedUserId === user.id;
}

function authenticate(username, password) {
  const row = getUserByUsername(username);
  // Always run a hash comparison so a missing user and a wrong password take
  // comparable time and cannot be distinguished by response latency.
  const reference = row ? row.password_hash : hashPassword('__no_such_user__');
  const ok = verifyPassword(password, reference);
  if (!row || !ok) return null;
  return publicUser(row);
}

// ---------------- sessions ----------------

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.sqlite
    .prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, expires.toISOString(), now.toISOString());
  return { token, expiresAt: expires };
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db.sqlite
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.username, u.role, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteSession(token);
    return null;
  }
  return { ...publicUser(row), sessionToken: row.token, expiresAt: row.expires_at };
}

function deleteSession(token) {
  if (!token) return;
  db.sqlite.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function deleteSessionsForUser(userId) {
  db.sqlite.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function purgeExpiredSessions() {
  db.sqlite.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

// ---------------- skip-login (dev convenience) ----------------
// Opt-in via AIZEN_SKIP_LOGIN=1. Deliberately NOT enabled by default: it would
// hand every unauthenticated caller admin rights. On a fresh install it seeds
// the same dev account preview.js uses, so dev works without the wizard.
const skipLoginEnabled = String(process.env.AIZEN_SKIP_LOGIN || '') === '1';
const SKIP_LOGIN_USER = 'dev';
const SKIP_LOGIN_PASSWORD = 'dev12345';

function getSkipLoginUser() {
  if (!skipLoginEnabled) return null;
  let admin = db.sqlite.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!admin) {
    const seeded = createUser(SKIP_LOGIN_USER, SKIP_LOGIN_PASSWORD, 'admin');
    if (seeded.error) {
      console.error('[Auth] skip-login seed failed:', seeded.error);
      return null;
    }
    console.warn(`[Auth] AIZEN_SKIP_LOGIN=1 — seeded dev admin "${SKIP_LOGIN_USER}". Do NOT use in production.`);
    admin = db.sqlite.prepare('SELECT * FROM users WHERE username = ?').get(SKIP_LOGIN_USER);
    // Without a team + channel the admin has no room to read messages in.
    if (admin && db.listTeams().length === 0) {
      const { team } = db.createTeam('ทีมหลัก');
      db.addUserToTeam(team.id, admin.id);
      db.createChannel({ teamId: team.id, type: 'line', name: 'LINE หลัก' });
    }
  }
  return admin ? publicUser(admin) : null;
}

function changePassword(userId, oldPassword, newPassword) {
  const row = db.sqlite.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId);
  if (!row) return { error: 'ไม่พบผู้ใช้' };
  if (!verifyPassword(oldPassword, row.password_hash)) return { error: 'รหัสผ่านเดิมไม่ถูกต้อง' };
  if (String(newPassword || '').length < 8) return { error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' };
  db.sqlite.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  // A password change invalidates every other device.
  deleteSessionsForUser(userId);
  return { ok: true };
}

// ---------------- cookie helpers ----------------

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function isSecureRequest(req) {
  if (req.secure) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function setSessionCookie(req, res, token, expiresAt) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  // Mark Secure whenever the request arrived over HTTPS (tunnel included),
  // otherwise the cookie would still travel in the clear on the public hop.
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

module.exports = {
  SESSION_COOKIE,
  SESSION_DAYS,
  hashPassword,
  verifyPassword,
  countUsers,
  createUser,
  getUserById,
  getUserByUsername,
  listUsers,
  authenticate,
  getVisibleTeams,
  getTeamIds,
  isTeamMember,
  canReplyToConversation,
  createSession,
  getSessionUser,
  deleteSession,
  deleteSessionsForUser,
  purgeExpiredSessions,
  getSkipLoginUser,
  changePassword,
  parseCookies,
  setSessionCookie,
  clearSessionCookie
};