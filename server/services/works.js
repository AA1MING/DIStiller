/**
 * 积分激励：用户提交作品 → 管理员审核 → 通过发放积分。
 * 作品数据存在全局 data/works.db（跨用户，管理员需要看到所有人提交）。
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { dataDir } from '../dao/db.js'

const worksDb = new DatabaseSync(path.join(dataDir, 'works.db'))
worksDb.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_data TEXT,
  attachment_size INTEGER NOT NULL DEFAULT 0,
  award_info TEXT NOT NULL DEFAULT '',
  evidence_name TEXT,
  evidence_type TEXT,
  evidence_data TEXT,
  evidence_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  points_awarded INTEGER NOT NULL DEFAULT 0,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id);
CREATE INDEX IF NOT EXISTS idx_works_status ON works(status);
CREATE TABLE IF NOT EXISTS market_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON market_purchases(user_id);
CREATE TABLE IF NOT EXISTS point_recharges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'alipay',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_recharges_user ON point_recharges(user_id);
`)

const workCols = worksDb.prepare('PRAGMA table_info(works)').all().map((c) => c.name)
for (const [col, def] of [
  ['award_info', "TEXT NOT NULL DEFAULT ''"],
  ['evidence_name', 'TEXT'],
  ['evidence_type', 'TEXT'],
  ['evidence_data', 'TEXT'],
  ['evidence_size', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!workCols.includes(col)) worksDb.exec(`ALTER TABLE works ADD COLUMN ${col} ${def}`)
}

const PUBLIC_FIELDS = 'id, user_id, username, title, description, attachment_name, attachment_type, attachment_size, award_info, evidence_name, evidence_type, evidence_size, status, points_awarded, admin_note, created_at, reviewed_at'

function rowToWork(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    username: row.username,
    title: row.title,
    description: row.description,
    attachment_name: row.attachment_name,
    attachment_type: row.attachment_type,
    attachment_size: Number(row.attachment_size || 0),
    award_info: row.award_info || '',
    evidence_name: row.evidence_name,
    evidence_type: row.evidence_type,
    evidence_size: Number(row.evidence_size || 0),
    status: row.status,
    points_awarded: Number(row.points_awarded || 0),
    admin_note: row.admin_note,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
  }
}

/** 用户提交获奖作品（需获奖信息与获奖证据，附件 base64，上限 5MB）。 */
export function createWork(userId, username, payload = {}) {
  const title = String(payload.title || '').trim()
  const description = String(payload.description || '').trim()
  const awardInfo = String(payload.awardInfo || '').trim()
  if (!title) throw Object.assign(new Error('请填写作品名称'), { status: 400 })
  if (!description) throw Object.assign(new Error('请填写作品说明'), { status: 400 })
  if (!awardInfo) throw Object.assign(new Error('请填写获奖信息（如奖项名称与等级）'), { status: 400 })
  const att = payload.attachment
  let attachmentName = null
  let attachmentType = null
  let attachmentData = null
  let attachmentSize = 0
  if (att && (att.name || att.data)) {
    attachmentName = String(att.name || '').slice(0, 200)
    attachmentType = String(att.type || 'application/octet-stream').slice(0, 100)
    attachmentData = String(att.data || '')
    attachmentSize = Math.round(attachmentData.length * 3 / 4)
    if (attachmentSize > 5 * 1024 * 1024) {
      throw Object.assign(new Error('附件不能超过 5MB'), { status: 400 })
    }
  }
  const ev = payload.evidence
  let evidenceName = null
  let evidenceType = null
  let evidenceData = null
  let evidenceSize = 0
  if (!ev || !(ev.name || ev.data)) {
    throw Object.assign(new Error('请上传获奖证据（如获奖证书图片或截图）'), { status: 400 })
  }
  evidenceName = String(ev.name || '').slice(0, 200)
  evidenceType = String(ev.type || 'application/octet-stream').slice(0, 100)
  evidenceData = String(ev.data || '')
  evidenceSize = Math.round(evidenceData.length * 3 / 4)
  if (evidenceSize > 5 * 1024 * 1024) {
    throw Object.assign(new Error('获奖证据不能超过 5MB'), { status: 400 })
  }
  const info = worksDb.prepare(`
    INSERT INTO works (user_id, username, title, description, attachment_name, attachment_type, attachment_data, attachment_size, award_info, evidence_name, evidence_type, evidence_data, evidence_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, String(username || ''), title, description, attachmentName, attachmentType, attachmentData, attachmentSize, awardInfo, evidenceName, evidenceType, evidenceData, evidenceSize)
  return getWork(Number(info.lastInsertRowid))
}

export function getWork(id) {
  return rowToWork(worksDb.prepare(`SELECT ${PUBLIC_FIELDS} FROM works WHERE id = ?`).get(Number(id)))
}

export function getWorkWithAttachment(id) {
  const row = worksDb.prepare(`SELECT ${PUBLIC_FIELDS}, attachment_data, evidence_data FROM works WHERE id = ?`).get(Number(id))
  if (!row) return null
  const work = rowToWork(row)
  work.attachment_data = row.attachment_data || null
  work.evidence_data = row.evidence_data || null
  return work
}

/** 当前用户的提交记录。 */
export function listMyWorks(userId) {
  return worksDb.prepare(`SELECT ${PUBLIC_FIELDS} FROM works WHERE user_id = ? ORDER BY id DESC`).all(Number(userId)).map(rowToWork)
}

/** 删除自己的作品（仅待审核可删）。 */
export function deleteMyWork(userId, id) {
  const info = worksDb.prepare(`DELETE FROM works WHERE id = ? AND user_id = ? AND status = 'pending'`).run(Number(id), Number(userId))
  if (!info.changes) throw Object.assign(new Error('作品不存在或已被审核，无法删除'), { status: 404 })
  return { ok: true }
}

/** 管理员：删除任意作品（含附件与获奖证据）。 */
export function deleteWork(id) {
  const info = worksDb.prepare('DELETE FROM works WHERE id = ?').run(Number(id))
  if (!info.changes) throw Object.assign(new Error('作品不存在'), { status: 404 })
  return { ok: true }
}

/** 我的创作激励积分（仅审核通过作品发放的积分）。 */
export function pointsEarned(userId) {
  return Number(worksDb.prepare(`SELECT COALESCE(SUM(points_awarded), 0) AS total FROM works WHERE user_id = ? AND status = 'approved'`).get(Number(userId))?.total || 0)
}

/** 我的积分余额（作品积分 + 充值 − 模板市场兑换支出）。 */
export function pointsBalance(userId) {
  const earned = pointsEarned(userId)
  const recharged = worksDb.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM point_recharges WHERE user_id = ?`).get(Number(userId))
  const spent = worksDb.prepare(`SELECT COALESCE(SUM(price), 0) AS total FROM market_purchases WHERE user_id = ?`).get(Number(userId))
  return earned + Number(recharged?.total || 0) - Number(spent?.total || 0)
}

