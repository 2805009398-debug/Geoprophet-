import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { appConfig, runtimePaths } from './config';
import { applyRuntimeMigrations } from './migrations';
import { createPasswordRecord, verifyPassword } from './password';

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
  configureJournalMode(db);

  const hasSchema = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sites'")
    .get();

  if (!hasSchema) {
    const initSql = fs.readFileSync(runtimePaths.initSqlPath, 'utf8');
    db.exec(initSql);
  }

  ensureRuntimeSchema(db);
  ensureUsers(db);
  return db;
}

function configureJournalMode(db: Database.Database) {
  db.pragma(`journal_mode = ${appConfig.sqliteJournalMode.toUpperCase()}`);
}

function ensureRuntimeSchema(db: Database.Database) {
  applyRuntimeMigrations(db, [
    {
      id: '20260525_001_analysis_audit_indexes',
      name: 'Create analysis/audit runtime tables and common indexes',
      up: (database) => {
        database.exec(`
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

          CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER,
            actor_name TEXT,
            actor_role TEXT,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            summary TEXT NOT NULL,
            metadata_json TEXT,
            request_id TEXT,
            ip TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
          );

          CREATE INDEX IF NOT EXISTS idx_alerts_status_created_at ON alerts(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_crowd_reports_status_created_at ON crowd_reports(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_observations_sensor_observed_at ON observations(sensor_id, observed_at);
          CREATE INDEX IF NOT EXISTS idx_analysis_runs_created_at ON analysis_runs(created_at);
          CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
          CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
        `);

        ensureColumn(database, 'audit_logs', 'request_id', 'TEXT');
      }
    },
    {
      id: '20260525_002_domain_events_outbox',
      name: 'Create domain events outbox table',
      up: (database) => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS domain_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            aggregate_type TEXT NOT NULL,
            aggregate_id TEXT NOT NULL,
            payload_json TEXT,
            status TEXT NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            request_id TEXT,
            created_at TEXT NOT NULL,
            published_at TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_domain_events_status_created_at ON domain_events(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON domain_events(aggregate_type, aggregate_id);
        `);
      }
    },
    {
      id: '20260531_001_yolo_training_datasets',
      name: 'Create YOLO training dataset registry tables',
      up: (database) => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS yolo_datasets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            task_type TEXT NOT NULL,
            class_names_json TEXT NOT NULL,
            dataset_path TEXT NOT NULL,
            data_yaml_path TEXT NOT NULL,
            source_root TEXT,
            manifest_path TEXT,
            status TEXT NOT NULL,
            image_count INTEGER NOT NULL DEFAULT 0,
            label_count INTEGER NOT NULL DEFAULT 0,
            box_count INTEGER NOT NULL DEFAULT 0,
            problem_count INTEGER NOT NULL DEFAULT 0,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS yolo_dataset_splits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dataset_id INTEGER NOT NULL,
            split TEXT NOT NULL,
            image_count INTEGER NOT NULL DEFAULT 0,
            label_count INTEGER NOT NULL DEFAULT 0,
            box_count INTEGER NOT NULL DEFAULT 0,
            UNIQUE(dataset_id, split),
            FOREIGN KEY(dataset_id) REFERENCES yolo_datasets(id) ON DELETE CASCADE
          );

          CREATE TABLE IF NOT EXISTS yolo_dataset_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dataset_id INTEGER NOT NULL,
            source_name TEXT NOT NULL,
            image_count INTEGER NOT NULL DEFAULT 0,
            label_count INTEGER NOT NULL DEFAULT 0,
            box_count INTEGER NOT NULL DEFAULT 0,
            problem_count INTEGER NOT NULL DEFAULT 0,
            UNIQUE(dataset_id, source_name),
            FOREIGN KEY(dataset_id) REFERENCES yolo_datasets(id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_yolo_datasets_status ON yolo_datasets(status, updated_at);
          CREATE INDEX IF NOT EXISTS idx_yolo_dataset_splits_dataset ON yolo_dataset_splits(dataset_id);
          CREATE INDEX IF NOT EXISTS idx_yolo_dataset_sources_dataset ON yolo_dataset_sources(dataset_id);
        `);
      }
    },
    {
      id: '20260606_001_remote_sensing_sync',
      name: 'Create remote sensing sync run and asset tables',
      up: (database) => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS remote_sensing_sync_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT NOT NULL,
            triggered_by TEXT NOT NULL,
            target_date TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            region_count INTEGER NOT NULL DEFAULT 0,
            product_count INTEGER NOT NULL DEFAULT 0,
            asset_count INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0,
            message TEXT NOT NULL DEFAULT '',
            summary_json TEXT
          );

          CREATE TABLE IF NOT EXISTS remote_sensing_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER,
            product_id TEXT NOT NULL,
            product_title TEXT NOT NULL,
            source TEXT NOT NULL,
            layer_name TEXT NOT NULL,
            region_id TEXT NOT NULL,
            region_name TEXT NOT NULL,
            bbox_json TEXT NOT NULL,
            asset_date TEXT NOT NULL,
            format TEXT NOT NULL,
            file_path TEXT NOT NULL,
            bytes INTEGER NOT NULL DEFAULT 0,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            wms_url TEXT NOT NULL,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(product_id, region_id, asset_date),
            FOREIGN KEY(run_id) REFERENCES remote_sensing_sync_runs(id) ON DELETE SET NULL
          );

          CREATE INDEX IF NOT EXISTS idx_remote_sensing_runs_started_at ON remote_sensing_sync_runs(started_at);
          CREATE INDEX IF NOT EXISTS idx_remote_sensing_runs_target_status ON remote_sensing_sync_runs(target_date, status);
          CREATE INDEX IF NOT EXISTS idx_remote_sensing_assets_date ON remote_sensing_assets(asset_date, region_id, product_id);
          CREATE INDEX IF NOT EXISTS idx_remote_sensing_assets_run ON remote_sensing_assets(run_id);
        `);
      }
    },
    {
      id: '20260607_001_crowd_report_vision_review',
      name: 'Add Doubao vision review fields to crowd reports',
      up: (database) => {
        ensureColumn(database, 'crowd_reports', 'ai_analysis_run_id', 'INTEGER');
        ensureColumn(database, 'crowd_reports', 'ai_provider', 'TEXT');
        ensureColumn(database, 'crowd_reports', 'ai_model_name', 'TEXT');
        ensureColumn(database, 'crowd_reports', 'ai_risk_level', 'TEXT');
        ensureColumn(database, 'crowd_reports', 'ai_risk_label', 'TEXT');
        ensureColumn(database, 'crowd_reports', 'ai_summary', 'TEXT');
        ensureColumn(database, 'crowd_reports', 'ai_recommended_action', 'TEXT');
        ensureColumn(database, 'crowd_reports', 'ai_review_required', 'INTEGER NOT NULL DEFAULT 0');
        database.exec(`
          CREATE INDEX IF NOT EXISTS idx_crowd_reports_ai_analysis_run ON crowd_reports(ai_analysis_run_id);
        `);
      }
    }
  ]);

  ensureRuntimeSchemaInvariants(db);

}

function ensureRuntimeSchemaInvariants(db: Database.Database) {
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

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_name TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      summary TEXT NOT NULL,
      metadata_json TEXT,
      request_id TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS domain_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      request_id TEXT,
      created_at TEXT NOT NULL,
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS yolo_datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      task_type TEXT NOT NULL,
      class_names_json TEXT NOT NULL,
      dataset_path TEXT NOT NULL,
      data_yaml_path TEXT NOT NULL,
      source_root TEXT,
      manifest_path TEXT,
      status TEXT NOT NULL,
      image_count INTEGER NOT NULL DEFAULT 0,
      label_count INTEGER NOT NULL DEFAULT 0,
      box_count INTEGER NOT NULL DEFAULT 0,
      problem_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS yolo_dataset_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL,
      split TEXT NOT NULL,
      image_count INTEGER NOT NULL DEFAULT 0,
      label_count INTEGER NOT NULL DEFAULT 0,
      box_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(dataset_id, split),
      FOREIGN KEY(dataset_id) REFERENCES yolo_datasets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS yolo_dataset_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      image_count INTEGER NOT NULL DEFAULT 0,
      label_count INTEGER NOT NULL DEFAULT 0,
      box_count INTEGER NOT NULL DEFAULT 0,
      problem_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(dataset_id, source_name),
      FOREIGN KEY(dataset_id) REFERENCES yolo_datasets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS remote_sensing_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      target_date TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      region_count INTEGER NOT NULL DEFAULT 0,
      product_count INTEGER NOT NULL DEFAULT 0,
      asset_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      summary_json TEXT
    );

    CREATE TABLE IF NOT EXISTS remote_sensing_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      product_id TEXT NOT NULL,
      product_title TEXT NOT NULL,
      source TEXT NOT NULL,
      layer_name TEXT NOT NULL,
      region_id TEXT NOT NULL,
      region_name TEXT NOT NULL,
      bbox_json TEXT NOT NULL,
      asset_date TEXT NOT NULL,
      format TEXT NOT NULL,
      file_path TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      wms_url TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(product_id, region_id, asset_date),
      FOREIGN KEY(run_id) REFERENCES remote_sensing_sync_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_status_created_at ON alerts(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_crowd_reports_status_created_at ON crowd_reports(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_observations_sensor_observed_at ON observations(sensor_id, observed_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_runs_created_at ON analysis_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_domain_events_status_created_at ON domain_events(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON domain_events(aggregate_type, aggregate_id);
    CREATE INDEX IF NOT EXISTS idx_yolo_datasets_status ON yolo_datasets(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_yolo_dataset_splits_dataset ON yolo_dataset_splits(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_yolo_dataset_sources_dataset ON yolo_dataset_sources(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_remote_sensing_runs_started_at ON remote_sensing_sync_runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_remote_sensing_runs_target_status ON remote_sensing_sync_runs(target_date, status);
    CREATE INDEX IF NOT EXISTS idx_remote_sensing_assets_date ON remote_sensing_assets(asset_date, region_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_remote_sensing_assets_run ON remote_sensing_assets(run_id);
    CREATE INDEX IF NOT EXISTS idx_crowd_reports_ai_analysis_run ON crowd_reports(ai_analysis_run_id);
  `);

  ensureColumn(db, 'crowd_reports', 'ai_analysis_run_id', 'INTEGER');
  ensureColumn(db, 'crowd_reports', 'ai_provider', 'TEXT');
  ensureColumn(db, 'crowd_reports', 'ai_model_name', 'TEXT');
  ensureColumn(db, 'crowd_reports', 'ai_risk_level', 'TEXT');
  ensureColumn(db, 'crowd_reports', 'ai_risk_label', 'TEXT');
  ensureColumn(db, 'crowd_reports', 'ai_summary', 'TEXT');
  ensureColumn(db, 'crowd_reports', 'ai_recommended_action', 'TEXT');
  ensureColumn(db, 'crowd_reports', 'ai_review_required', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'audit_logs', 'request_id', 'TEXT');
  ensureColumn(db, 'domain_events', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'domain_events', 'request_id', 'TEXT');
  ensureColumn(db, 'domain_events', 'published_at', 'TEXT');
}

