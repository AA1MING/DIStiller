import { db, parseOpportunityRow } from '../dao/db.js'

/** 把机会 generatedAssets.featureList 落库成 features 行（需求点），并写入 kura 意图。 */
export function syncFeatures(oppId, result, sessionId = null) {
  const list = result?.generatedAssets?.featureList || []
  // 先删旧的（重评/重蒸时覆盖）
  db.prepare('DELETE FROM features WHERE opportunity_id = ?').run(oppId)
  const intent = result?.generatedAssets?.intentAnalysis?.intentCategory || null
  const sourceType = result?.sourceTypes?.[0] || 'manual'
  const stmt = db.prepare('INSERT INTO features (opportunity_id, session_id, title, description, priority, status, intent_category, source_type) VALUES (?,?,?,?,?,?,?,?)')
  for (const f of list) {
    stmt.run(oppId, sessionId || null, String(f.title || '').slice(0, 200), String(f.description || '').slice(0, 1000), f.priority || 'P1', 'kept', intent, sourceType)
  }
}

export function listFeatures(oppId) {
  return db.prepare('SELECT * FROM features WHERE opportunity_id = ? ORDER BY id ASC').all(oppId)
}

export function setFeatureStatus(featureId, status) {
  if (status !== 'kept' && status !== 'dropped') throw new Error('非法状态')
  db.prepare('UPDATE features SET status = ? WHERE id = ?').run(status, Number(featureId))
  return db.prepare('SELECT * FROM features WHERE id = ?').get(Number(featureId))
}

/** 自动项目重建：按「对话项目」分组，一个对话项目 → 一个项目（不再按相似度聚类/种类分类）。
 * 无会话归属的功能点（导入素材蒸馏/手动）归入「其他来源」。 */
export function rebuildProjects() {
  const features = db
    .prepare(`SELECT f.id, f.title, f.description, f.priority, f.opportunity_id, f.session_id,
                     o.title AS opp_title, o.summary AS opp_summary, cs.title AS session_title
              FROM features f
              LEFT JOIN opportunities o ON o.id = f.opportunity_id
              LEFT JOIN chat_sessions cs ON cs.id = f.session_id
              WHERE f.status = 'kept'`)
    .all()

  // 删除旧的自动项目及其关联（auto=1），保留人工项目
  db.prepare('DELETE FROM project_features WHERE project_id IN (SELECT id FROM projects WHERE auto = 1)').run()
  db.prepare('DELETE FROM projects WHERE auto = 1').run()

  // 按会话分组
  const groups = new Map()
  for (const f of features) {
    const key = f.session_id ? String(f.session_id) : '__other__'
    if (!groups.has(key)) groups.set(key, { sessionId: f.session_id, sessionTitle: f.session_title || '其他来源', items: [] })
    groups.get(key).items.push(f)
  }

  const projStmt = db.prepare('INSERT INTO projects (title, theme, auto, source, description) VALUES (?,?,1,?,?)')
  const joinStmt = db.prepare('INSERT OR IGNORE INTO project_features (project_id, feature_id) VALUES (?,?)')
  const projects = []
  for (const g of groups.values()) {
    const title = g.sessionTitle || '未命名项目'
    const theme = [...new Set(g.items.map((i) => i.opp_title))].slice(0, 3).join('；')
    // 项目简介：取第一条机会摘要
    const desc = g.items.find((i) => i.opp_summary)?.opp_summary || null
    const info = projStmt.run(title, theme || null, 'distill', desc ? String(desc).slice(0, 500) : null)
    const pid = Number(info.lastInsertRowid)
    for (const it of g.items) joinStmt.run(pid, it.id)
    projects.push({ id: pid, title, theme, featureCount: g.items.length, features: g.items.map((i) => ({ id: i.id, title: i.title, priority: i.priority, opportunityId: i.opportunity_id })) })
  }
  return projects
}

export function listProjects() {
  const rows = db.prepare('SELECT * FROM projects ORDER BY id DESC').all()
  return rows.map((p) => ({
    ...p,
    auto: !!p.auto,
    features: db
      .prepare(`SELECT f.*, o.title AS opportunity_title FROM project_features pf
                JOIN features f ON f.id = pf.feature_id
                LEFT JOIN opportunities o ON o.id = f.opportunity_id
                WHERE pf.project_id = ? ORDER BY f.priority, f.id`)
      .all(p.id),
  }))
}

export function getProject(id) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id))
  if (!p) return null
  return {
    ...p, auto: !!p.auto,
    features: db
      .prepare(`SELECT f.*, o.title AS opportunity_title FROM project_features pf
                JOIN features f ON f.id = pf.feature_id
                LEFT JOIN opportunities o ON o.id = f.opportunity_id
                WHERE pf.project_id = ? ORDER BY f.priority, f.id`)
      .all(Number(id)),
  }
}

/** 手动新建/导入项目（auto=0），可带功能点列表。 */
export function createProject({ title, description = null, theme = null, features = [], source = 'manual' }) {
  const t = String(title || '').trim()
  if (!t) throw new Error('项目标题不能为空')
  const info = db.prepare('INSERT INTO projects (title, theme, auto, source, description) VALUES (?,?,0,?,?)').run(t, theme || null, source || 'manual', description || null)
  const pid = Number(info.lastInsertRowid)
  const featStmt = db.prepare('INSERT INTO features (opportunity_id, title, description, priority, status, source_type) VALUES (NULL,?,?,?,?,?)')
  const joinStmt = db.prepare('INSERT OR IGNORE INTO project_features (project_id, feature_id) VALUES (?,?)')
  for (const f of Array.isArray(features) ? features : []) {
    if (!f?.title) continue
    const fInfo = featStmt.run(String(f.title).slice(0, 200), String(f.description || '').slice(0, 1000), f.priority || 'P1', 'kept', source === 'repo' ? 'repo' : 'manual')
    joinStmt.run(pid, Number(fInfo.lastInsertRowid))
  }
  return getProject(pid)
}

/** 批量导入项目（JSON 数组或 {projects:[...]}）。返回创建数量与结果。 */
export function importProjects(data) {
  const list = Array.isArray(data) ? data : data?.projects
  if (!Array.isArray(list)) throw new Error('导入数据格式应为项目数组')
  const created = []
  for (const item of list) {
    if (!item?.title) continue
    created.push(createProject({ title: item.title, description: item.description, theme: item.theme, features: item.features || [], source: item.source || 'import' }))
  }
  return created
}

/** 更新项目基础信息。 */
export function updateProject(id, { title, description = null, theme = null }) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id))
  if (!p) throw new Error('项目不存在')
  db.prepare("UPDATE projects SET title = ?, description = COALESCE(NULLIF(?, ''), description), theme = COALESCE(NULLIF(?, ''), theme) WHERE id = ?")
    .run(String(title || p.title).slice(0, 100), description ?? '', theme ?? '', Number(id))
  return getProject(Number(id))
}

/** 给项目下所"保留"的功能点算一个综合视图（用于 AI 重评）。 */
export function keptFeatureDigest(projectId) {
  const rows = db
    .prepare(`SELECT f.* FROM project_features pf JOIN features f ON f.id = pf.feature_id
              WHERE pf.project_id = ? AND f.status = 'kept' ORDER BY f.priority`)
    .all(Number(projectId))
  return rows.map((f) => `- [${f.priority || 'P1'}] ${f.title}${f.description ? `：${f.description}` : ''}`).join('\n')
}
