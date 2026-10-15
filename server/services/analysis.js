import { db } from '../dao/db.js'
import { getAiSettings, chatText, chatJson, UNIFIED_SYSTEM_PROMPT } from './ai.js'
import { extractCodeLogic } from './repo-import.js'
import { parseJsonContent } from './distill.js'

/**
 * icemark 产品分析：市场分析（SWOT/PESTEL/波特五力）、PRD（用户故事/JTBD）、HTML 交互原型。
 */

function getProjectRow(id) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id))
  if (!p) throw new Error('项目不存在')
  return p
}

function featureDigest(projectId) {
  return db
    .prepare(
      `SELECT f.title, f.description, f.priority, f.intent_category
       FROM project_features pf JOIN features f ON f.id = pf.feature_id
       WHERE pf.project_id = ? AND f.status = 'kept'`
    )
    .all(Number(projectId))
}

async function buildContext(projectId) {
  const p = getProjectRow(projectId)
  const feats = featureDigest(projectId)
  const codeLogic = await extractCodeLogic(p)
  return { p, feats, codeLogic: codeLogic.text || '' }
}

async function runAnalysis(kind, ctx) {
  const { p, feats, codeLogic } = ctx
  const ai = getAiSettings()
  const featText = feats.map((f) => `- [${f.priority || 'P1'}] ${f.title}${f.intent_category ? `（意图：${f.intent_category}）` : ''}${f.description ? `：${f.description}` : ''}`).join('\n') || '- （暂无功能点）'
  const codeBlock = codeLogic ? `\n【项目代码逻辑】\n${codeLogic.slice(0, 12000)}\n` : ''
  const userMsg = `[mode:analysis]\n请为以下项目生成${kind}。\n项目：${p.title}\n主题：${p.theme || '未指定'}\n需求分析：${(p.description || '').slice(0, 4000)}\n功能点：\n${featText}${codeBlock}`
  return chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
}

function localFallback(kind, p, feats) {
  const list = feats.map((f) => `- ${f.title}`).join('\n') || '- （暂无）'
  return `# ${p.title} — ${kind}\n\n> 本地模式：配置 AI 后可生成完整分析。\n\n## 功能点概览\n${list}`
}

/** 市场分析 JSON → Markdown（文字版备用）。 */
export function marketDataToMarkdown(data) {
  const d = data || {}
  const lines = [`# 市场分析报告`, '', d.summary ? `**总体结论**：${d.summary}` : '']
  const swot = d.swot || {}
  const swotRows = [['优势 Strengths', swot.strengths], ['劣势 Weaknesses', swot.weaknesses], ['机会 Opportunities', swot.opportunities], ['威胁 Threats', swot.threats]]
  for (const [label, items] of swotRows) {
    lines.push('', `## ${label}`, '')
    lines.push(...(Array.isArray(items) && items.length ? items.map((i) => `- ${i}`) : ['- 待补充']))
  }
  if (Array.isArray(d.pestel) && d.pestel.length) {
    lines.push('', '## PESTEL 分析', '')
    for (const p of d.pestel) {
      lines.push(`### ${p.factor || ''}`)
      lines.push(...(Array.isArray(p.items) && p.items.length ? p.items.map((i) => `- ${i}`) : ['- 待补充']))
    }
  }
  if (Array.isArray(d.fiveForces) && d.fiveForces.length) {
    lines.push('', '## 波特五力分析', '')
    for (const f of d.fiveForces) lines.push(`- **${f.name}**（${f.score} 分）：${f.description || ''}`)
  }
  if (d.overallScore != null) lines.push('', `## 综合机会评分：${d.overallScore} / 100`)
  return lines.filter(Boolean).join('\n')
}

/** 市场分析报告：SWOT / PESTEL / 波特五力（结构化 JSON + 文字版）。 */
export async function marketAnalysis(projectId) {
  const ctx = await buildContext(projectId)
  const ai = getAiSettings()
  if (!(ai.enabled && ai.apiKey && ai.baseUrl && ai.model)) {
    const data = {
      summary: `「${ctx.p.title}」的市场分析（本地模式，配置 AI 后可生成完整分析）`,
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      pestel: ['政治', '经济', '社会', '技术', '环境', '法律'].map((factor) => ({ factor, items: [] })),
      fiveForces: [
        { name: '现有竞争者的竞争程度', score: 50, description: '' }, { name: '潜在进入者威胁', score: 50, description: '' },
        { name: '替代品威胁', score: 50, description: '' }, { name: '供应商议价能力', score: 50, description: '' }, { name: '购买者议价能力', score: 50, description: '' },
      ],
      overallScore: 50,
    }
    return { kind: 'market', title: `${ctx.p.title} · 市场分析`, data, markdown: marketDataToMarkdown(data) }
  }
  const { p, feats, codeLogic } = ctx
  const featText = feats.map((f) => `- [${f.priority || 'P1'}] ${f.title}${f.intent_category ? `（意图：${f.intent_category}）` : ''}${f.description ? `：${f.description}` : ''}`).join('\n') || '- （暂无功能点）'
  const codeBlock = codeLogic ? `\n【项目代码逻辑】\n${codeLogic.slice(0, 10000)}\n` : ''
  const userMsg = `[mode:analysis]\n请为以下项目生成市场分析（SWOT / PESTEL / 波特五力），按能力说明输出 JSON。\n项目：${p.title}\n主题：${p.theme || '未指定'}\n需求分析：${(p.description || '').slice(0, 3000)}\n功能点：\n${featText}${codeBlock}`
  try {
    const content = await chatJson(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
    const data = parseJsonContent(content)
    return { kind: 'market', title: `${p.title} · 市场分析`, data, markdown: marketDataToMarkdown(data) }
  } catch {
    const md = await runAnalysis('市场分析报告（包含 SWOT 分析表、PESTEL 分析表、波特五力分析表与结论建议）', ctx)
    return { kind: 'market', title: `${ctx.p.title} · 市场分析`, markdown: md }
  }
}

/** 产品需求文档：用户故事 + JTBD。 */
export async function prdAnalysis(projectId) {
  const ctx = await buildContext(projectId)
  const ai = getAiSettings()
  if (!(ai.enabled && ai.apiKey && ai.baseUrl && ai.model)) return { kind: 'prd', title: `${ctx.p.title} · 产品需求文档`, markdown: localFallback('产品需求文档（PRD）', ctx.p, ctx.feats) }
  const markdown = await runAnalysis('产品需求文档 PRD（基于用户故事与 JTBD 理论：背景与目标、目标用户、用户故事、JTBD、功能需求清单、验收标准、非功能需求、里程碑）', ctx)
  return { kind: 'prd', title: `${ctx.p.title} · 产品需求文档`, markdown }
}

/** HTML 交互原型：完整单页，可浏览器直接打开。 */
export async function prototypeHtml(projectId) {
  const ctx = await buildContext(projectId)
  const ai = getAiSettings()
  if (!(ai.enabled && ai.apiKey && ai.baseUrl && ai.model)) {
    const list = ctx.feats.map((f) => `<li>${f.title}</li>`).join('')
    return { kind: 'prototype', title: `${ctx.p.title} · HTML 原型`, html: `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${ctx.p.title} 原型</title><style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 20px}li{margin:8px 0}</style></head><body><h1>${ctx.p.title}</h1><h2>核心功能</h2><ul>${list}</ul></body></html>` }
  }
  const html = await runAnalysis('HTML 交互原型（完整单页 HTML，内联 CSS/JS，中文界面，可交互演示核心流程）', ctx)
  return { kind: 'prototype', title: `${ctx.p.title} · HTML 原型`, html }
}
