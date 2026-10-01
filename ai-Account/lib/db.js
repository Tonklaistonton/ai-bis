import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../data/account.db');

export const db = new DatabaseSync(dbPath);

export function initDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      category_id INTEGER,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'rejected')),
      reference_no TEXT UNIQUE,
      description TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_ref_id TEXT,
      image_path TEXT,
      raw_ai_payload TEXT,
      verified_by TEXT,
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories (id)
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Default categories
  const count = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (count.c === 0) {
    const insert = db.prepare('INSERT INTO categories (name, type) VALUES (?, ?)');
    insert.run('ขายสินค้า/บริการ', 'income');
    insert.run('รายได้อื่นๆ', 'income');
    insert.run('ค่าโฆษณา/การตลาด', 'expense');
    insert.run('ค่าเซิร์ฟเวอร์/เครื่องมือ', 'expense');
    insert.run('ค่าขนส่ง', 'expense');
    insert.run('ค่าใช้จ่ายเบ็ดเตล็ด', 'expense');
  }
}
