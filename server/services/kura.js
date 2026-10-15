import { db } from '../dao/db.js'
import { getAiSettings, chatJson, UNIFIED_SYSTEM_PROMPT } from './ai.js'

/**
 * kura 意图分析：对 signal 自动做意图理解并写入数据库。
 * 配置 AI 时用 [mode:kura] 调模型；未配置时用本地关键词启发式。
 */

const INTENT_RULES = [
  { key: 'workflow_friction', label: '流程摩擦', hints: ['麻烦', '重复', '手动', '整理', '复制', '切换', '效率', '耗时', '工作流'] },
  { key: 'decision_support', label: '决策支持', hints: ['判断', '优先级', '值得做', '评分', '选择', '决策', '分析', '机会'] },
  { key: 'automation', label: '自动化诉求', hints: ['自动', '批量', '汇总', '分类', '提醒', '生成', '同步'] },
  { key: 'insight_discovery', label: '洞察发现', hints: ['发现', '趋势', '聚类', '主题', '痛点', '需求', '信号'] },
  { key: 'competitive_gap', label: '竞品缺口', hints: ['竞品', '替代', '类似', '同质化', '差异化', '市场'] },
  { key: 'validation_need', label: '验证需求', hints: ['验证', '实验', '访谈', '落地页', '假设', '测试'] },
]

function heuristicIntent(text) {
  const t = String(text || '').toLowerCase()
  const ranked = INTENT_RULES.map((r) => ({ r, s: r.hints.reduce((n, h) => n + (t.includes(h) ? 1 : 0), 0) })).sort((a, b) => b.s - a.s)
  const top = ranked[0]?.s > 0 ? ranked[0].r : INTENT_RULES[1]
  return {
    intentCategory: top.key,
    explicitNeed: text.slice(0, 200),
    implicitIntent: '降低判断成本并提高机会识别准确率',
    jobsToBeDone: [`当我面对「${text.slice(0, 24)}」时，我想快速理解真实意图，以便判断是否值得投入开发`],
    antiSignals: ranked[0]?.s === 0 ? ['关键词证据不足，疑似伪需求风险'] : [],
    confidence: ranked[0]?.s > 1 ? 0.72 : 0.45,
    model: 'kura-heuristic',
  }
}

function parseKuraJson(content) {
  let text = String(content || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

/** 分析单个 signal 的意图，写回数据库。返回分析结果或 null。 */
export async function analyzeSignal(signalId) {
  const sig = db.prepare('SELECT * FROM signals WHERE id = ?').get(signalId)
  if (!sig) return null

  const ai = getAiSettings()
  let result
  if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
    const userMsg = `[mode:kura]\n输入素材（一条）:\n${sig.content}\n请按 kura 输出 JSON（intents/clusters），intents 取第一条即可。`
    const content = await chatJson(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'kura' })
    const parsed = parseKuraJson(content)
    const first = parsed?.intents?.[0]
    result = first
      ? {
          intentCategory: first.intentCategory || 'unknown',
          explicitNeed: first.explicitNeed || sig.content,
          implicitIntent: first.implicitIntent || '',
          jobsToBeDone: Array.isArray(first.jobsToBeDone) ? first.jobsToBeDone : [],
          antiSignals: Array.isArray(first.antiSignals) ? first.antiSignals : [],
          confidence: Number(first.confidence) || 0.5,
          model: ai.model,
        }
      : null
  } else {
    result = heuristicIntent(sig.content)
  }

  if (!result) return null
  db.prepare(
    `UPDATE signals SET intent_category = ?, explicit_need = ?, implicit_intent = ?, jobs_to_be_done = ?, anti_signals = ?, confidence = ?, analysis_model = ?, analyzed_at = datetime('now') WHERE id = ?`
  ).run(
    result.intentCategory || null,
    result.explicitNeed || null,
    result.implicitIntent || null,
    result.jobsToBeDone?.length ? JSON.stringify(result.jobsToBeDone) : null,
    result.antiSignals?.length ? JSON.stringify(result.antiSignals) : null,
    result.confidence ?? null,
    result.model || null,
    signalId
  )
  return db.prepare('SELECT * FROM signals WHERE id = ?').get(signalId)
}

/** 批量把未分析过的 signal 补分析（可用于启动时/定时）。 */
export async function analyzeUnanalyzedSignals() {
  const rows = db.prepare('SELECT id FROM signals WHERE intent_category IS NULL AND analyzed_at IS NULL ORDER BY id ASC LIMIT 50').all()
  for (const r of rows) {
    try { await analyzeSignal(r.id) } catch { /* 单条失败不阻断 */ }
  }
  return rows.length
}
