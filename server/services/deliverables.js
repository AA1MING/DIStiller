import { db, listOpportunities, logActivity } from '../dao/db.js'
import { getAiSettings, chatText, UNIFIED_SYSTEM_PROMPT } from './ai.js'
import { listProjects, getProject } from './projects.js'
import { parseTemplate, extractDocxFormat } from '../utils/template.js'
import { extractCodeLogic } from './repo-import.js'
import { markdownToPdf } from '../utils/pdf.js'
import { htmlToDocx, htmlToMarkdown, textToBasicHtml } from '../utils/html.js'
import { htmlToLatex, texToPdf } from '../utils/latex.js'
import { Buffer } from 'node:buffer'

/**
 * 成果工作台（HTML 流程）：
 * 1. 上传模板时 AI 把模板提炼为 HTML 模板（样式/布局固化）；.tex 模板直接存原文
 * 2. 生成时 AI 参照 HTML 模板布局输出 HTML 文档
 * 3. 导出时 HTML → Word（正式版）/ PDF（LaTeX 编译，.tex 模板仅用于此）/ Markdown / LaTeX 源文件
 */

function featureListOf(project) {
  return (project?.features || []).filter((f) => f.status !== 'dropped')
}

/** 汇总项目数据（功能点、任务类型、机会评分）+ 代码逻辑素材作为生成输入。 */
function collectProjectData(project, extra, codeLogic = '') {
  const feats = featureListOf(project)
  const oppIds = feats.map((f) => f.opportunity_id).filter(Boolean)
  const opps = listOpportunities().filter((o) => oppIds.includes(o.id))
  const techTypes = [...new Set(feats.flatMap((f) => {
    const opp = opps.find((o) => o.id === f.opportunity_id)
    return (opp?.generatedAssets?.developmentTasks || []).map((t) => t.type).filter(Boolean)
  }))]
  const scores = opps.length ? Math.round(opps.reduce((s, o) => s + (o.opportunity_score || 0), 0) / opps.length) : 0
  const intents = [...new Set(opps.flatMap((o) => {
    const it = o.generatedAssets?.intentAnalysis?.intentCategory
    return it ? [it] : []
  }))]
  return {
    projectTitle: project?.title || '未命名项目',
    theme: project?.theme || '',
    features: feats.map((f) => ({ title: f.title, priority: f.priority, description: f.description || '' })),
    techTypes,
    avgScore: scores,
    intents,
    oppCount: opps.length,
    codeLogic: (codeLogic || project?.code_logic || '').slice(0, 30000),
    extra: extra || {},
  }
}

function dataJson(data) {
  return JSON.stringify({ projectTitle: data.projectTitle, theme: data.theme, features: data.features, techTypes: data.techTypes, avgScore: data.avgScore, intents: data.intents, oppCount: data.oppCount, codeLogic: data.codeLogic, extra: data.extra }, null, 2)
}

/** 模板内容：优先用 raw 重新解析（docx 等格式的最新解析逻辑），旧模板无需重新上传。 */
function resolveTemplateContent(tpl) {
  if (!tpl) return ''
  if (tpl.raw) { try { return parseTemplate({ filename: tpl.filename, content: tpl.raw }) } catch { /* 退回已存文本 */ } }
  return tpl.content || ''
}

/** 模板 HTML：已提炼的 html_template，否则用基础转换兜底。 */
function resolveTemplateHtml(tpl) {
  if (!tpl) return ''
  if (tpl.html_template) return tpl.html_template
  return textToBasicHtml(resolveTemplateContent(tpl), tpl.name)
}

