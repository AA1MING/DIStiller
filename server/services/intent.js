import { db, listOpportunities } from '../dao/db.js'
import { tokenize, jaccard } from './dedup.js'

const INTENT_RULES = [
  { key: 'workflow_friction', label: '流程摩擦', hints: ['麻烦', '重复', '手动', '整理', '复制', '切换', '效率', '耗时', '工作流'] },
  { key: 'decision_support', label: '决策支持', hints: ['判断', '优先级', '值得做', '评分', '选择', '决策', '分析', '机会'] },
  { key: 'automation', label: '自动化诉求', hints: ['自动', '批量', '汇总', '分类', '提醒', '生成', '同步'] },
  { key: 'insight_discovery', label: '洞察发现', hints: ['发现', '趋势', '聚类', '主题', '痛点', '需求', '信号'] },
  { key: 'competitive_gap', label: '竞品缺口', hints: ['竞品', '替代', '类似', '同质化', '差异化', '市场'] },
  { key: 'validation_need', label: '验证需求', hints: ['验证', '实验', '访谈', '落地页', '假设', '测试'] },
]

function inferIntent(opp) {
  const embedded = opp.generatedAssets?.intentAnalysis
  if (embedded?.intentCategory) {
    return { key: embedded.intentCategory, label: embedded.intentCategory, confidence: embedded.confidence ?? 0.75,
      explicitNeed: embedded.explicitNeed || opp.summary, implicitIntent: embedded.implicitIntent || (opp.underlyingNeeds || []).join('；'),
      jobsToBeDone: embedded.jobsToBeDone || [], antiSignals: embedded.antiSignals || [] }
  }
  const text = `${opp.title} ${opp.summary || ''} ${(opp.painPoints || []).join(' ')} ${(opp.underlyingNeeds || []).join(' ')}`
  const ranked = INTENT_RULES.map((r) => ({ r, s: r.hints.reduce((n, h) => n + (text.toLowerCase().includes(h) ? 1 : 0), 0) })).sort((a, b) => b.s - a.s)
  const top = ranked[0]?.s > 0 ? ranked[0].r : INTENT_RULES[1]
  return { key: top.key, label: top.label, explicitNeed: opp.summary || opp.title,
    implicitIntent: (opp.underlyingNeeds || [])[0] || '待进一步访谈澄清真实意图',
    jobsToBeDone: (opp.userScenarios || []).slice(0, 3), confidence: ranked[0]?.s > 1 ? 0.72 : 0.45,
    antiSignals: (opp.evidence_count || 0) < 2 ? ['证据数量偏少，可能存在伪需求风险'] : [] }
}

export function buildIntentMap() {
  const opportunities = listOpportunities()
  const intents = new Map()
  for (const opp of opportunities) {
    const intent = inferIntent(opp)
    const cur = intents.get(intent.key) || { key: intent.key, label: intent.label, count: 0, avgOpportunityScore: 0, evidenceCount: 0, confidence: 0, opportunities: [], explicitNeeds: [], implicitIntents: [], jobsToBeDone: [], antiSignals: [] }
    cur.count += 1; cur.evidenceCount += opp.evidence_count || 0; cur.avgOpportunityScore += opp.opportunity_score || 0; cur.confidence += intent.confidence || 0
    cur.opportunities.push({ id: opp.id, title: opp.title, score: opp.opportunity_score })
    if (intent.explicitNeed) cur.explicitNeeds.push(intent.explicitNeed)
    if (intent.implicitIntent) cur.implicitIntents.push(intent.implicitIntent)
    cur.jobsToBeDone.push(...(intent.jobsToBeDone || [])); cur.antiSignals.push(...(intent.antiSignals || []))
    intents.set(intent.key, cur)
  }
  return [...intents.values()].map((c) => ({
    ...c, avgOpportunityScore: Math.round(c.avgOpportunityScore / c.count), confidence: Number((c.confidence / c.count).toFixed(2)),
    explicitNeeds: [...new Set(c.explicitNeeds)].slice(0, 5), implicitIntents: [...new Set(c.implicitIntents)].slice(0, 5),
    jobsToBeDone: [...new Set(c.jobsToBeDone)].slice(0, 6), antiSignals: [...new Set(c.antiSignals)].slice(0, 5),
  })).sort((a, b) => b.avgOpportunityScore - a.avgOpportunityScore)
}

export function buildOpportunityConstellation() {
  const opportunities = listOpportunities()
  return opportunities.map((opp) => {
    const tokens = tokenize(`${opp.title} ${opp.summary || ''} ${(opp.painPoints || []).join(' ')}`)
    const neighbors = opportunities.filter((o) => o.id !== opp.id).map((o) => ({
      id: o.id, title: o.title, similarity: jaccard(tokens, tokenize(`${o.title} ${o.summary || ''} ${(o.painPoints || []).join(' ')}`)),
    })).filter((n) => n.similarity > 0.12).sort((a, b) => b.similarity - a.similarity).slice(0, 4)
    return { id: opp.id, title: opp.title, score: opp.opportunity_score, intent: inferIntent(opp), neighbors }
  })
}

