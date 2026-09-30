/**
 * Isolated preview runner for browser testing and demos.
 *
 * Builds a throwaway SQLite database from tests/fixtures/database.json so the
 * preview NEVER reads or writes the real data/aizen.db. All provider
 * credentials stay blank (no real LINE/SMTP/Airtable/Sheets calls possible).
 *
 * Seeds one demo account so you can log in without running the setup wizard:
 *   username: demo   password: demo1234
 */
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, 'tests', 'fixtures', 'database.json');
const DB_PATH = path.join(__dirname, 'data', 'preview.db');

for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(DB_PATH + suffix, { force: true });
}

process.env.DB_FILE = DB_PATH;
process.env.PORT = process.env.PORT || '3000';

const db = require('./lib/db');
const auth = require('./lib/auth');

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
const { adminPin, ...config } = fixture.config || {};

db.updateConfig(config);
db.updateKnowledge(fixture.knowledge || {});

if (Array.isArray(fixture.lineChats)) {
  for (const msg of fixture.lineChats) {
    const { messageId, ...rest } = msg;
    db.addLineMessage(rest);
  }
}
if (Array.isArray(fixture.emails)) {
  for (const mail of fixture.emails) db.addEmail(mail);
}

if (auth.countUsers() === 0) {
  const created = auth.createUser('demo', 'demo1234', 'admin');
  if (created.error) {
    console.error('[Preview] Could not seed demo account:', created.error);
    process.exit(1);
  }
  console.log('[Preview] Demo account ready — username: demo / password: demo1234');
}

// Every install needs at least one team with at least one channel, otherwise
// staff have nothing to see and the webhook has no room to file messages in.
if (db.listTeams().length === 0) {
  const { team } = db.createTeam('ทีมหลัก');
  db.addUserToTeam(team.id, auth.listUsers()[0].id);
  db.createChannel({ teamId: team.id, type: 'line', name: 'LINE หลัก' });
  console.log('[Preview] Seeded default team "ทีมหลัก" with one LINE channel');
}

require('./server.js');