/** AI 把模板文本提炼为 HTML 模板（样式/布局固化）。失败返回 null。 */
async function icemarkTemplateHtml(templateName, text) {
  const ai = getAiSettings()
  if (!(ai.enabled && ai.apiKey && ai.baseUrl && ai.model)) return null
  const userMsg = `[mode:deliverable]\n你是文档版式工程师。请把下面的模板文本提炼为一个 HTML 模板：\n- 保留全部章节标题、层级与表格/列表结构\n- 用语义化标签（h1-h6、p、ul/li、table、blockquote）+ 内联 style 定义版式：中文字体（宋体/黑体）、标题字号、正文字号、颜色、对齐、段距\n- 正文/示例内容用简短占位文字（如"待补充"），封面信息（标题、作者、日期等）保留为 h1/居中段落\n- 只输出完整 HTML（<!DOCTYPE html> 开头），不要额外说明\n\n模板文本：\n---\n${String(text || '').slice(0, 14000)}\n---`
  try {
    return await chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
  } catch { return null }
}

/** 用 icemark 生成/修正 HTML 文档（参照模板 HTML 布局）。 */
async function icemarkHtml(template, htmlTemplate, data, prevHtml, feedback) {
  const ai = getAiSettings()
  const templateName = template?.name || '模板'
  const tmplBlock = `【HTML 模板（${templateName}）】\n---\n${String(htmlTemplate || '').slice(0, 20000)}\n---\n`
  const formatRule = '严格参照 HTML 模板的版式：章节顺序、标题层级、字体/字号/颜色/对齐/表格样式都与模板一致，用真实项目内容替换占位文字，无法确定的字段保留"待补充"，不要自创或删减章节，不要编造事实。模板含目录时：目录必须放在文档开头，目录标题使用精确文本"目录"（h1/h2 标题），目录条目用 ul/li 列表（多级用嵌套 ul），并且目录条目的文字必须与正文章节标题逐字完全一致（含编号、标点与空格，不得缩写、改写、合并或补充说明），目录层级必须与标题层级一一对应，正文中的每个标题都必须出现在目录里，目录里不能出现正文不存在的条目。只输出完整 HTML（<!DOCTYPE html> 开头，内联样式），不要额外说明。'
  if (prevHtml && feedback) {
    return chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: `[mode:deliverable]\n你是 icemark 产品经理 Agent。${formatRule} 根据修正意见重写整份文档（保持模板版式）。修正意见：${feedback}\n\n当前版本：\n---\n${String(prevHtml).slice(0, 30000)}\n---\n\n${tmplBlock}\n项目数据参考：\n${dataJson(data)}` }], { step: 'icemark' })
  }
  return chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: `[mode:deliverable]\n你是 icemark 产品经理 Agent。${formatRule} 项目数据中的【代码逻辑】是实体项目源码（或 AI 对源码的整理），描述实现细节、功能与架构时以此为准。\n\n${tmplBlock}\n项目数据：\n${dataJson(data)}` }], { step: 'icemark' })
}

/** 实体项目生成/修正时：实时解压 zip 读取代码逻辑。 */
async function resolveCodeLogic(project) {
  if (!project || !project.repo_path) return ''
  const r = await extractCodeLogic(project)
  return r.text || ''
}

/** 用 icemark（成果文档子模式）以模板为蓝本生成/修正（统一 system prompt，step=icemark）。 */
async function icemarkDeliverable(template, data, prevMarkdown, feedback) {
  const ai = getAiSettings()
  const templateName = template?.name || '模板'
  const templateContent = resolveTemplateContent(template)
  let userMsg
  const tmplBlock = `【模板结构（${templateName}）】\n---\n${templateContent.slice(0, 12000)}\n---\n`
  const formatRule = '模板已转为 Markdown 文本：标题行开头的 # 数量即标题层级（#=一级标题、##=二级标题，以此类推），表格为 markdown 表格。严格按模板的章节顺序与标题层级逐一成文：模板标题原样保留（# 数量与文字都不改动），示例/占位文字用真实内容替换，无法确定的字段保留"待补充"。模板含目录时，在文档开头输出与模板一致的目录（只列章节名与编号），正文章节与目录一一对应。不要自创或删减章节，不要编造事实。'
  if (prevMarkdown && feedback) {
    userMsg = `[mode:deliverable]\n你是 icemark 产品经理 Agent。${formatRule} 根据修正意见重写整份文档（保持模板结构）。修正意见：${feedback}\n\n当前版本：\n---\n${prevMarkdown}\n---\n\n${tmplBlock}\n项目数据参考：\n${dataJson(data)}`
  } else {
    userMsg = `[mode:deliverable]\n你是 icemark 产品经理 Agent。${formatRule} 项目数据中的【代码逻辑】是实体项目源码（或 AI 对源码的整理），描述实现细节、功能与架构时以此为准。只输出 Markdown，不要额外说明。\n\n${tmplBlock}\n项目数据：\n${dataJson(data)}`
  }
  return chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
}

