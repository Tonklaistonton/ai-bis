/**
 * End-to-end HTTP tests for the auth surface.
 *
 * These boot the real Express server against a throwaway SQLite file. The unit
 * tests in auth-db.test.js cover hashing and sessions; these cover the guards
 * that live in server.js, which is where two real holes were found and fixed.
 *
 * Never touches data/aizen.db, never calls LINE, SMTP, Airtable or Sheets.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `aizen-http-${process.pid}.db`);

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
process.env.DB_FILE = DB;
process.env.PORT = String(PORT);

test.before(async () => {
  // server.js starts listening on require; wait for the port to answer.
  require('../server.js');
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${BASE}/api/auth/setup-status`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server did not start');
});

test.after(() => {
  // server.js keeps its own listener; it is never handed to us, so close the
  // process once the DB handle is released. No process.exit before the last
  // test has reported - that would silently truncate the run.
  require('../lib/db').close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
});

// fetch that keeps a cookie jar, like a browser would.
function client() {
  let cookie = '';
  return async (path_, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + path_, { ...opts, headers, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body, headers: res.headers };
  };
}

test('a virgin install asks for setup', async () => {
  const req = client();
  const res = await req('/api/auth/setup-status');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.needsSetup, true);
});

test('every API route is closed to an anonymous caller', async () => {
  const req = client();
  for (const [method, path_] of [
    ['GET', '/api/config'],
    ['POST', '/api/config'],
    ['GET', '/api/status'],
    ['GET', '/api/line/chats'],
    ['GET', '/api/emails'],
    ['GET', '/api/auth/users'],
    ['POST', '/api/airtable/sync'],
    ['POST', '/api/sheets/sync']
  ]) {
    const res = await req(path_, { method, body: method === 'POST' ? '{}' : undefined });
    assert.strictEqual(res.status, 401, `${method} ${path_} must be 401, got ${res.status}`);
  }
});

test('setup refuses a mismatched password confirmation', async () => {
  const req = client();
  const res = await req('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'owner',
      password: 'strongpass1',
      confirmPassword: 'different1',
      shopName: 'ร้านทดสอบ'
    })
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.success, false);
  // The rejected attempt must not have created the account.
  const after = await req('/api/auth/setup-status');
  assert.strictEqual(after.body.needsSetup, true, 'a refused setup must not claim the install');
});

test('setup accepts a valid first account and logs it in', async () => {
  const req = client();
  const res = await req('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'owner',
      password: 'strongpass1',
      confirmPassword: 'strongpass1',
      shopName: 'ร้านทดสอบ',
      openingHours: 'จ.-ส. 09:00-18:00'
    })
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.role, 'admin');
  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/i, 'session cookie must be httpOnly');
});

test('setup is permanently closed once the install is claimed', async () => {
  const req = client();
  const res = await req('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'attacker',
      password: 'attacker123',
      confirmPassword: 'attacker123',
      shopName: 'แฮก'
    })
  });
  assert.strictEqual(res.status, 409, `a second admin must be refused, got ${res.status}`);
  assert.strictEqual(require('../lib/auth').getUserByUsername('attacker'), null);
});

test('the session endpoint never hands the token back to the browser', async () => {
  const req = client();
  await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'strongpass1' })
  });
  const res = await req('/api/auth/me');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.username, 'owner');
  assert.ok(!('sessionToken' in res.body.user), 'the session token is the credential - never echo it');
  assert.ok(!('password_hash' in res.body.user));
  assert.ok(!('passwordHash' in res.body.user));
});

test('logout really invalidates the session', async () => {
  const req = client();
  await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'strongpass1' })
  });
  assert.strictEqual((await req('/api/config')).status, 200, 'logged in');

  await req('/api/auth/logout', { method: 'POST' });
  assert.strictEqual((await req('/api/config')).status, 401, 'a stale cookie must stop working');
});

test('a wrong password is refused identically to an unknown user', async () => {
  const attempt = (body) =>
    fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const wrongPassword = await attempt({ username: 'owner', password: 'not-the-password' });
  const unknownUser = await attempt({ username: 'no-such-person', password: 'whatever12345' });

  assert.strictEqual(wrongPassword.status, 401);
  assert.strictEqual(unknownUser.status, 401);
  // Byte-identical replies: a prober must not be able to tell which usernames exist.
  assert.deepStrictEqual(await wrongPassword.json(), await unknownUser.json());
});

test('a staff account cannot manage accounts or write credentials', async () => {
  const admin = client();
  const adminLogin = await admin('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'strongpass1' })
  });
  assert.strictEqual(adminLogin.status, 200, JSON.stringify(adminLogin.body));

  const created = await admin('/api/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'clerk', password: 'clerkshop123', role: 'staff' })
  });
  assert.strictEqual(created.status, 200, JSON.stringify(created.body));

  const staff = client();
  const login = await staff('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'clerk', password: 'clerkshop123' })
  });
  assert.strictEqual(login.status, 200);

  assert.strictEqual((await staff('/api/auth/users')).status, 403, 'staff must not list accounts');
  const write = await staff('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { mode: 'autopilot' } })
  });
  assert.strictEqual(write.status, 403, 'staff must not write credentials');
  assert.strictEqual((await admin('/api/config')).body.config.mode, 'copilot', 'config must be untouched');
});

test('the last admin cannot be deleted', async () => {
  const admin = client();
  await admin('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'strongpass1' })
  });
  const users = await admin('/api/auth/users');
  const owner = users.body.users.find((u) => u.username === 'owner');
  const res = await admin(`/api/auth/users/${owner.id}`, { method: 'DELETE' });
  assert.ok(res.status >= 400, 'deleting the only admin must fail');
  assert.ok(require('../lib/auth').getUserByUsername('owner'), 'the admin must still exist');
});

test('source files and the data folder are not served over HTTP', async () => {
  for (const path_ of [
    '/data/database.json',
    '/data/database.json.migrated.json',
    '/data/aizen.db',
    '/lib/db.js',
    '/lib/auth.js',
    '/server.js',
    '/preview.js',
    '/../lib/auth.js',
    '/%2e%2e/server.js'
  ]) {
    const res = await fetch(BASE + path_);
    assert.ok(res.status === 404 || res.status === 400, `${path_} leaked with ${res.status}`);
  }
});
