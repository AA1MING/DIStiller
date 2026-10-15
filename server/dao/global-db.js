import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { dataDir } from './db.js'

/** 全局配置库（跨用户共享）：存放管理员维护的全局配置，如积分模型价格表。 */
export const globalDb = new DatabaseSync(path.join(dataDir, 'global.db'))
globalDb.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS points_model_usage (
  model TEXT NOT NULL,
  url TEXT NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (model, url, user_id)
);
`)