/** 模板 CRUD */
export function listTemplates() {
  return db.prepare('SELECT id, name, filename, length(content) AS chars, created_at FROM templates ORDER BY id DESC').all()
}
export function getTemplate(id) {
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(id))
}
export async function createTemplate({ name, filename, content }) {
  const parsed = parseTemplate({ filename, content })
  const nm = String(name || '').trim() || String(filename || '模板').split('/').pop()
  // .tex 模板仅用于 PDF（LaTeX 编译），不需要 AI 提炼 HTML 模板；其它模板 AI 提炼（失败用基础转换兜底）
  const isTex = /\.tex$/i.test(String(filename || ''))
  const aiHtml = isTex ? null : await icemarkTemplateHtml(nm, parsed)
  const htmlTemplate = aiHtml || textToBasicHtml(parsed, nm)
  const info = db.prepare('INSERT INTO templates (name, filename, content, html_template, raw) VALUES (?,?,?,?,?)').run(nm, String(filename || ''), parsed, htmlTemplate, String(content || ''))
  return db.prepare('SELECT id, name, filename, length(content) AS chars, created_at FROM templates WHERE id = ?').get(Number(info.lastInsertRowid))
}
export function deleteTemplate(id) {
  db.prepare('DELETE FROM templates WHERE id = ?').run(Number(id))
  return { ok: true }
}

/** 下载模板：优先返回原始文件（base64），旧数据无 raw 时退回解析文本。 */
export function downloadTemplate(id) {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(id))
  if (!t) throw new Error('模板不存在')
  return { id: t.id, name: t.name, filename: t.filename, raw: t.raw || null, content: t.content, html_template: t.html_template || null }
}

