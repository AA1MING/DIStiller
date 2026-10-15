import { db, parseOpportunityRow, getOpportunity, logActivity, insertChangelog } from '../dao/db.js'
import { getAiSettings, chatJson, UNIFIED_SYSTEM_PROMPT } from './ai.js'
import { hashText, similarOpportunities } from './dedup.js'
import { syncFeatures, rebuildProjects } from './projects.js'

export const SOURCE_TYPES = ['ai_chat', 'manual', 'feedback', 'community', 'competitor_review']
export const ALLOWED_STATUS = new Set(['new', 'triaging', 'validating', 'planned', 'building', 'shipped', 'dismissed'])

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function computeOpportunityScore(s = {}) {
  const score =
    0.25 * num(s.demandStrength) + 0.2 * num(s.painIntensity) + 0.1 * num(s.evidenceQuality) +
    0.2 * num(s.businessValue) + 0.15 * num(s.feasibility) + 0.1 * num(s.differentiation) -
    0.15 * num(s.duplicateRisk) - 0.1 * num(s.marketRisk)
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function parseJsonContent(content) {
  let text = String(content || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('AI 未返回有效 JSON')
  return JSON.parse(text.slice(start, end + 1))
}

/** 离线启发式蒸馏（Q4：本地回退，配置 AI 后补全）。 */
export function fallbackExtract(text, sourceType) {
  const sentences = String(text || '').split(/[。！？!?\n；;]+/).map((s) => s.trim()).filter((s) => s.length > 3)
  const title = (sentences[0] || '未命名需求').slice(0, 40)
  return {
    title,
    summary: (sentences.slice(0, 2).join('；') || text.slice(0, 120)).slice(0, 200),
    problemStatement: text.slice(0, 400),
    targetUsers: ['待验证目标用户'], userScenarios: ['待补充使用场景'], painPoints: sentences.slice(0, 6),
    underlyingNeeds: ['待 AI 蒸馏底层需求'],
    evidence: sentences.slice(0, 3).map((q) => ({ quote: q, sourceType, sourceUrl: null, relevanceReason: '原文片段，直接支撑需求陈述' })),
    scores: { demandStrength: 50, painIntensity: 50, evidenceQuality: 40, businessValue: 50, feasibility: 55, differentiation: 50, duplicateRisk: 40, marketRisk: 45 },
    competitorAnalysis: { duplicateRiskSummary: '未配置 AI，未进行竞品重复度分析', differentiationAngles: ['待 AI 分析'], marketRisks: ['待 AI 分析'], commercialValueReasoning: '未配置 AI，未进行商业价值论证' },
    generatedAssets: {
      intentAnalysis: { intentCategory: text.includes('自动') ? '自动化诉求' : text.includes('值得') ? '决策支持' : '待澄清意图', explicitNeed: sentences[0] || title, implicitIntent: '降低判断成本并提高机会识别准确率', jobsToBeDone: ['当我面对大量碎片化信息时，我想快速理解真实需求，以便判断是否值得投入开发'], antiSignals: sentences.length < 2 ? ['素材较短，缺少多来源证据'] : [], confidence: sentences.length >= 2 ? 0.62 : 0.42 },
      featureList: [{ title, description: '围绕该需求构建的最小功能', priority: 'P1' }],
      userStories: [{ role: '独立开发者/产品经理', want: '自动理解碎片内容中的真实意图', benefit: '更快判断哪些需求值得验证', acceptanceCriteria: ['能看到显性诉求、隐性意图、证据链与机会评分'] }],
      mvpScope: { mustHave: ['素材导入', '意图理解', '证据链', '机会评分', title], shouldHave: ['聚类地图', '验证实验生成'], notNow: ['复杂团队协作', '客服工单系统'] },
      prdDraft: `# ${title}\n\n## 背景\n${sentences.join('；')}\n\n## 意图理解\n显性诉求是解决当前问题，隐性意图是降低判断成本。\n\n> 本地启发式蒸馏结果，配置 AI Key 后可生成完整 PRD。`,
      prototypePrompt: `设计一个以「意图理解」为中心的需求蒸馏页面：左侧导入素材，中间展示显性/隐性意图/JTBD，右侧展示证据链、评分和 MVP。`,
      riskRegister: [{ risk: '素材证据不足导致伪需求', mitigation: '要求补充来源并生成验证实验' }],
      developmentTasks: [{ title: `实现「${title}」核心流程`, description: '包含意图理解、证据链和评分展示', type: 'backend', priority: 'P0' }],
    },
    validationExperiments: [{ hypothesis: '目标用户确实存在且痛点真实', experiment: '对 5-10 位目标用户做访谈或落地页测试', successMetric: '≥60% 受访者表示强烈需要', timeBox: '2 周' }],
    volume: 1, reevaluationInDays: 14,
  }
}

async function runPrompt(text, sourceType, sourceName, existing) {
  const ai = getAiSettings()
  if (!(ai.enabled && ai.apiKey && ai.baseUrl && ai.model)) {
    return { ...fallbackExtract(text, sourceType), aiModel: 'local-heuristic', aiConfigured: false }
  }
  const ctx = existing ? `\n【已有机会(增量校准)】\n标题：${existing.title}\n摘要：${existing.summary}\n此前评分：${JSON.stringify({ demandStrength: existing.demandStrength, painIntensity: existing.painIntensity, businessValue: existing.businessValue, feasibility: existing.feasibility, differentiation: existing.differentiation, duplicateRisk: existing.duplicateRisk, marketRisk: existing.marketRisk })}\n` : ''
  const userMsg = `[mode:icemark]\n来源类型：${sourceType}${sourceName ? `；来源：${sourceName}` : ''}\n素材：\n---\n${text}\n---\n${ctx}`
  const content = await chatJson(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
  return { ...parseJsonContent(content), aiModel: ai.model, aiConfigured: true }
}

export function insertOpportunity(result) {
  const s = result.scores || {}
  const score = computeOpportunityScore(s)
  const info = db.prepare(
    `INSERT INTO opportunities (title, summary, problem_statement, target_users, user_scenarios, pain_points, underlying_needs, source_types, evidence_count, volume, demand_strength_score, pain_intensity_score, evidence_quality_score, business_value_score, feasibility_score, differentiation_score, duplicate_risk_score, market_risk_score, opportunity_score, competitor_analysis, generated_assets, status, ai_model)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    result.title || '未命名需求', result.summary || '', result.problemStatement || '',
    JSON.stringify(result.targetUsers || []), JSON.stringify(result.userScenarios || []), JSON.stringify(result.painPoints || []), JSON.stringify(result.underlyingNeeds || []),
    JSON.stringify(result.sourceTypes || []), 0, num(result.volume) || 1,
    num(s.demandStrength), num(s.painIntensity), num(s.evidenceQuality), num(s.businessValue), num(s.feasibility), num(s.differentiation), num(s.duplicateRisk), num(s.marketRisk), score,
    result.competitorAnalysis ? JSON.stringify(result.competitorAnalysis) : null, result.generatedAssets ? JSON.stringify(result.generatedAssets) : null,
    result.status || 'new', result.aiModel || null
  )
  return Number(info.lastInsertRowid)
}

export function insertEvidence(oppId, rawItem, evidence, sourceType) {
  const items = Array.isArray(evidence) && evidence.length ? evidence : []
  if (!items.length && rawItem) items.push({ quote: rawItem.text.slice(0, 500), sourceType, sourceUrl: rawItem.source_url, relevanceReason: '原始素材全文' })
  const stmt = db.prepare(`INSERT INTO evidence (opportunity_id, raw_item_id, quote, source_type, source_url, relevance_reason, confidence) VALUES (?,?,?,?,?,?,?)`)
  for (const it of items) {
    stmt.run(oppId, rawItem ? rawItem.id : null, String(it.quote || '').slice(0, 2000), it.sourceType || sourceType || 'manual', it.sourceUrl || rawItem?.source_url || null, it.relevanceReason || null, Math.max(0, Math.min(1, num(it.confidence) || 0.8)))
  }
  db.prepare('UPDATE opportunities SET evidence_count = (SELECT COUNT(*) FROM evidence WHERE opportunity_id = ?) WHERE id = ?').run(oppId, oppId)
}

export function insertExperiments(oppId, experiments) {
  const stmt = db.prepare(`INSERT INTO validation_experiments (opportunity_id, hypothesis, experiment, success_metric, time_box, status) VALUES (?,?,?,?,?,?)`)
  for (const it of experiments || []) stmt.run(oppId, it.hypothesis || '', it.experiment || '', it.successMetric || '', it.timeBox || '', it.status || 'draft')
}

export async function distillFromText({ text, sourceType, sourceName, sourceUrl, force = false }) {
  const cleaned = String(text || '').trim()
  if (cleaned.length < 5) throw new Error('素材太短，至少 5 个字符')
  const type = SOURCE_TYPES.includes(sourceType) ? sourceType : 'manual'
  const hash = hashText(cleaned)
  let rawItem = db.prepare('SELECT * FROM raw_items WHERE hash = ?').get(hash)
  let duplicated = false
  if (rawItem && !force) {
    duplicated = true
  } else {
    const info = db.prepare('INSERT INTO raw_items (text, hash, source_type, source_name, source_url) VALUES (?,?,?,?,?)').run(cleaned, hash, type, sourceName || null, sourceUrl || null)
    rawItem = { id: Number(info.lastInsertRowid), text: cleaned, source_type: type, source_name: sourceName, source_url: sourceUrl }
  }
  const result = await runPrompt(cleaned, type, sourceName, null)
  const sourceTypes = result.sourceTypes?.length ? result.sourceTypes : [type]
  const oppId = insertOpportunity({ ...result, sourceTypes })
  insertEvidence(oppId, rawItem, result.evidence, type)
  insertExperiments(oppId, result.validationExperiments)
  db.prepare('UPDATE opportunities SET source_types = ? WHERE id = ?').run(JSON.stringify(sourceTypes), oppId)
  logActivity(oppId, 'distill', `从来源 ${type} 蒸馏生成`)
  syncFeatures(oppId, result)
  rebuildProjects()
  return { duplicated, rawItem: { id: rawItem.id, text: rawItem.text.slice(0, 300) }, result: getDetail(oppId) }
}

export async function reevaluateOpportunity(oppId) {
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId)
  if (!row) throw new Error('机会不存在')
  const existing = parseOpportunityRow(row)
  const ev = db.prepare('SELECT quote FROM evidence WHERE opportunity_id = ?').all(oppId)
  const text = ev.map((e) => e.quote).join('\n') || existing.summary
  const result = await runPrompt(text.slice(0, 12000), existing.sourceTypes?.[0] || 'manual', null, existing)
  const s = result.scores || {}
  const score = computeOpportunityScore(s)
  db.prepare(
    `UPDATE opportunities SET title=?, summary=?, problem_statement=?, target_users=?, user_scenarios=?, pain_points=?, underlying_needs=?, evidence_count=(SELECT COUNT(*) FROM evidence WHERE opportunity_id=?), demand_strength_score=?, pain_intensity_score=?, evidence_quality_score=?, business_value_score=?, feasibility_score=?, differentiation_score=?, duplicate_risk_score=?, market_risk_score=?, opportunity_score=?, competitor_analysis=?, generated_assets=?, ai_model=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    result.title || existing.title, result.summary || existing.summary, result.problemStatement || existing.problemStatement,
    JSON.stringify(result.targetUsers || existing.targetUsers || []), JSON.stringify(result.userScenarios || existing.userScenarios || []), JSON.stringify(result.painPoints || existing.painPoints || []), JSON.stringify(result.underlyingNeeds || existing.underlyingNeeds || []), oppId,
    num(s.demandStrength), num(s.painIntensity), num(s.evidenceQuality), num(s.businessValue), num(s.feasibility), num(s.differentiation), num(s.duplicateRisk), num(s.marketRisk), score,
    result.competitorAnalysis ? JSON.stringify(result.competitorAnalysis) : existing.competitorAnalysis ? JSON.stringify(existing.competitorAnalysis) : null,
    result.generatedAssets ? JSON.stringify(result.generatedAssets) : existing.generatedAssets ? JSON.stringify(existing.generatedAssets) : null,
    result.aiModel || existing.aiModel, oppId
  )
  db.prepare('DELETE FROM validation_experiments WHERE opportunity_id = ?').run(oppId)
  insertExperiments(oppId, result.validationExperiments)
  logActivity(oppId, 'reevaluate', result.changeLog || '重新评估完成')
  return getDetail(oppId)
}

export function updateStatus(oppId, status) {
  if (!ALLOWED_STATUS.has(status)) throw new Error('非法状态')
  const before = db.prepare('SELECT status FROM opportunities WHERE id = ?').get(oppId)
  if (!before) throw new Error('机会不存在')
  db.prepare("UPDATE opportunities SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, oppId)
  logActivity(oppId, 'status_change', `${before.status || 'new'} → ${status}`)
  // shipped → 自动生成 changelog 草稿
  if (status === 'shipped') {
    const opp = parseOpportunityRow(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId))
    insertChangelog(oppId, `已上线：${opp.title}`, opp.summary || opp.problemStatement || '')
    logActivity(oppId, 'changelog', '状态变更为 shipped，自动生成 changelog 草稿')
  }
  return getDetail(oppId)
}

export function deleteOpportunity(oppId) {
  db.prepare('DELETE FROM opportunities WHERE id = ?').run(oppId)
}

export function getDetail(oppId) {
  const detail = getOpportunity(oppId)
  if (!detail) return null
  detail.similar = similarOpportunities(oppId)
  return detail
}