const RECHARGE_METHODS = new Set(['alipay', 'wechat'])

/** 用户充值积分（模拟支付，直接入账）。 */
export function rechargePoints(userId, amount, method = 'alipay') {
  const a = Math.round(Number(amount) || 0)
  if (!Number.isFinite(a) || a < 1 || a > 1000000) {
    throw Object.assign(new Error('充值积分需为 1-1000000 之间的整数'), { status: 400 })
  }
  if (!RECHARGE_METHODS.has(method)) {
    throw Object.assign(new Error('不支持的支付方式'), { status: 400 })
  }
  const m = method
  const info = worksDb.prepare('INSERT INTO point_recharges (user_id, amount, method) VALUES (?, ?, ?)').run(Number(userId), a, m)
  return { id: Number(info.lastInsertRowid), amount: a, method: m, balance: pointsBalance(userId) }
}

/** 我的充值记录。 */
export function listRecharges(userId) {
  return worksDb.prepare('SELECT id, amount, method, created_at FROM point_recharges WHERE user_id = ? ORDER BY id DESC').all(Number(userId)).map((r) => ({
    id: Number(r.id),
    amount: Number(r.amount),
    method: r.method,
    created_at: r.created_at,
  }))
}

/** 我兑换过的市场模板记录。 */
export function userPurchases(userId) {
  return worksDb.prepare('SELECT template_id, price, created_at FROM market_purchases WHERE user_id = ? ORDER BY id DESC').all(Number(userId)).map((r) => ({
    template_id: Number(r.template_id),
    price: Number(r.price || 0),
    created_at: r.created_at,
  }))
}

/** 兑换模板时记录支出（积分扣减随 pointsBalance 自动生效）。 */
export function addPurchase(userId, templateId, price) {
  worksDb.prepare('INSERT INTO market_purchases (user_id, template_id, price) VALUES (?, ?, ?)').run(Number(userId), Number(templateId), Math.max(0, Math.round(Number(price) || 0)))
}