/** 用 icemark 按 .tex 模板生成/修正 LaTeX 源（仅用于 PDF 导出）。失败抛错由调用方回退。 */
async function icemarkLatex(template, data, prevTex, feedback) {
  const ai = getAiSettings()
  if (!(ai.enabled && ai.apiKey && ai.baseUrl && ai.model)) throw new Error('AI 未配置')
  const templateName = template?.name || '模板'
  const tmplBlock = `【LaTeX 模板（${templateName}）】\n---\n${String(template?.content || '').slice(0, 20000)}\n---\n`
  const formatRule = '严格参照 LaTeX 模板：documentclass、宏包与 preamble 原样保留（禁止新增模板中没有的宏包），章节顺序与标题层级与模板一致，用真实项目内容替换占位文字，无法确定的字段保留"待补充"，不要编造事实。模板含 \\tableofcontents 时保留它。中文依赖 ctex 宏包。确保 xelatex 可直接编译：不要使用模板中未出现的宏包/环境，代码块用 verbatim。只输出 .tex 文件内容，不要 markdown 围栏，不要额外说明。'
  const clean = (s) => String(s || '').replace(/^\s*```(?:tex|latex)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  if (prevTex && feedback) {
    const r = await chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: `[mode:deliverable]\n你是 icemark 文档工程师（LaTeX）。${formatRule} 根据修正意见重写整份 .tex（保持模板 preamble 与结构）。修正意见：${feedback}\n\n当前版本：\n---\n${String(prevTex).slice(0, 30000)}\n---\n\n${tmplBlock}\n项目数据参考：\n${dataJson(data)}` }], { step: 'icemark' })
    return clean(r)
  }
  const r = await chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: `[mode:deliverable]\n你是 icemark 文档工程师（LaTeX）。${formatRule} 项目数据中的【代码逻辑】是实体项目源码（或 AI 对源码的整理），描述实现细节、功能与架构时以此为准。\n\n${tmplBlock}\n项目数据：\n${dataJson(data)}` }], { step: 'icemark' })
  return clean(r)
}

/** 导出成果文档：HTML → md / docx / pdf（LaTeX 编译）/ tex。返回 base64 内容与文件名。 */
export async function exportDeliverable({ templateId = null, projectId = null, markdown = '', html = '', title = '成果文档', format = 'md' }) {
  const base = (title || '文档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  const resolveProject = () => (projectId ? (getProject(projectId) || listProjects().find((p) => String(p.id) === String(projectId)) || null) : null)
  // 优先 HTML 正文：docx 直接转换；md/pdf 先还原为 markdown
  if (html) {
    if (format === 'docx') {
      return { format: 'docx', filename: `${base}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: htmlToDocx(html, base).toString('base64') }
    }
    if (format === 'tex') {
      const tpl = templateId ? getTemplate(templateId) : null
      let tex = htmlToLatex(html, base)
      if (tpl && /\.tex$/i.test(tpl.filename || '')) {
        try { tex = await icemarkLatex(tpl, collectProjectData(resolveProject(), {}, await resolveCodeLogic(resolveProject()))) } catch { /* AI 失败用通用转换 */ }
      }
      return { format: 'tex', filename: `${base}.tex`, mime: 'application/x-tex', content: Buffer.from(tex, 'utf8').toString('base64') }
    }
    if (format === 'pdf') {
      const tpl = templateId ? getTemplate(templateId) : null
      let buf = null
      // 1) .tex 模板：AI 按模板生成 .tex → xelatex 编译
      if (tpl && /\.tex$/i.test(tpl.filename || '')) {
        try {
          const project = resolveProject()
          const tex = await icemarkLatex(tpl, collectProjectData(project, {}, await resolveCodeLogic(project)))
          buf = texToPdf(tex)
        } catch { buf = null }
      }
      // 2) 通用 HTML → LaTeX 编译（无 .tex 模板或 AI 失败）
      if (!buf) { try { buf = texToPdf(htmlToLatex(html, base)) } catch { buf = null } }
      // 3) 回退 pdfkit 直接渲染
      if (!buf) { buf = await markdownToPdf(htmlToMarkdown(html), base) }
      return { format: 'pdf', filename: `${base}.pdf`, mime: 'application/pdf', content: buf.toString('base64') }
    }
    return { format: 'md', filename: `${base}.md`, mime: 'text/markdown;charset=utf-8', content: Buffer.from(htmlToMarkdown(html), 'utf8').toString('base64') }
  }
  // 旧流程（仅 markdown）：docx 模板时复用其样式
  const md = String(markdown || '')
  let fmt = null
  if (templateId) {
    const tpl = getTemplate(templateId)
    if (tpl?.raw && /\.docx$/i.test(tpl.filename)) {
      try { fmt = extractDocxFormat(Buffer.from(tpl.raw, 'base64')) } catch { fmt = null }
    }
  }
  if (format === 'docx') {
    return { format: 'docx', filename: `${base}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: markdownToDocx(md, base, fmt).toString('base64') }
  }
  if (format === 'pdf') {
    return { format: 'pdf', filename: `${base}.pdf`, mime: 'application/pdf', content: (await markdownToPdf(md, base, { headingSizes: fmt?.headingSizes, normalSize: fmt?.normalSize })).toString('base64') }
  }
  return { format: 'md', filename: `${base}.md`, mime: 'text/markdown;charset=utf-8', content: Buffer.from(md, 'utf8').toString('base64') }
}

/** 解析 AI 对话修改回复：首行 <note>说明</note>，其余为完整新 Markdown。 */
function parseChatReply(content) {
  const m = String(content || '').match(/^\s*<note>([\s\S]*?)<\/note>\s*/)
  if (m) return { note: m[1].trim(), markdown: String(content).slice(m[0].length).trim() }
  return { note: '已根据您的意见更新文档', markdown: String(content || '').trim() }
}

/** AI 对话式修改成果文档（HTML）：基于当前版本 + 修改历史 + 最新意见重写。 */
export async function chatDeliverable({ templateId = null, projectId = null, html, history = [], message }) {
  if (!html) throw new Error('缺少当前文档内容')
  if (!String(message || '').trim()) throw new Error('修改意见不能为空')
  const tpl = templateId ? getTemplate(templateId) : null
  const htmlTemplate = resolveTemplateHtml(tpl)
  const project = projectId ? getProject(projectId) || listProjects().find((p) => String(p.id) === String(projectId)) || null : null
  const codeLogic = await resolveCodeLogic(project)
  const data = collectProjectData(project, {}, codeLogic)

  const hist = (Array.isArray(history) ? history : []).slice(-6).map((h) => `${h.role === 'user' ? '用户要求' : 'AI 修改'}：${String(h.content || '').slice(0, 300)}`).join('\n')
  const userMsg = `[mode:deliverable]\n你是 icemark 的文档编辑助手。严格参照 HTML 模板的版式（章节顺序、标题层级、字体/字号/颜色/对齐/表格样式）保持整份文档风格，根据最新修改要求重写整份 HTML 文档；无法确定的字段保留"待补充"；不要编造事实。\n\n【HTML 模板】\n---\n${String(htmlTemplate).slice(0, 12000)}\n---\n\n【当前文档】\n---\n${String(html).slice(0, 30000)}\n---\n\n${hist ? `【修改历史】\n${hist}\n` : ''}【最新修改要求】\n${String(message || '').slice(0, 2000)}\n\n项目数据：\n${dataJson(data)}\n\n回复格式：第一行输出 <note>本次修改说明（一句话）</note>，随后输出完整的新 HTML 文档（<!DOCTYPE html> 开头，内联样式）。`
  const ai = getAiSettings()
  const content = await chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
  const reply = parseChatReply(content)
  // AI 修改后自动保存为新版本（保留修改意见）
  try {
    saveDeliverableVersion({ kind: tpl?.name || '成果', projectId: projectId || null, title: `${tpl?.name || '模板'} · ${data.projectTitle}`, html: reply.markdown, feedback: String(message || '').slice(0, 200) })
  } catch { /* 保存失败不影响返回 */ }
  return reply
}

/** 生成成果文档（HTML）：AI 参照 HTML 模板布局，用项目数据生成 HTML 版本文档。 */
export async function generateDeliverable({ templateId = null, template = null, projectId = null, extra = {} }) {
  let tpl = null
  if (templateId) tpl = getTemplate(templateId)
  else if (template?.content) tpl = template
  if (!tpl?.content) throw new Error('请先选择或上传一个成果模板')
  let project = null
  if (projectId) { project = getProject(projectId) || listProjects().find((p) => String(p.id) === String(projectId)) || null }
  const codeLogic = await resolveCodeLogic(project)
  const data = collectProjectData(project, extra, codeLogic)
  const htmlTemplate = resolveTemplateHtml(tpl)

  const ai = getAiSettings()
  let html
  if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
    try { html = await icemarkHtml(tpl, htmlTemplate, data) } catch (e) { html = htmlFallback(tpl, data, e.message) }
  } else {
    html = htmlFallback(tpl, data)
  }
  const title = `${tpl.name} · ${data.projectTitle}`
  // 自动保存历史版本（防止丢失生成记录）
  const saved = saveDeliverableVersion({ kind: tpl.name || '成果', projectId: projectId || null, title, html })
  return { templateId: tpl.id || null, templateName: tpl.name, title, projectId, html, version: saved.version, versionId: saved.id }
}

/** 反馈修正（HTML）：基于当前版本 + 修正意见重写。 */
export async function reviseDeliverable({ templateId = null, projectId = null, extra = {}, html, feedback }) {
  if (!html) throw new Error('缺少当前版本内容')
  const tpl = templateId ? getTemplate(templateId) : null
  let project = null
  if (projectId) { project = getProject(projectId) || listProjects().find((p) => String(p.id) === String(projectId)) || null }
  const codeLogic = await resolveCodeLogic(project)
  const data = collectProjectData(project, extra, codeLogic)
  const htmlTemplate = resolveTemplateHtml(tpl)
  const ai = getAiSettings()
  let next
  if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
    try { next = await icemarkHtml(tpl, htmlTemplate, data, html, feedback) } catch { next = html }
  } else {
    next = html
  }
  const title = `${tpl?.name || '模板'} · ${data.projectTitle}`
  // 修正后自动保存新版本
  const saved = saveDeliverableVersion({ kind: tpl?.name || '成果', projectId: projectId || null, title, html: next, feedback })
  return { templateId: tpl?.id || null, templateName: tpl?.name || '模板', title, projectId, html: next, version: saved.version, versionId: saved.id, feedback }
}

/** 无 AI 时的 HTML 回退：保留模板 HTML 结构，把项目数据嵌入。 */
function htmlFallback(tpl, data, errorMsg = '') {
  const feats = data.features.map((f) => `<li>${f.title}${f.description ? `：${f.description}` : ''}</li>`).join('')
  const base = textToBasicHtml(resolveTemplateContent(tpl), tpl.name)
  const note = `<p style="color:#b91c1c">（本地模式，未调用 AI${errorMsg ? `：${errorMsg}` : ''}）</p>`
  const featsBlock = `<h2 style="font-size:20px">项目数据</h2><p>主题：${data.theme || '未指定'}</p><ul>${feats || '<li>无功能点</li>'}</ul>`
  return base.replace('</body>', `${note}${featsBlock}</body>`)
}

/** 保存成果版本到 deliverable_versions（HTML 正文）。返回版本号与记录。 */
export function saveDeliverableVersion({ kind, projectId = null, title, markdown = null, html = null, feedback = null }) {
  const row = db.prepare('SELECT MAX(version) AS v FROM deliverable_versions WHERE kind = ? AND (project_id IS ? OR project_id = ?)').get(kind, projectId, projectId)
  const version = (row?.v || 0) + 1
  const info = db.prepare('INSERT INTO deliverable_versions (project_id, kind, version, title, markdown, html, feedback) VALUES (?,?,?,?,?,?,?)')
    .run(projectId || null, kind, version, title || '', html ? htmlToMarkdown(html) : (markdown || ''), html || null, feedback || null)
  return { id: Number(info.lastInsertRowid), version }
}

export function listDeliverableVersions(projectId = null) {
  const rows = projectId
    ? db.prepare('SELECT * FROM deliverable_versions WHERE project_id = ? ORDER BY id DESC').all(Number(projectId))
    : db.prepare('SELECT * FROM deliverable_versions ORDER BY id DESC').all()
  return rows
}

/** 删除单个成果历史版本。 */
export function deleteDeliverableVersion(id) {
  const info = db.prepare('DELETE FROM deliverable_versions WHERE id = ?').run(Number(id))
  if (!info.changes) throw new Error('版本不存在')
  return { ok: true }
}

/** 把成果版本导入回项目：更新项目主题并标记 imported。 */
export function importVersionToProject(versionId) {
  const v = db.prepare('SELECT * FROM deliverable_versions WHERE id = ?').get(Number(versionId))
  if (!v) throw new Error('版本不存在')
  if (v.project_id) {
    const kindLabel = v.kind || '成果'
    db.prepare("UPDATE projects SET theme = COALESCE(NULLIF(?, ''), theme) WHERE id = ?").run(`成果：${kindLabel} v${v.version}`, v.project_id)
  }
  db.prepare('UPDATE deliverable_versions SET imported = 1 WHERE id = ?').run(v.id)
  return { ok: true, version: v }
}
