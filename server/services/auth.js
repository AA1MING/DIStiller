// 注册 / 登录 / 会话：账号与密码哈希存于 data/auth.db（与业务数据分离），
// 业务数据按用户存放在各自独立的 SQLite 文件中（见 db.js）。
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { dataDir } from '../dao/db.js'

const authDb = new DatabaseSync(path.join(dataDir, 'auth.db'))
authDb.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)

try { authDb.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'") } catch { /* 已存在 */ }
try { authDb.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''") } catch { /* 已存在 */ }
try { authDb.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''") } catch { /* 已存在 */ }
try { authDb.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''") } catch { /* 已存在 */ }
try { authDb.exec("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''") } catch { /* 已存在 */ }

// 内置管理员：admin / 123456（每次启动保证账号存在、密码与角色正确）
const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = '123456'
{
  const salt = randomBytes(16).toString('hex')
  const hash = hashPassword(ADMIN_PASSWORD, salt)
  const row = authDb.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME)
  if (!row) {
    authDb.prepare('INSERT INTO users (username, pass_hash, pass_salt, role) VALUES (?, ?, ?, ?)').run(ADMIN_USERNAME, hash, salt, 'admin')
  } else {
    authDb.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, role = ? WHERE id = ?').run(hash, salt, 'admin', row.id)
  }
}

function hashPassword(password, salt) {
  return scryptSync(String(password || ''), salt, 64).toString('hex')
}

function userRow(r) {
  return { id: Number(r.id), username: r.username, role: r.role || 'user', nickname: r.nickname || '', avatar: r.avatar || '', bio: r.bio || '', email: r.email || '', created_at: r.created_at }
}

function validate(username, password) {
  const name = String(username || '').trim()
  if (!/^[\w\u4e00-\u9fa5-]{2,32}$/.test(name)) {
    throw Object.assign(new Error('用户名需为 2-32 位字母 / 数字 / 下划线 / 中文'), { status: 400 })
  }
  if (String(password || '').length < 6) {
    throw Object.assign(new Error('密码至少 6 位'), { status: 400 })
  }
  return name
}

export function registerUser(username, password) {
  const name = validate(username, password)
  const exists = authDb.prepare('SELECT id FROM users WHERE username = ?').get(name)
  if (exists) throw Object.assign(new Error('用户名已存在，请直接登录'), { status: 409 })
  const salt = randomBytes(16).toString('hex')
  const info = authDb.prepare('INSERT INTO users (username, pass_hash, pass_salt) VALUES (?, ?, ?)').run(name, hashPassword(password, salt), salt)
  return { id: Number(info.lastInsertRowid), username: name, role: 'user', nickname: '', avatar: '', bio: '', email: '', created_at: null }
}

export function loginUser(username, password) {
  const name = String(username || '').trim()
  const row = authDb.prepare('SELECT * FROM users WHERE username = ?').get(name)
  if (!row) throw Object.assign(new Error('用户名或密码错误'), { status: 401 })
  const a = Buffer.from(hashPassword(password, row.pass_salt), 'hex')
  const b = Buffer.from(row.pass_hash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error('用户名或密码错误'), { status: 401 })
  return userRow(row)
}

export function createAuthSession(userId) {
  const token = randomBytes(32).toString('hex')
  authDb.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, Number(userId))
  return token
}

/** 按用户名查用户（同步账号绑定用，返回公开字段）。 */
export function getUserByUsername(username) {
  const row = authDb.prepare('SELECT id, username, role, nickname, avatar, bio, email FROM users WHERE username = ?').get(String(username || '').trim())
  return row ? userRow(row) : null
}
export function getUserByToken(token) {
  if (!token) return null
  const row = authDb.prepare('SELECT u.id, u.username, u.role, u.nickname, u.avatar, u.bio, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token)
  return row ? userRow(row) : null
}

/** 管理员：全部用户列表（含角色与注册时间）。 */
export function listAllUsers() {
  return authDb.prepare('SELECT id, username, role, nickname, avatar, bio, email, created_at FROM users ORDER BY id ASC').all().map(userRow)
}

/** 管理员：删除普通用户账号（管理员账号禁止删除）。 */
export function deleteUser(userId) {
  const id = Number(userId)
  const row = authDb.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id)
  if (!row) throw Object.assign(new Error('用户不存在'), { status: 404 })
  if (row.role === 'admin') throw Object.assign(new Error('管理员账号不允许删除'), { status: 400 })
  authDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  const info = authDb.prepare('DELETE FROM users WHERE id = ?').run(id)
  if (!info.changes) throw Object.assign(new Error('用户不存在'), { status: 404 })
  return { ok: true, username: row.username }
}

/** 个人中心：读取完整资料。 */
export function getProfile(userId) {
  const row = authDb.prepare('SELECT id, username, role, nickname, avatar, bio, email, created_at FROM users WHERE id = ?').get(Number(userId))
  if (!row) throw Object.assign(new Error('用户不存在'), { status: 404 })
  return userRow(row)
}

/** 个人中心：更新资料（昵称 / 头像 / 邮箱 / 简介）。 */
export function updateProfile(userId, fields = {}) {
  const cur = getProfile(userId)
  authDb.prepare('UPDATE users SET nickname = ?, avatar = ?, bio = ?, email = ? WHERE id = ?').run(
    String(fields.nickname ?? cur.nickname ?? '').trim().slice(0, 32),
    String(fields.avatar ?? cur.avatar ?? '').trim().slice(0, 8),
    String(fields.bio ?? cur.bio ?? '').trim().slice(0, 500),
    String(fields.email ?? cur.email ?? '').trim().slice(0, 120),
    Number(userId)
  )
  return getProfile(userId)
}

/** 个人中心：修改密码（校验原密码；成功后由调用方注销其它会话）。 */
export function changePassword(userId, oldPassword, newPassword) {
  const row = authDb.prepare('SELECT pass_hash, pass_salt FROM users WHERE id = ?').get(Number(userId))
  if (!row) throw Object.assign(new Error('用户不存在'), { status: 404 })
  const a = Buffer.from(hashPassword(String(oldPassword || ''), row.pass_salt), 'hex')
  const b = Buffer.from(row.pass_hash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error('原密码不正确'), { status: 400 })
  const next = String(newPassword || '')
  if (next.length < 6) throw Object.assign(new Error('新密码至少 6 位'), { status: 400 })
  const salt = randomBytes(16).toString('hex')
  authDb.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').run(hashPassword(next, salt), salt, Number(userId))
  return { ok: true }
}

/** 注销指定用户除当前会话外的其它会话（改密后其它设备下线）。 */
export function deleteOtherSessions(userId, keepToken = '') {
  if (keepToken) authDb.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(Number(userId), String(keepToken))
  else authDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId))
}

export function logoutToken(token) {
  if (token) authDb.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}
