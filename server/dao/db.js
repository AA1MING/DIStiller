import { DatabaseSync } from 'node:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 数据目录可用 DD_DATA_DIR 覆盖（部署/测试用）
export const dataDir = process.env.DD_DATA_DIR ? path.resolve(process.env.DD_DATA_DIR) : path.resolve(__dirname, '../../data')
mkdirSync(dataDir, { recursive: true })

// 每用户独立数据库上下文：请求级隔离，业务模块无需改动即可访问到「当前用户」的库
export const dbContext = new AsyncLocalStorage()

const legacyPath = () => path.join(dataDir, 'distiller.db')
const usersDir = () => path.join(dataDir, 'users')

/** 建库 + 兼容旧库迁移（对任意 DatabaseSync 实例执行）。 */
function migrate(d) {
  d.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '新的需求对话',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  thinking TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  distilled INTEGER NOT NULL DEFAULT 0,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  intent_category TEXT,
  explicit_need TEXT,
  implicit_intent TEXT,
  jobs_to_be_done TEXT,
  anti_signals TEXT,
  confidence REAL,
  analysis_model TEXT,
  analyzed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS raw_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  target_users TEXT NOT NULL DEFAULT '[]',
  user_scenarios TEXT NOT NULL DEFAULT '[]',
  pain_points TEXT NOT NULL DEFAULT '[]',
  underlying_needs TEXT NOT NULL DEFAULT '[]',
  source_types TEXT NOT NULL DEFAULT '[]',
  evidence_count INTEGER NOT NULL DEFAULT 0,
  volume INTEGER NOT NULL DEFAULT 1,
  demand_strength_score REAL NOT NULL DEFAULT 0,
  pain_intensity_score REAL NOT NULL DEFAULT 0,
  evidence_quality_score REAL NOT NULL DEFAULT 0,
  business_value_score REAL NOT NULL DEFAULT 0,
  feasibility_score REAL NOT NULL DEFAULT 0,
  differentiation_score REAL NOT NULL DEFAULT 0,
  duplicate_risk_score REAL NOT NULL DEFAULT 0,
  market_risk_score REAL NOT NULL DEFAULT 0,
  opportunity_score REAL NOT NULL DEFAULT 0,
  competitor_analysis TEXT,
  generated_assets TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  ai_model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opportunity_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opportunity_tags (
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, tag_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  raw_item_id INTEGER REFERENCES raw_items(id) ON DELETE SET NULL,
  quote TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  relevance_reason TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS validation_experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  hypothesis TEXT NOT NULL,
  experiment TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  time_box TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS changelog_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  raw_item_id INTEGER,
  opportunity_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 功能点（需求点）：从机会的 generatedAssets.featureList 里抽出来，供人取舍；或手动导入项目时直接创建（opportunity_id 可空）
CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT,
  status TEXT NOT NULL DEFAULT 'kept',
  favorite INTEGER NOT NULL DEFAULT 0,
  intent_category TEXT,
  source_type TEXT,
  source_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 项目：聚类整合后的承载层，多个功能点归人一个项目
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  theme TEXT,
  auto INTEGER NOT NULL DEFAULT 1,   -- 1=自动生成, 0=人工新建/导入
  source TEXT,
  description TEXT,
  repo_path TEXT,        -- 实体项目 zip 存储路径（仅存储，阅读时解析）
  repo_status TEXT,      -- stored=已存储未阅读 / reading=阅读中 / read=已阅读 / failed=阅读失败
  code_logic TEXT,       -- AI 整理后的代码逻辑（供 icemark 阅读与成果生成引用）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_features (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, feature_id)
);

-- 成果版本：deliverables 生成/修正的历史版本（HTML 正文），可导入回项目
CREATE TABLE IF NOT EXISTS deliverable_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  html TEXT,
  feedback TEXT,
  imported INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 成果模板：用户上传的模板文件（pdf/docx/txt/md），解析出的文本结构 + AI 提炼的 HTML 模板 + 原始文件 base64
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  html_template TEXT,
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)

  // 兼容旧库：deliverable_versions 新增 html 列
  const dvCols = d.prepare('PRAGMA table_info(deliverable_versions)').all().map((c) => c.name)
  if (!dvCols.includes('html')) d.exec('ALTER TABLE deliverable_versions ADD COLUMN html TEXT')
  // 兼容旧库：chat_messages 新增 thinking 列（思考过程随消息保存）
  const cmCols = d.prepare('PRAGMA table_info(chat_messages)').all().map((c) => c.name)
  if (!cmCols.includes('thinking')) d.exec('ALTER TABLE chat_messages ADD COLUMN thinking TEXT')
  // 兼容旧库：features 新增 session_id（需求点归属对话项目）
  const featSessionCols = d.prepare('PRAGMA table_info(features)').all().map((c) => c.name)
  if (!featSessionCols.includes('session_id')) d.exec('ALTER TABLE features ADD COLUMN session_id INTEGER REFERENCES chat_sessions(id) ON DELETE SET NULL')
  const sigCols = d.prepare('PRAGMA table_info(signals)').all().map((c) => c.name)
  const sigAdds = [
    ['intent_category', 'TEXT'],
    ['explicit_need', 'TEXT'],
    ['implicit_intent', 'TEXT'],
    ['jobs_to_be_done', 'TEXT'],
    ['anti_signals', 'TEXT'],
    ['confidence', 'REAL'],
    ['analysis_model', 'TEXT'],
    ['analyzed_at', 'TEXT'],
  ]
  for (const [col, type] of sigAdds) {
    if (!sigCols.includes(col)) d.exec(`ALTER TABLE signals ADD COLUMN ${col} ${type}`)
  }

  // 兼容旧库：projects 新增 source/description 列
  const projCols = d.prepare('PRAGMA table_info(projects)').all().map((c) => c.name)
  if (!projCols.includes('source')) d.exec('ALTER TABLE projects ADD COLUMN source TEXT')
  if (!projCols.includes('description')) d.exec('ALTER TABLE projects ADD COLUMN description TEXT')
  if (!projCols.includes('repo_path')) d.exec('ALTER TABLE projects ADD COLUMN repo_path TEXT')
  if (!projCols.includes('repo_status')) d.exec("ALTER TABLE projects ADD COLUMN repo_status TEXT DEFAULT 'stored'")
  if (!projCols.includes('code_logic')) d.exec('ALTER TABLE projects ADD COLUMN code_logic TEXT')
  // 兼容旧库：projects 新增 session_id（一个对话项目对应一个项目）
  if (!projCols.includes('session_id')) d.exec('ALTER TABLE projects ADD COLUMN session_id INTEGER REFERENCES chat_sessions(id) ON DELETE SET NULL')

  // 兼容旧库：features 新增需求点列（收藏/意图/来源）
  const featExt = d.prepare('PRAGMA table_info(features)').all().map((c) => c.name)
  if (!featExt.includes('favorite')) d.exec('ALTER TABLE features ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0')
  if (!featExt.includes('intent_category')) d.exec('ALTER TABLE features ADD COLUMN intent_category TEXT')
  if (!featExt.includes('source_type')) d.exec('ALTER TABLE features ADD COLUMN source_type TEXT')
  if (!featExt.includes('source_name')) d.exec('ALTER TABLE features ADD COLUMN source_name TEXT')

  // 兼容旧库：templates 新增 raw 列（原始文件 base64，用于下载还原）
  const tplCols = d.prepare('PRAGMA table_info(templates)').all().map((c) => c.name)
  if (!tplCols.includes('raw')) d.exec('ALTER TABLE templates ADD COLUMN raw TEXT')
  if (!tplCols.includes('html_template')) d.exec('ALTER TABLE templates ADD COLUMN html_template TEXT')

  // 兼容旧库：features.opportunity_id 从 NOT NULL 放宽为可空（SQLite 需重建表）
  const featCols = d.prepare('PRAGMA table_info(features)').all()
  const featNotNull = featCols.find((c) => c.name === 'opportunity_id')?.notnull === 1
  if (featNotNull) {
    d.exec('PRAGMA foreign_keys = OFF')
    d.exec(`CREATE TABLE features_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES chat_sessions(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      status TEXT NOT NULL DEFAULT 'kept',
      favorite INTEGER NOT NULL DEFAULT 0,
      intent_category TEXT,
      source_type TEXT,
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    d.exec('INSERT INTO features_new (id, opportunity_id, session_id, title, description, priority, status, created_at) SELECT id, opportunity_id, session_id, title, description, priority, status, created_at FROM features')
    d.exec(`CREATE TABLE project_features_new (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, feature_id)
    )`)
    d.exec('INSERT INTO project_features_new (project_id, feature_id) SELECT project_id, feature_id FROM project_features')
    d.exec('DROP TABLE project_features')
    d.exec('DROP TABLE features')
    d.exec('ALTER TABLE project_features_new RENAME TO project_features')
    d.exec('ALTER TABLE features_new RENAME TO features')
    d.exec('PRAGMA foreign_keys = ON')
  }
}

// 默认句柄：无用户上下文时使用（健康检查等）
export const legacyDb = new DatabaseSync(legacyPath())
migrate(legacyDb)

// 用户库连接池：按需打开，进程生命周期内复用
const userDbs = new Map()

/** 打开（或首次创建）指定用户的独立数据库。 */
export function getUserDb(userId) {
  const id = Number(userId)
  if (userDbs.has(id)) return userDbs.get(id)
  mkdirSync(usersDir(), { recursive: true })
  const d = new DatabaseSync(path.join(usersDir(), id + '.db'))
  migrate(d)
  userDbs.set(id, d)
  return d
}

/** 删除指定用户的独立数据库文件：关闭进程内连接句柄并移除 db / wal / shm 文件。 */
export function deleteUserDb(userId) {
  const id = Number(userId)
  const dir = usersDir()
  const base = path.join(dir, String(id))
  const resolved = path.resolve(base)
  const dirResolved = path.resolve(dir)
  if (!(resolved.startsWith(dirResolved + path.sep) || resolved === dirResolved)) return false
  const handle = userDbs.get(id)
  if (handle) {
    try { handle.close() } catch {}
    userDbs.delete(id)
  }
  // Windows 上 close() 释放句柄略有延迟，rmSync 会在 EBUSY/EPERM 时自动重试，
  // 避免把 db / wal / shm 残留下来。
  for (const suffix of ['.db', '.db-wal', '.db-shm']) {
    const p = resolved + suffix
    try { if (existsSync(p)) rmSync(p, { force: true, maxRetries: 10, retryDelay: 30 }) } catch (e) { console.error('[deleteUserDb] rm failed ' + p + ': ' + e.message) }
  }
  return true
}

/** 首个注册用户接管旧版单用户数据（distiller.db → users/<id>.db），仅一次。 */
export function claimLegacyDataForFirstUser(userId) {
  const id = Number(userId)
  const target = path.join(usersDir(), id + '.db')
  if (existsSync(target)) return false
  if (!existsSync(legacyPath())) return false
  try {
    legacyDb.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    mkdirSync(usersDir(), { recursive: true })
    copyFileSync(legacyPath(), target)
    return true
  } catch {
    return false
  }
}

// 业务模块统一使用的 db：按请求上下文解析到当前用户库，无上下文时回退 legacyDb。
// 各模块无需任何改动，天然获得「每人数据单独存放」的隔离能力。
export const db = new Proxy({}, {
  get(_target, prop) {
    const handle = dbContext.getStore()?.db || legacyDb
    const v = handle[prop]
    return typeof v === 'function' ? v.bind(handle) : v
  },
})

function parseJson(text, fallback = null) {
  if (text == null) return fallback
  try { return JSON.parse(text) } catch { return fallback }
}

const JSON_FIELDS = {
  target_users: 'targetUsers',
  user_scenarios: 'userScenarios',
  pain_points: 'painPoints',
  underlying_needs: 'underlyingNeeds',
  source_types: 'sourceTypes',
}

export function parseOpportunityRow(row) {
  if (!row) return null
  const out = { ...row }
  for (const [col, key] of Object.entries(JSON_FIELDS)) {
    out[key] = parseJson(row[col], [])
    delete out[col]
  }
  out.problemStatement = row.problem_statement
  out.demandStrength = row.demand_strength_score
  out.painIntensity = row.pain_intensity_score
  out.evidenceQuality = row.evidence_quality_score
  out.businessValue = row.business_value_score
  out.feasibility = row.feasibility_score
  out.differentiation = row.differentiation_score
  out.duplicateRisk = row.duplicate_risk_score
  out.marketRisk = row.market_risk_score
  out.competitorAnalysis = parseJson(row.competitor_analysis, null)
  out.generatedAssets = parseJson(row.generated_assets, null)
  delete out.problem_statement
  delete out.competitor_analysis
  delete out.generated_assets
  delete out.demand_strength_score
  delete out.pain_intensity_score
  delete out.evidence_quality_score
  delete out.business_value_score
  delete out.feasibility_score
  delete out.differentiation_score
  delete out.duplicate_risk_score
  delete out.market_risk_score
  return out
}

export function listOpportunities(tagId) {
  if (tagId) {
    const rows = db
      .prepare(`SELECT o.* FROM opportunities o JOIN opportunity_tags ot ON ot.opportunity_id = o.id WHERE ot.tag_id = ? ORDER BY o.opportunity_score DESC, o.created_at DESC`)
      .all(Number(tagId))
    return rows.map(parseOpportunityRow)
  }
  const rows = db.prepare('SELECT * FROM opportunities ORDER BY opportunity_score DESC, created_at DESC').all()
  return rows.map(parseOpportunityRow)
}

export function getOpportunity(oppId) {
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId)
  if (!row) return null
  const opportunity = parseOpportunityRow(row)
  const evidence = db
    .prepare(`SELECT e.*, r.source_name, r.source_url AS raw_source_url FROM evidence e LEFT JOIN raw_items r ON r.id = e.raw_item_id WHERE e.opportunity_id = ? ORDER BY e.created_at`)
    .all(oppId)
  const experiments = db.prepare('SELECT * FROM validation_experiments WHERE opportunity_id = ? ORDER BY created_at').all(oppId)
  const activity = db.prepare('SELECT * FROM opportunity_activity WHERE opportunity_id = ? ORDER BY id DESC').all(oppId)
  const tags = db
    .prepare(`SELECT t.* FROM tags t JOIN opportunity_tags ot ON ot.tag_id = t.id WHERE ot.opportunity_id = ? ORDER BY t.name`)
    .all(oppId)
  return { opportunity, evidence, experiments, activity, tags }
}

export function logActivity(oppId, type, detail = null) {
  db.prepare('INSERT INTO opportunity_activity (opportunity_id, type, detail) VALUES (?, ?, ?)').run(oppId, type, detail)
}

export function insertChangelog(oppId, title, body) {
  const info = db.prepare('INSERT INTO changelog_entries (opportunity_id, title, body, status) VALUES (?, ?, ?, ?)').run(oppId, title, body, 'draft')
  return Number(info.lastInsertRowid)
}
