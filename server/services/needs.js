import { db } from '../dao/db.js'
import { getAiSettings, chatText, UNIFIED_SYSTEM_PROMPT } from './ai.js'

/**
 * 需求点（features 的独立视图）：
 * - 需求点列表：全部功能点，按日期排序，含收藏/保留舍弃/意图/来源/所属项目
 * - 收藏与保留舍弃
 * - 从需求点整合生成项目（icemark 生成项目需求分析）
 * - 项目功能点增删
 */

/** 需求点列表（全部 features，含所属机会/项目信息，按日期倒序）。 */
export function listAllFeatures() {
  return db
    .prepare(
      `SELECT f.*,
              o.title AS opp_title,
              cs.title AS session_title,
              (SELECT p.title FROM project_features pf JOIN projects p ON p.id = pf.project_id WHERE pf.feature_id = f.id LIMIT 1) AS project_title
       FROM features f
       LEFT JOIN opportunities o ON o.id = f.opportunity_id
       LEFT JOIN chat_sessions cs ON cs.id = f.session_id
       ORDER BY date(f.created_at) DESC, f.id DESC`
    )
    .all()
    .map((r) => ({ ...r, favorite: !!r.favorite }))
}

/** 收藏/取消收藏。 */
export function setFeatureFavorite(id, favorite) {
  db.prepare('UPDATE features SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, Number(id))
  return db.prepare('SELECT * FROM features WHERE id = ?').get(Number(id))
}

/** 删除功能点（同时清理项目关联）。 */
export function deleteFeature(id) {
  db.prepare('DELETE FROM project_features WHERE feature_id = ?').run(Number(id))
  const info = db.prepare('DELETE FROM features WHERE id = ?').run(Number(id))
  if (!info.changes) throw Object.assign(new Error('功能点不存在'), { status: 404 })
  return { ok: true }
}

/** 项目功能点摘要（保留的）。 */
function projectFeatureDigest(projectId) {
  const rows = db
    .prepare(
      `SELECT f.title, f.description, f.priority, f.intent_category
       FROM project_features pf JOIN features f ON f.id = pf.feature_id
       WHERE pf.project_id = ? AND f.status = 'kept'`
    )
    .all(Number(projectId))
  return rows
}

/** icemark 生成项目需求分析（写入 description）。 */
async function generateAnalysis(project) {
  const feats = projectFeatureDigest(project.id)
  const ai = getAiSettings()
  if (!(ai.enabled && ai.apiKey && ai.baseUrl && ai.model)) {
    const digest = feats.map((f) => `- [${f.priority || 'P1'}] ${f.title}${f.description ? `：${f.description}` : ''}`).join('\n')
    return `# ${project.title} 需求分析\n\n## 功能点\n${digest || '- （暂无）'}\n\n> 本地模式：配置 AI 后可生成完整需求分析。`
  }
  const userMsg = `[mode:icemark]\n你是 icemark 产品经理 Agent。请基于以下项目的功能点，撰写一份完整的项目需求分析（Markdown）：\n- 项目名称：${project.title}\n- 项目主题：${project.theme || '未指定'}\n- 功能点：\n${feats.map((f) => `  - [${f.priority || 'P1'}] ${f.title}${f.intent_category ? `（意图：${f.intent_category}）` : ''}${f.description ? `：${f.description}` : ''}`).join('\n') || '  （暂无功能点，请先添加）'}\n\n输出结构：项目概述 / 目标用户与使用场景 / 核心功能说明 / 需求优先级 / 潜在风险与验证建议。不要编造功能点之外的内容。只输出 Markdown。`
  try {
    return await chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
  } catch { return null }
}

/** 从需求点整合生成项目：创建项目 + 关联功能点 + icemark 生成需求分析。 */
export async function generateProjectFromFeatures({ title, featureIds = [], theme = null }) {
  const t = String(title || '').trim()
  if (!t) throw new Error('项目标题不能为空')
  const info = db.prepare('INSERT INTO projects (title, theme, auto, source, description) VALUES (?,?,0,?,NULL)').run(t, theme || null, 'demand')
  const pid = Number(info.lastInsertRowid)
  const join = db.prepare('INSERT OR IGNORE INTO project_features (project_id, feature_id) VALUES (?,?)')
  let added = 0
  for (const fid of featureIds) {
    const r = join.run(pid, Number(fid))
    added += Number(r.changes)
  }
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid)
  const analysis = await generateAnalysis(project)
  if (analysis) db.prepare('UPDATE projects SET description = ? WHERE id = ?').run(analysis, pid)
  const final = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid)
  return { ...final, auto: false, featureCount: added, analysis }
}

/** 重新生成项目需求分析。 */
export async function regenerateProjectAnalysis(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(projectId))
  if (!project) throw new Error('项目不存在')
  const analysis = await generateAnalysis(project)
  if (analysis) db.prepare('UPDATE projects SET description = ? WHERE id = ?').run(analysis, project.id)
  return { ...project, analysis }
}

/** 项目添加功能点（从需求点池）。 */
export function addFeatureToProject(projectId, featureId) {
  db.prepare('INSERT OR IGNORE INTO project_features (project_id, feature_id) VALUES (?,?)').run(Number(projectId), Number(featureId))
  return { ok: true }
}

/** 项目移除功能点（关联解除，功能点仍在需求点池）。 */
export function removeFeatureFromProject(projectId, featureId) {
  db.prepare('DELETE FROM project_features WHERE project_id = ? AND feature_id = ?').run(Number(projectId), Number(featureId))
  return { ok: true }
}

/** 项目可添加的需求点候选（未加入该项目的保留功能点）。 */
export function featureCandidatesForProject(projectId) {
  return db
    .prepare(
      `SELECT f.id, f.title, f.description, f.priority, f.intent_category, f.created_at
       FROM features f
       WHERE f.status = 'kept'
         AND f.id NOT IN (SELECT feature_id FROM project_features WHERE project_id = ?)
       ORDER BY date(f.created_at) DESC, f.id DESC`
    )
    .all(Number(projectId))
}