/** 管理员：模板市场兑换统计。 */
export function marketPurchaseStats() {
  const total = worksDb.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(price), 0) AS revenue FROM market_purchases').get()
  const users = worksDb.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM market_purchases').get()
  return {
    purchases: Number(total?.c || 0),
    revenue: Number(total?.revenue || 0),
    buyers: Number(users?.c || 0),
  }
}

/** 管理员：全部作品，可按状态过滤。 */
export function listAllWorks({ status = '' } = {}) {
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    return worksDb.prepare(`SELECT ${PUBLIC_FIELDS} FROM works WHERE status = ? ORDER BY id DESC`).all(status).map(rowToWork)
  }
  return worksDb.prepare(`SELECT ${PUBLIC_FIELDS} FROM works ORDER BY id DESC`).all().map(rowToWork)
}

/** 管理员：审核作品。 */
export function reviewWork(id, { status, points = 0, note = '' } = {}) {
  const target = getWork(id)
  if (!target) throw Object.assign(new Error('作品不存在'), { status: 404 })
  const nextStatus = String(status || '').trim()
  if (!['approved', 'rejected'].includes(nextStatus)) {
    throw Object.assign(new Error('审核结果必须为 approved 或 rejected'), { status: 400 })
  }
  const awarded = nextStatus === 'approved' ? Math.max(0, Math.min(100000, Math.round(Number(points) || 0))) : 0
  worksDb.prepare(`
    UPDATE works SET status = ?, points_awarded = ?, admin_note = ?, reviewed_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(nextStatus, awarded, String(note || '').slice(0, 1000), Number(id))
  return getWork(id)
}

/** 管理员：概览统计。 */
export function adminStats() {
  const total = worksDb.prepare('SELECT COUNT(*) AS c FROM works').get()
  const pending = worksDb.prepare(`SELECT COUNT(*) AS c FROM works WHERE status = 'pending'`).get()
  const approved = worksDb.prepare(`SELECT COUNT(*) AS c FROM works WHERE status = 'approved'`).get()
  const rejected = worksDb.prepare(`SELECT COUNT(*) AS c FROM works WHERE status = 'rejected'`).get()
  const points = worksDb.prepare(`SELECT COALESCE(SUM(points_awarded), 0) AS t FROM works WHERE status = 'approved'`).get()
  const recharge = worksDb.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS t FROM point_recharges').get()
 const users = worksDb.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM works').get()
 return {
   total: Number(total?.c || 0),
   pending: Number(pending?.c || 0),
   approved: Number(approved?.c || 0),
   rejected: Number(rejected?.c || 0),
   points_given: Number(points?.t || 0),
    recharges: Number(recharge?.c || 0),
    points_recharged: Number(recharge?.t || 0),
   users: Number(users?.c || 0),
 }
}

/** 管理员：按用户汇总作品数与积分（含无作品的用户统计口径）。 */
export function userWorkStats() {
  return worksDb.prepare(`
    SELECT user_id,
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN points_awarded ELSE 0 END), 0) AS points
    FROM works GROUP BY user_id
  `).all().map((r) => ({
    user_id: Number(r.user_id),
    total: Number(r.total),
    pending: Number(r.pending),
    approved: Number(r.approved),
    rejected: Number(r.rejected),
    points: Number(r.points),
  }))
}

/** 创作积分榜：仅统计创作激励（审核通过作品发放的积分），按积分排序（用户端公开数据）。 */
export function pointsLeaderboard() {
  return worksDb.prepare(`
    SELECT user_id, username, COUNT(*) AS works, COALESCE(SUM(points_awarded), 0) AS points
    FROM works WHERE status = 'approved'
    GROUP BY user_id ORDER BY points DESC, works DESC, user_id ASC
  `).all().map((r) => ({
    user_id: Number(r.user_id),
    username: r.username,
    works: Number(r.works),
    points: Number(r.points),
  }))
}

/** 删除指定用户的全部作品（账号删除时级联清理）。 */
export function deleteUserWorks(userId) {
  const info = worksDb.prepare('DELETE FROM works WHERE user_id = ?').run(Number(userId))
  return Number(info.changes)
}

/** 删除指定用户的全部兑换记录（账号删除时级联清理）。 */
export function deleteUserPurchases(userId) {
  const info = worksDb.prepare('DELETE FROM market_purchases WHERE user_id = ?').run(Number(userId))
  return Number(info.changes)
}

/** 删除指定用户的全部充值记录（账号删除时级联清理）。 */
export function deleteUserRecharges(userId) {
  const info = worksDb.prepare('DELETE FROM point_recharges WHERE user_id = ?').run(Number(userId))
  return Number(info.changes)
}