function ensureColumn(db: Database.Database, tableName: string, columnName: string, columnDefinition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

function ensureUsers(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number };

  if (appConfig.appMode === 'demo') {
    if (count.total === 0) {
      seedDemoUsers(db);
    }
    return;
  }

  if (count.total === 0) {
    seedInitialProductionAdmin(db);
  }

  assertNoDefaultDemoCredentials(db);
}

function seedDemoUsers(db: Database.Database) {
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

function seedInitialProductionAdmin(db: Database.Database) {
  const username = appConfig.initialAdminUsername;
  const password = appConfig.initialAdminPassword;
  const displayName = appConfig.initialAdminDisplayName || username;

  if (!username || !password) {
    throw new Error('生产模式空用户库必须配置 INITIAL_ADMIN_USERNAME 和 INITIAL_ADMIN_PASSWORD。');
  }

  if (password.length < 12 || isUnsafeInitialPassword(password)) {
    throw new Error('生产初始管理员密码不能少于 12 位，且不能使用演示密码或模板占位值。');
  }

  const passwordRecord = createPasswordRecord(password);
  db.prepare(`
    INSERT INTO users (username, display_name, role, password_salt, password_hash)
    VALUES (@username, @displayName, 'admin', @salt, @hash)
  `).run({
    username,
    displayName,
    salt: passwordRecord.salt,
    hash: passwordRecord.hash
  });
}

function assertNoDefaultDemoCredentials(db: Database.Database) {
  const findUser = db.prepare('SELECT username, password_salt, password_hash FROM users WHERE username = ?');

  for (const demoUser of demoUsers) {
    const user = findUser.get(demoUser.username) as
      | { username: string; password_salt: string; password_hash: string }
      | undefined;

    if (user && verifyPassword(demoUser.password, user.password_salt, user.password_hash)) {
      throw new Error(`生产模式检测到默认演示账号 ${demoUser.username}，请先修改或删除该账号。`);
    }
  }
}

function isUnsafeInitialPassword(password: string) {
  return [
    'admin123',
    'operator123',
    'expert123',
    'replace-with-a-strong-admin-password'
  ].includes(password);
}
