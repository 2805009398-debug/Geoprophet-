import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runtimePaths } from './config';
import { createPasswordRecord } from './password';

const demoUsers = [
  { username: 'admin', password: 'admin123', role: 'admin', displayName: '系统管理员' },
  { username: 'operator', password: 'operator123', role: 'operator', displayName: '值班监测员' },
  { username: 'expert', password: 'expert123', role: 'expert', displayName: '地灾研判专家' }
];

export function createDatabase() {
  fs.mkdirSync(path.dirname(runtimePaths.dbPath), { recursive: true });
  fs.mkdirSync(runtimePaths.uploadsDir, { recursive: true });
  fs.mkdirSync(runtimePaths.analysisUploadsDir, { recursive: true });

  const db = new Database(runtimePaths.dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const hasSchema = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sites'")
    .get();

  if (!hasSchema) {
    const initSql = fs.readFileSync(runtimePaths.initSqlPath, 'utf8');
    db.exec(initSql);
  }

  ensureRuntimeSchema(db);
  seedUsers(db);
  return db;
}

function ensureRuntimeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_name TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      summary TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.prepare(`
    INSERT OR IGNORE INTO analysis_models (
      name, category, version, accuracy, status, last_run_at, summary
    )
    VALUES (
      @name, @category, @version, @accuracy, @status, @lastRunAt, @summary
    )
  `).run({
    name: 'GlacierSAR-Net',
    category: '冰川识别',
    version: 'v1.0.0',
    accuracy: 0.89,
    status: 'stable',
    lastRunAt: '2026-04-23 05:40:00',
    summary: '面向 InSAR 幅值/相位输入的冰川边界识别与变化敏感区分割模型。'
  });
}

function seedUsers(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number };
  if (count.total > 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO users (username, display_name, role, password_salt, password_hash)
    VALUES (@username, @displayName, @role, @salt, @hash)
  `);

  const transaction = db.transaction(() => {
    for (const user of demoUsers) {
      const password = createPasswordRecord(user.password);
      insert.run({
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        salt: password.salt,
        hash: password.hash
      });
    }
  });

  transaction();
}
