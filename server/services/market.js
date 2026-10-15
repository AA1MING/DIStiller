/**
 * 模板市场：管理员上架模板（手动上传 / 从已审核作品导入）并设置积分价格；
 * 用户可预览，用积分兑换，兑换后模板直接写入该用户自己的模板库。
 * 市场数据存全局 data/market.db；兑换支出记录在 works.db（与积分激励同库，统一结算余额）。
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { dataDir, db } from '../dao/db.js'
import { getWorkWithAttachment, pointsBalance, addPurchase, userPurchases } from './works.js'
import { parseTemplate } from '../utils/template.js'
import { textToBasicHtml } from '../utils/html.js'

const marketDb = new DatabaseSync(path.join(dataDir, 'market.db'))
marketDb.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS market_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  filename TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  html_template TEXT,
  raw TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_work_id INTEGER,
  source_username TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_market_source ON market_templates(source_work_id);
`)

const PUBLIC_FIELDS = 'id, name, description, price, filename, length(content) AS chars, source_type, source_work_id, source_username, created_by, created_at'

function rowToTpl(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    price: Number(row.price || 0),
    filename: row.filename,
    chars: Number(row.chars || 0),
    source_type: row.source_type,
    source_work_id: row.source_work_id != null ? Number(row.source_work_id) : null,
    source_username: row.source_username || '',
    created_by: row.created_by || '',
    created_at: row.created_at,
  }
}

/** 市场模板列表（带当前用户是否已兑换）。 */
export function listMarketTemplates(userId = null) {
  const rows = marketDb.prepare(`SELECT ${PUBLIC_FIELDS} FROM market_templates ORDER BY id DESC`).all().map(rowToTpl)
  if (userId != null) {
    const owned = new Set(userPurchases(userId).map((p) => Number(p.template_id)))
    for (const t of rows) t.purchased = owned.has(t.id)
  }
  return rows
}

/** 市场模板完整记录（含内容/原始文件，供预览与兑换写入用户库）。 */
export function getMarketTemplate(id) {
  const row = marketDb.prepare('SELECT * FROM market_templates WHERE id = ?').get(Number(id))
  if (!row) return null
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    price: Number(row.price || 0),
    filename: row.filename,
    content: row.content || '',
    html_template: row.html_template || null,
    raw: row.raw || null,
    source_type: row.source_type,
    source_work_id: row.source_work_id != null ? Number(row.source_work_id) : null,
    source_username: row.source_username || '',
    created_by: row.created_by || '',
    created_at: row.created_at,
  }
}

export function deleteMarketTemplate(id) {
  marketDb.prepare('DELETE FROM market_templates WHERE id = ?').run(Number(id))
  return { ok: true }
}

function createMarketTemplate({ name, description, price, filename, content, htmlTemplate, raw, sourceType = 'manual', sourceWorkId = null, sourceUsername = '', createdBy = '' }) {
  const nm = String(name || '').trim()
  if (!nm) throw Object.assign(new Error('请填写模板名称'), { status: 400 })
  const p = Math.max(0, Math.min(1000000, Math.round(Number(price) || 0)))
  const info = marketDb.prepare(`
    INSERT INTO market_templates (name, description, price, filename, content, html_template, raw, source_type, source_work_id, source_username, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nm,
    String(description || '').slice(0, 2000),
    p,
    String(filename || ''),
    String(content || ''),
    htmlTemplate || null,
    raw || null,
    String(sourceType),
    sourceWorkId != null ? Number(sourceWorkId) : null,
    String(sourceUsername || ''),
    String(createdBy || '')
  )
  return getMarketTemplate(Number(info.lastInsertRowid))
}

/** 管理员：上传文件添加市场模板（解析文本结构 + 基础 HTML 版式，不依赖 AI）。 */
export function addMarketTemplateFromFile({ name, description, price, filename, content, createdBy } = {}) {
  if (!content) throw Object.assign(new Error('请选择模板文件'), { status: 400 })
  const nm = String(name || '').trim() || String(filename || '模板').split('/').pop()
  const parsed = parseTemplate({ filename, content })
  return createMarketTemplate({
    name: nm,
    description,
    price,
    filename,
    content: parsed,
    htmlTemplate: textToBasicHtml(parsed, nm),
    raw: content,
    sourceType: 'manual',
    createdBy,
  })
}

/** 管理员：把已审核通过的作品附件导入为市场模板。 */
export function importWorkAsMarketTemplate(workId, { name, description, price } = {}, createdBy = '') {
  const work = getWorkWithAttachment(workId)
  if (!work) throw Object.assign(new Error('作品不存在'), { status: 404 })
  if (work.status !== 'approved') throw Object.assign(new Error('仅已通过审核的作品可导入为模板'), { status: 400 })
  if (!work.attachment_data) throw Object.assign(new Error('该作品没有附件，无法导入为模板'), { status: 400 })
  const filename = work.attachment_name || `模板-${work.title}.txt`
  const parsed = parseTemplate({ filename, content: work.attachment_data })
  const nm = String(name || '').trim() || work.title
  return createMarketTemplate({
    name: nm,
    description: String(description || '').trim() || work.description || '',
    price,
    filename,
    content: parsed,
    htmlTemplate: textToBasicHtml(parsed, nm),
    raw: work.attachment_data,
    sourceType: 'work',
    sourceWorkId: work.id,
    sourceUsername: work.username,
    createdBy,
  })
}

/** 预览市场模板（版式 html + 解析文本，不返回原始文件）。 */
export function previewMarketTemplate(id) {
  const tpl = getMarketTemplate(id)
  if (!tpl) throw Object.assign(new Error('模板不存在或已下架'), { status: 404 })
  return { id: tpl.id, name: tpl.name, description: tpl.description, price: tpl.price, filename: tpl.filename, content: tpl.content, html_template: tpl.html_template }
}

/** 用户兑换：校验余额 → 写入用户自己的模板库 → 记录支出。 */
export function purchaseMarketTemplate(userId, templateId) {
  const tpl = getMarketTemplate(templateId)
  if (!tpl) throw Object.assign(new Error('模板不存在或已下架'), { status: 404 })
  if (userPurchases(userId).some((p) => Number(p.template_id) === tpl.id)) {
    throw Object.assign(new Error('您已兑换过该模板'), { status: 400 })
  }
  const balance = pointsBalance(userId)
  if (balance < tpl.price) {
    throw Object.assign(new Error(`积分不足：需要 ${tpl.price} 积分，当前 ${balance} 积分`), { status: 400 })
  }
  const info = db.prepare('INSERT INTO templates (name, filename, content, html_template, raw) VALUES (?, ?, ?, ?, ?)')
    .run(tpl.name, tpl.filename, tpl.content, tpl.html_template, tpl.raw)
  addPurchase(userId, tpl.id, tpl.price)
  return {
    ok: true,
    template_id: tpl.id,
    user_template_id: Number(info.lastInsertRowid),
    name: tpl.name,
    price: tpl.price,
    balance: pointsBalance(userId),
  }
}

/** 管理员：市场统计（上架模板数等）。 */
export function marketStats() {
  const total = marketDb.prepare('SELECT COUNT(*) AS c FROM market_templates').get()
  const works = marketDb.prepare(`SELECT COUNT(*) AS c FROM market_templates WHERE source_type = 'work'`).get()
  const manual = marketDb.prepare(`SELECT COUNT(*) AS c FROM market_templates WHERE source_type = 'manual'`).get()
  return {
    templates: Number(total?.c || 0),
    from_works: Number(works?.c || 0),
    manual: Number(manual?.c || 0),
  }
}
