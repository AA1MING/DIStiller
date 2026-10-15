import { db } from '../dao/db.js'
import { getAiSettings, chatJson, UNIFIED_SYSTEM_PROMPT } from './ai.js'
import { parseJsonContent, fallbackExtract, computeOpportunityScore, insertOpportunity, insertEvidence, insertExperiments, getDetail } from './distill.js'
import { syncFeatures, rebuildProjects } from './projects.js'
import { hashText } from './dedup.js'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** 蒸馏台概览：每个会话的消息数/signal 数，以及全局 signal 统计。 */
export function distilleryOverview() {
  const sessions = db
    .prepare(
      `SELECT s.id, s.title, s.created_at, s.updated_at,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
              (SELECT COUNT(*) FROM signals sig WHERE sig.session_id = s.id) AS signal_count,
              (SELECT CASE WHEN EXISTS (SELECT 1 FROM projects p WHERE p.session_id = s.id) THEN 1 ELSE (SELECT MIN(distilled) FROM signals sig WHERE sig.session_id = s.id) END) AS all_distilled
       FROM chat_sessions s
       ORDER BY s.updated_at DESC`
    )
    .all()
  const sessionSignals = sessions.map((row) => ({
    ...row,
    signals: db.prepare('SELECT id, content, distilled, intent_category, confidence, analysis_model, created_at FROM signals WHERE session_id = ? ORDER BY id DESC').all(row.id),
  }))
  const total = db.prepare('SELECT COUNT(*) AS c FROM signals').get().c
  const undistilled = db.prepare('SELECT COUNT(*) AS c FROM signals WHERE distilled = 0').get().c
  const oppCount = db.prepare('SELECT COUNT(*) AS c FROM opportunities').get().c
  return { sessions: sessionSignals, stats: { totalSignals: total, undistilledSignals: undistilled, opportunityCount: oppCount } }
}

/** 把选定会话 + 历史 signal 一起交给 icemark 蒸馏。
 *  - sessionIds：参与蒸馏的对话
 *  - includeHistory：是否把其它会话的历史未蒸馏 signal 作为补充证据
 *  - signalIds：可选，指定哪些 signal 参与蒸馏（覆盖 includeHistory 时的历史集）
 * 每个对话独立蒸馏，识别意图生成功能点后自动创建一个项目（一个对话对应一个项目）。
 */
export async function distillBatch({ sessionIds = [], includeHistory = true, signalIds = null }) {
  const projects = []
  for (const sid of sessionIds) {
    const r = await distillSessionToProject({ sessionId: sid, includeHistory, signalIds })
    projects.push(r)
  }
  if (!projects.length) throw new Error('没有可用于蒸馏的对话')
  return { projects, count: projects.length }
}

/** 单会话蒸馏 → 识别意图生成功能点 → 自动创建项目（标题=对话名）。 */
export async function distillSessionToProject({ sessionId, includeHistory = true, signalIds = null }) {
  const s = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(Number(sessionId))
  if (!s) throw new Error('对话不存在')
  const messages = db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id ASC').all(s.id)
  if (!messages.length) throw new Error('该对话还没有消息，无法蒸馏')

  let historySignals = []
  if (Array.isArray(signalIds)) {
    historySignals = db.prepare('SELECT * FROM signals WHERE id IN (' + signalIds.map(() => '?').join(',') + ')').all(...signalIds.map(Number))
  } else if (includeHistory) {
    // 其它会话的未蒸馏 signal 作为补充证据（不归属本对话）
    historySignals = db.prepare('SELECT * FROM signals WHERE distilled = 0 AND session_id != ? ORDER BY id ASC LIMIT 100').all(s.id)
  }

  const sessionParts = `# 对话：${s.title}\n` + messages.map((m) => `${m.role === 'user' ? '用户' : 'AI助手'}：${m.content}`).join('\n\n')
  const signalParts = historySignals.length ? `# 其它对话中识别到的疑似需求 signal（仅作补充参考，不归入本对话）\n` + historySignals.map((x) => `- ${x.content}`).join('\n') : ''

  const text = [sessionParts, signalParts].filter(Boolean).join('\n\n---\n\n')

  const ai = getAiSettings()
  let result
  if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
    const userMsg = `[mode:icemark]\n这是单个对话项目的完整对话记录。请用 kura 思路识别其中用户的真实意图（区分显性诉求/隐性意图/JTBD），再以 icemark 提炼功能点。功能点只应来源于本对话中的真实需求，不要编造；若对话中确实没有需求则输出空 featureList。补充参考信号 ${historySignals.length} 条。\n素材：\n---\n${text}\n---`
    const content = await chatJson(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
    result = { ...parseJsonContent(content), aiModel: ai.model, aiConfigured: true }
  } else {
    result = { ...fallbackExtract(text, 'ai_chat'), aiModel: 'local-heuristic', aiConfigured: false }
  }

  const sourceTypes = ['ai_chat']
  const oppId = insertOpportunity({ ...result, sourceTypes })

  // 主素材：对话全文存为 raw_item 并挂证据
  const transcript = messages.map((m) => `${m.role === 'user' ? '用户' : 'AI助手'}：${m.content}`).join('\n\n')
  const hash = hashText(transcript)
  const existingRaw = db.prepare('SELECT id FROM raw_items WHERE hash = ?').get(hash)
  let rawId
  if (existingRaw) {
    rawId = existingRaw.id
  } else {
    const info = db.prepare('INSERT INTO raw_items (text, hash, source_type, source_name, source_url) VALUES (?,?,?,?,?)').run(transcript, hash, 'ai_chat', s.title, `chat:${s.id}`)
    rawId = Number(info.lastInsertRowid)
  }
  insertEvidence(oppId, { id: rawId, text: transcript, source_url: `chat:${s.id}` }, result.evidence, 'ai_chat')
  // 本对话的 signal 标记已蒸馏并关联机会
  db.prepare('UPDATE signals SET distilled = 1, opportunity_id = ? WHERE session_id = ? AND distilled = 0').run(oppId, s.id)
  // 补充参考 signal 也标记（引用）
  for (const sig of historySignals) {
    db.prepare('UPDATE signals SET distilled = 1, opportunity_id = ? WHERE id = ?').run(oppId, sig.id)
  }

  insertExperiments(oppId, result.validationExperiments)
  db.prepare('UPDATE opportunities SET source_types = ? WHERE id = ?').run(JSON.stringify(sourceTypes), oppId)
  db.prepare('INSERT INTO opportunity_activity (opportunity_id, type, detail) VALUES (?, ?, ?)').run(oppId, 'distill', `对话项目蒸馏：${s.title}`)
  // 功能点归属本会话
  syncFeatures(oppId, result, s.id)

  // 自动创建项目：一个对话对应一个项目，标题=对话名
  const feats = db.prepare('SELECT id FROM features WHERE opportunity_id = ?').all(oppId)
  const title = (s.title || '需求项目').trim().slice(0, 100)
  const summary = String(result?.summary || '').trim() || null
  const info = db.prepare('INSERT INTO projects (title, auto, source, description, session_id) VALUES (?,0,?,?,?)').run(title, 'demand', summary ? summary.slice(0, 6000) : null, s.id)
  const pid = Number(info.lastInsertRowid)
  const join = db.prepare('INSERT OR IGNORE INTO project_features (project_id, feature_id) VALUES (?,?)')
  let added = 0
  for (const f of feats) { const r = join.run(pid, f.id); added += Number(r.changes) }

  return { projectId: pid, opportunityId: oppId, featureCount: added, title, sessionTitle: s.title }
}
