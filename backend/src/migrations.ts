import type Database from 'better-sqlite3';

export type RuntimeMigration = {
  id: string;
  name: string;
  up: (db: Database.Database) => void;
};

export function applyRuntimeMigrations(db: Database.Database, migrations: RuntimeMigration[]) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const hasMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const insertMigration = db.prepare(`
    INSERT INTO schema_migrations (id, name, applied_at)
    VALUES (@id, @name, @appliedAt)
  `);

  const applyMigration = db.transaction((migration: RuntimeMigration) => {
    migration.up(db);
    insertMigration.run({
      id: migration.id,
      name: migration.name,
      appliedAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
    });
  });

  for (const migration of migrations) {
    if (hasMigration.get(migration.id)) {
      continue;
    }

    applyMigration(migration);
  }
}

export function listRuntimeMigrations(db: Database.Database) {
  return db
    .prepare(`
      SELECT id, name, applied_at AS appliedAt
      FROM schema_migrations
      ORDER BY applied_at DESC, id DESC
    `)
    .all();
}
