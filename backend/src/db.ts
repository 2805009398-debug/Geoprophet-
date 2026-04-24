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

  seedUsers(db);
  return db;
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