/** PM 组合策略：自动按分数/可行性/风险分 Now/Next/Later（Q4=A，不做手动拖拽）。 */
export function buildPmPortfolio() {
  const opportunities = listOpportunities()
  const now = [], next = [], later = []
  for (const opp of opportunities) {
    const score = opp.opportunity_score || 0
    const risky = (opp.duplicateRisk || 0) >= 65 || (opp.marketRisk || 0) >= 70
    const feasible = (opp.feasibility || 0) >= 50
    const card = { id: opp.id, title: opp.title, score, evidenceCount: opp.evidence_count, status: opp.status }
    if (score >= 70 && feasible && !risky) now.push(card)
    else if (score >= 50 || (opp.demandStrength || 0) >= 55) next.push(card)
    else later.push(card)
  }
  return {
    strategy: {
      focus: now.length ? '优先推进高分机会的验证实验与 MVP 定义' : '当前信号偏弱，建议先扩大素材来源并验证意图真实性',
      nextAction: next.length ? '从候选机会中挑选证据质量最高的一项做 2 周验证实验' : '继续收集高质量原始证据',
      portfolioHealth: opportunities.length >= 5 ? '可形成机会组合判断' : '样本量偏少，暂不建议直接进入开发',
    },
    lanes: { now, next, later },
  }
}

export function buildPmBrief(oppId) {
  const detail = require_detail(oppId)
  if (!detail) return null
  const o = detail.opportunity, assets = o.generatedAssets || {}, comp = o.competitorAnalysis || {}
  return {
    onePager: { title: o.title, problem: o.problemStatement, targetUsers: o.targetUsers || [],
      valueProposition: (o.underlyingNeeds || []).slice(0, 3).join('；') || o.summary,
      successMetric: detail.experiments?.[0]?.success_metric || '完成验证实验并达到预设转化/访谈成功标准' },
    leanCanvas: {
      customerSegments: o.targetUsers || [], problems: o.painPoints || [], solution: (assets.featureList || []).map((f) => f.title),
      uniqueValue: (comp.differentiationAngles || []).slice(0, 3), channels: ['社区访谈', '落地页验证', '竞品评论区定向触达'],
      revenue: ['SaaS 订阅', '团队版席位', '按量 AI 分析'], cost: ['AI 调用成本', '数据接入与清洗', '用户研究与获客'],
      keyMetrics: ['机会分', '验证实验成功率', '激活率', '留存率'], unfairAdvantage: ['原始证据链', '持续反馈闭环', '产品机会雷达'] },
    prototypePrompt: assets.prototypePrompt || `为「${o.title}」设计低保真原型，突出导入素材、证据链、机会评分、MVP 范围。`,
    riskRegister: assets.riskRegister || [{ risk: comp.duplicateRiskSummary || '同质化风险待验证', mitigation: '强调差异化切入点与证据链闭环' }],
  }
}

// 本地 helper，避免循环导入 distill.getDetail
function require_detail(oppId) {
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId)
  if (!row) return null
  const opportunity = JSON_parse_opp(row)
  const evidence = db.prepare('SELECT e.*, r.source_name FROM evidence e LEFT JOIN raw_items r ON r.id = e.raw_item_id WHERE e.opportunity_id = ?').all(oppId)
  const experiments = db.prepare('SELECT * FROM validation_experiments WHERE opportunity_id = ?').all(oppId)
  return { opportunity, evidence, experiments }
}

function JSON_parse_opp(row) {
  // 复用 db 的 parseOpportunityRow 逻辑（简化版，避免循环依赖）
  const p = (t, f = null) => { try { return t == null ? f : JSON.parse(t) } catch { return f } }
  return {
    ...row, targetUsers: p(row.target_users, []), userScenarios: p(row.user_scenarios, []), painPoints: p(row.pain_points, []),
    underlyingNeeds: p(row.underlying_needs, []), sourceTypes: p(row.source_types, []), problemStatement: row.problem_statement,
    demandStrength: row.demand_strength_score, painIntensity: row.pain_intensity_score, evidenceQuality: row.evidence_quality_score,
    businessValue: row.business_value_score, feasibility: row.feasibility_score, differentiation: row.differentiation_score,
    duplicateRisk: row.duplicate_risk_score, marketRisk: row.market_risk_score,
    competitorAnalysis: p(row.competitor_analysis, null), generatedAssets: p(row.generated_assets, null),
  }
}
