/**
 * AIZEN RESPONDER - One-time JSON -> SQLite migration
 *
 * Runs automatically on first boot when data/database.json exists but the
 * SQLite file does not. Never overwrites existing SQLite data.
 */

const fs = require('fs');
const path = require('path');

// Safety rule: only ever import from a database.json sitting in the SAME directory
// as the SQLite file this process opened. A test or preview run that sets DB_FILE
// must never reach into the real data/ folder and rename the customer's file.
// Read from the environment rather than the db instance: lib/db.js exports a
// singleton, so db.DB_FILE is not attached yet while the constructor runs.
function legacyPathFor() {
  const dbFile = process.env.DB_FILE
    ? path.resolve(process.env.DB_FILE)
    : path.join(__dirname, '..', 'data', 'aizen.db');
  const json = path.join(path.dirname(dbFile), 'database.json');
  return { json, archive: json + '.migrated.json' };
}

function legacyExists(json, archive) {
  return fs.existsSync(json) && !fs.existsSync(archive);
}

/**
 * Import the legacy JSON store into an already-open Database instance.
 * Safe to call twice: the archive rename makes the second run a no-op.
 */
function migrateLegacyJson(db) {
  const scoped = legacyPathFor();
  if (!legacyExists(scoped.json, scoped.archive)) return { migrated: false, reason: 'no-legacy-json' };

  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(scoped.json, 'utf-8'));
  } catch (err) {
    console.error(`[Migration] Cannot read legacy ${scoped.json}: ${err.message}`);
    return { migrated: false, reason: 'unreadable-json', error: err.message };
  }

  const counts = { chats: 0, emails: 0 };

  if (legacy.config && typeof legacy.config === 'object') {
    // adminPin is intentionally dropped: auth is now real user accounts.
    const config = { ...legacy.config };
    delete config.adminPin;
    db.updateConfig(config);
  }

  if (legacy.knowledge && typeof legacy.knowledge === 'object') {
    db.updateKnowledge(legacy.knowledge);
  }

  if (Array.isArray(legacy.lineChats)) {
    // Oldest first so the 200-row cap keeps the most recent messages.
    for (const msg of legacy.lineChats.slice().reverse()) {
      const { messageId, ...rest } = msg;
      db.addLineMessage(rest);
      counts.chats++;
    }
  }

  if (Array.isArray(legacy.emails)) {
    for (const mail of legacy.emails.slice().reverse()) {
      db.addEmail(mail);
      counts.emails++;
    }
  }

  if (legacy.airtableData && legacy.airtableData.lastSync) {
    db.saveAirtableData(legacy.airtableData);
  }
  if (legacy.sheetsData && legacy.sheetsData.lastSync) {
    db.saveSheetsData(legacy.sheetsData);
  }

  // Keep the original file intact as a recoverable archive.
  try {
    fs.renameSync(scoped.json, scoped.archive);
  } catch (err) {
    console.error(`[Migration] Could not archive legacy JSON: ${err.message}`);
  }

  return { migrated: true, ...counts };
}

module.exports = { migrateLegacyJson, legacyPathFor };