import { AsyncLocalStorage } from 'node:async_hooks'
import { db, dbContext } from '../dao/db.js'
import { globalDb } from '../dao/global-db.js'
import { logUsage } from './usage.js'

export const PROVIDER_DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  custom_openai: { baseUrl: '', model: '' },
  points: { baseUrl: '', model: '' },
}

// 积分激励固定汇率：每 1M token = 100 积分（仅需配置 Provider）
export const POINTS_RATE = { perMillion: 100 }

/** 积分模式模型管理（管理端配置）：[{ model, pricePerM, urls: [{ url, keys: [] }] }]，每 1M token 的积分价格。 */
function normalizeEndpoint(u) {
  if (!u || typeof u !== 'object') return null
  const url = typeof u.url === 'string' ? u.url.trim() : ''
  if (!url) return null
  const keys = (Array.isArray(u.keys) ? u.keys : []).map((k) => String(k).trim()).filter(Boolean)
  return { url, keys }
}

function normalizeModel(m) {
  if (!m || typeof m.model !== 'string' || !m.model.trim()) return null
  const base = { model: m.model.trim(), pricePerM: Math.max(0, Math.round(Number(m.pricePerM) || 0)) }
  if (Array.isArray(m.urls)) return { ...base, urls: m.urls.map(normalizeEndpoint).filter(Boolean) }
  // 旧结构兼容：{ model, pricePerM, url, key } → urls
  const url = typeof m.url === 'string' ? m.url.trim() : ''
  const key = typeof m.key === 'string' ? m.key.trim() : ''
  return { ...base, urls: url ? [{ url, keys: key ? [key] : [] }] : [] }
}

export function loadPointsModels() {
  const row = globalDb.prepare('SELECT value FROM global_settings WHERE key = ?').get('ai_points_models')
  if (!row) return []
  try {
    const v = JSON.parse(row.value)
    if (!Array.isArray(v)) return []
    return v.map(normalizeModel).filter(Boolean)
  } catch { return [] }
}

/** 保存积分模式模型列表（一个模型多个 URL，一个 URL 多个 Key），返回规范化后的列表。 */
export function savePointsModels(list = []) {
  if (!Array.isArray(list)) throw Object.assign(new Error('模型列表格式不正确'), { status: 400 })
  const models = list.map((m) => {
    const model = typeof m?.model === 'string' ? m.model.trim() : ''
    if (!model) throw Object.assign(new Error('模型名称不能为空'), { status: 400 })
    const pricePerM = Math.max(0, Math.round(Number(m?.pricePerM) || 0))
    const urls = (Array.isArray(m?.urls) ? m.urls : [])
      .map((u) => {
        const url = typeof u?.url === 'string' ? u.url.trim() : ''
        if (!url) throw Object.assign(new Error(`模型「${model}」的 Base URL 不能为空`), { status: 400 })
        const keys = (Array.isArray(u?.keys) ? u.keys : []).map((k) => String(k).trim()).filter(Boolean)
        if (!keys.length) throw Object.assign(new Error(`模型「${model}」接口 ${url} 至少需要一个 API Key`), { status: 400 })
        return { url, keys }
      })
    if (!urls.length) throw Object.assign(new Error(`模型「${model}」至少需要一个 Base URL`), { status: 400 })
    return { model, pricePerM, urls }
  })
  const seen = new Set()
  for (const m of models) {
    if (seen.has(m.model)) throw Object.assign(new Error(`模型「${m.model}」重复`), { status: 400 })
    seen.add(m.model)
  }
  globalDb.prepare('INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('ai_points_models', JSON.stringify(models))
  return models
}

/** 积分模型分流游标：按模型轮询选择 URL / Key（进程内计数，多请求分摊负载）。 */
const pointsCursor = new Map()

function pickPointsEndpoint(pm) {
  const pairs = []
  for (const u of pm.urls || []) for (const k of u.keys || []) pairs.push({ url: u.url, key: k })
  if (!pairs.length) return null
  const idx = pointsCursor.get(pm.model) || 0
  pointsCursor.set(pm.model, (idx + 1) % pairs.length)
  return pairs[idx]
}

function hasPointsKey(pm) {
  return !!(pm && (pm.urls || []).some((u) => (u.keys || []).some((k) => k)))
}

/** 记录积分模型接口使用：按 模型 + URL + 用户 累加，用于管理端「每个 URL 使用人数」统计。 */
export function recordPointsEndpointUse(model, url) {
  try {
    const userId = dbContext.getStore()?.userId || 0
    globalDb.prepare(`INSERT INTO points_model_usage (model, url, user_id, calls, updated_at) VALUES (?,?,?,1,datetime('now'))
      ON CONFLICT(model, url, user_id) DO UPDATE SET calls = calls + 1, updated_at = datetime('now')`).run(model, url, userId)
  } catch {}
}

/** 每个 模型 + URL 的使用人数（去重用户数）与调用次数。 */
export function pointsModelUsage() {
  return globalDb.prepare(`SELECT model, url, COUNT(*) AS users, SUM(calls) AS calls FROM points_model_usage GROUP BY model, url ORDER BY model, url`).all()
}

const BASE_DEFAULTS = {
  provider: 'openai',
  name: '默认 AI Provider',
  baseUrl: '',
  model: '',
  embeddingModel: '',
  apiKey: '',
  enabled: true,
  pointsProvider: '',
}

// 请求级 AI 配置上下文：客户端可通过 X-AI-Config 请求头携带自己的
// OpenAI 兼容接口配置，实现「每人独立配置 API」——配置不落库、不共享，
// 仅对携带该头的本次请求（及其后台异步任务）生效。
export const aiRequestContext = new AsyncLocalStorage()

/** 只读服务端存储的配置（不含请求头覆盖）。 */
function loadStored() {
  const base = { ...BASE_DEFAULTS }
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai')
  if (row) { try { Object.assign(base, JSON.parse(row.value)) } catch {} }
  return base
}

/** 各模型独立 API Key 存储（settings 表 ai_keys：{ provider: key }，每人独立库）。 */
function loadStoredKeys() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_keys')
  if (row) { try { const v = JSON.parse(row.value); if (v && typeof v === 'object') return v } catch {} }
  return {}
}

/** 按 provider 解析 API Key：独立 Key 存储优先，其次旧版单 Key（apiKey），最后为空串。 */
function resolveKey(base, override) {
  const keys = { ...loadStoredKeys() }
  if (override && override.apiKeys && typeof override.apiKeys === 'object') Object.assign(keys, override.apiKeys)
  const k = keys[base.provider]
  if (typeof k === 'string' && k) return k
  return typeof base.apiKey === 'string' ? base.apiKey : ''
}

/** 生效配置 = 服务端存储 + 请求头携带的客户端配置（完整覆盖，apiKey 传空即视为未配置）。 */
export function getAiSettings() {
  const base = loadStored()
  const override = aiRequestContext.getStore()
  if (override && typeof override === 'object') Object.assign(base, override)
  const def = PROVIDER_DEFAULTS[base.provider] || PROVIDER_DEFAULTS.openai
  if (!base.baseUrl) base.baseUrl = def.baseUrl
  if (!base.model) base.model = def.model
  base.apiKey = resolveKey(base, override)
  // 积分模式：从该模型配置的多个 URL / Key 中轮询分流，并记录本次选中的 URL 供用量统计
  if (base.provider === 'points' && base.model) {
    const pm = loadPointsModels().find((m) => m.model === base.model)
    const ep = pm && pickPointsEndpoint(pm)
    if (ep) {
      base.baseUrl = ep.url
      base.apiKey = ep.key
      base.pointsUrl = ep.url
    }
  }
  return base
}

export function publicAiSettings() {
  const s = getAiSettings()
  const override = aiRequestContext.getStore()
  const keys = { ...loadStoredKeys() }
  if (override && override.apiKeys && typeof override.apiKeys === 'object') Object.assign(keys, override.apiKeys)
  const keyFlags = {}
  for (const p of Object.keys(PROVIDER_DEFAULTS)) keyFlags[p] = !!(typeof keys[p] === 'string' && keys[p])
  const pointsModels = loadPointsModels().map(({ model, pricePerM }) => ({ model, pricePerM }))
  const pointsKey = s.provider === 'points' ? hasPointsKey(loadPointsModels().find((m) => m.model === s.model)) : false
  return {
    provider: s.provider, name: s.name,
    baseUrl: s.provider === 'points' ? '' : s.baseUrl,
    model: s.model,
    embeddingModel: s.embeddingModel || '', enabled: s.enabled,
    hasApiKey: s.provider === 'points' ? !!pointsKey : !!s.apiKey,
    apiKeys: keyFlags,
    defaults: PROVIDER_DEFAULTS,
    pointsProvider: s.pointsProvider || '',
    pointsRatePerM: POINTS_RATE.perMillion,
    pointsModels,
  }
}

export function saveAiSettings(patch = {}) {
  // 仅基于服务端存储配置保存，避免请求头覆盖泄漏进共享配置
  const cur = loadStored()
  const def = PROVIDER_DEFAULTS[cur.provider] || PROVIDER_DEFAULTS.openai
  if (!cur.baseUrl) cur.baseUrl = def.baseUrl
  if (!cur.model) cur.model = def.model
  // 各模型独立 Key：字符串覆盖、null 清除、空字符串保持不变
  const { apiKeys: keyPatch, ...rest } = patch || {}
  if (keyPatch && typeof keyPatch === 'object') {
    const keys = loadStoredKeys()
    for (const p of Object.keys(PROVIDER_DEFAULTS)) {
      const v = keyPatch[p]
      if (v === null) { delete keys[p]; continue }
      if (typeof v === 'string' && v.trim()) keys[p] = v.trim()
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('ai_keys', JSON.stringify(keys))
  }
  const next = { ...cur, ...rest }
  if (!rest.apiKey) next.apiKey = cur.apiKey
  next.baseUrl = (next.baseUrl || '').trim()
  next.model = (next.model || '').trim()
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('ai', JSON.stringify(next))
  return publicAiSettings()
}

/** 解析测试/检测用的 API Key：请求带的新 Key 优先，其次独立 Key 存储，最后当前生效 Key。 */
function resolveRequestKey(cfg, base, cur) {
  const provider = base.provider
  const keyPatch = cfg && cfg.apiKeys
  if (keyPatch && typeof keyPatch === 'object' && typeof keyPatch[provider] === 'string' && keyPatch[provider].trim()) return keyPatch[provider].trim()
  if (cfg && typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) return cfg.apiKey.trim()
  const keys = { ...loadStoredKeys() }
  const override = aiRequestContext.getStore()
  if (override && override.apiKeys && typeof override.apiKeys === 'object') Object.assign(keys, override.apiKeys)
  const k = keys[provider]
  if (typeof k === 'string' && k) return k
  return provider === cur.provider ? cur.apiKey : ''
}

export async function testAiConnection(cfg = {}) {
  const cur = getAiSettings()
  const s = { ...cur, ...cfg }
  s.apiKey = resolveRequestKey(cfg, s, cur)
  if (!s.apiKey) return { ok: false, error: '未配置 API Key，请先在设置中填写' }
  if (!s.baseUrl || !s.model) return { ok: false, error: 'Base URL 与 Model 不能为空' }
  try {
    const res = await fetch(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({ model: s.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
    })
    if (!res.ok) { const t = await res.text(); return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` } }
    return { ok: true, model: s.model }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

/** 自动检测模型列表：调 OpenAI 兼容接口 GET /models，返回模型 id 列表（最多 100 个，按字母序）。 */
export async function listAiModels(cfg = {}) {
  const cur = getAiSettings()
  const s = { ...cur, ...(cfg || {}) }
  s.apiKey = resolveRequestKey(cfg || {}, s, cur)
  if (!s.apiKey) throw new Error('未配置 API Key，无法检测模型列表')
  if (!s.baseUrl) throw new Error('Base URL 不能为空')
  const res = await fetch(`${s.baseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${s.apiKey}` },
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`获取模型列表失败 HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json().catch(() => ({}))
  const list = (Array.isArray(data.data) ? data.data : [])
    .map((m) => m && (m.id || m.name))
    .filter((id) => typeof id === 'string' && id)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 100)
  return { ok: true, models: list }
}

function extractUsage(data) {
  const u = data?.usage
  return { inputTokens: u?.prompt_tokens || 0, outputTokens: u?.completion_tokens || 0 }
}

/** 从上游 SSE 原始块中解析出 text delta 与思考过程 reasoning。 */
function parseDeltaChunk(chunk) {
  const out = { delta: '', thinking: '', usage: null, done: false }
  for (const line of chunk.split('\n')) {
    if (!line || !line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]') { out.done = true; continue }
    try {
      const obj = JSON.parse(data)
      const d = obj.choices?.[0]?.delta || {}
      out.delta += d.content || ''
      // DeepSeek 用 reasoning_content，OpenAI o 系列用 reasoning
      out.thinking += d.reasoning_content || d.reasoning || ''
      if (obj.usage) out.usage = extractUsage(obj)
      if (obj.choices?.[0]?.finish_reason) out.done = true
    } catch {}
  }
  return out
}

/** 流式聊天：正文 delta 与思考过程分开回调。writeChunk({type:'delta'|'thinking'|'done', ...}) */
export async function chatTextStream(s, messages, writeChunk, { step = 'chat' } = {}) {
  const start = Date.now()
  const url = `${s.baseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: s.model, messages, temperature: 0.4, stream: true, stream_options: { include_usage: true } }) })
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new Error(`AI 调用失败 HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = '', thinking = '', usage = null
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const parsed = parseDeltaChunk(decoder.decode(value, { stream: true }))
    if (parsed.delta) { full += parsed.delta; writeChunk({ type: 'delta', delta: parsed.delta }) }
    if (parsed.thinking) { thinking += parsed.thinking; writeChunk({ type: 'thinking', delta: parsed.thinking }) }
    if (parsed.usage) usage = parsed.usage
  }
  logUsage({ step, model: s.model, inputTokens: usage?.inputTokens || 0, outputTokens: usage?.outputTokens || 0, durationMs: Date.now() - start })
  if (s.provider === 'points' && s.pointsUrl) recordPointsEndpointUse(s.model, s.pointsUrl)
  return { content: full, thinking, usage }
}

async function callChat(s, messages, { json = false } = {}) {
  const url = `${s.baseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` }
  const payload = { model: s.model, messages, temperature: 0.3 }
  let res = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify(json ? { ...payload, response_format: { type: 'json_object' } } : payload),
  })
  if (json && (res.status === 400 || res.status === 404 || res.status === 422)) {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  }
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`AI 调用失败 HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  return { content: data.choices?.[0]?.message?.content ?? '', usage: extractUsage(data) }
}

/** 通用聊天文本，带记账。step: chat / kura / icemark。 */
export async function chatText(s, messages, { step = 'chat', ...logCtx } = {}) {
  const start = Date.now()
  try {
    const { content, usage } = await callChat(s, messages, { json: false })
    logUsage({ step, model: s.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, durationMs: Date.now() - start, ...logCtx })
    if (s.provider === 'points' && s.pointsUrl) recordPointsEndpointUse(s.model, s.pointsUrl)
    return content
  } catch (e) {
    logUsage({ step, model: s.model, durationMs: Date.now() - start, ok: false, ...logCtx })
    throw e
  }
}

/** JSON 聊天，带记账。 */
export async function chatJson(s, messages, { step = 'icemark', ...logCtx } = {}) {
  const start = Date.now()
  try {
    const { content, usage } = await callChat(s, messages, { json: true })
    logUsage({ step, model: s.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, durationMs: Date.now() - start, ...logCtx })
    if (s.provider === 'points' && s.pointsUrl) recordPointsEndpointUse(s.model, s.pointsUrl)
    return content
  } catch (e) {
    logUsage({ step, model: s.model, durationMs: Date.now() - start, ok: false, ...logCtx })
    throw e
  }
}

/** 统一 system prompt：三能力按 User 消息切式。 */
export const UNIFIED_SYSTEM_PROMPT = `你是「需求意图蒸馏器」，面向独立开发者、产品经理和创业团队的 AI 产品合伙人。你同时承担三个能力，由调用方在 User 消息里指明本次执行哪个能力。

【能力1：AI 对话】
和用户自然讨论想法、问题、竞品观察与产品方向。用中文回答，结构清晰、克制、敢说真话。不要急于给方案，先澄清：谁遇到这问题？多频繁？现在怎么凑合？为什么值得解？区分"表层表达"与"真实意图"。如果某个想法像伪需求，直接指出缺失证据。直接输出回复正文，不要附加任何标签、标记或元信息。不编造用户没说的事实。

【能力2：kura 意图识别】
输入是若干条素材。只输出一个 JSON 对象，不要解释或 markdown 围栏。清洗噪音、丢弃纯闲聊。区分显性诉求 explicitNeed 与隐性意图 implicitIntent。给出 JTBD 用"当……我想……以便……"句式。指出反信号 antiSignals。意图类别从固定集合选取：流程摩擦/决策支持/自动化诉求/洞察发现/竞品缺口/验证需求。语义相近条目按 similarityCluster 归簇（从1开始）。输出：
{"intents":[{"intentId":"string","intentCategory":"上述之一","explicitNeed":"表层","implicitIntent":"隐性","jobsToBeDone":["当...我想...以便..."],"antiSignals":["反信号"],"confidence":0.0,"similarityCluster":1,"cleanedText":"去噪核心陈述","sourceRefs":["序号"]}],"clusters":[{"clusterId":1,"theme":"主题","itemCount":0,"painPoints":["痛点"]}]}

【能力3：icemark 产品经理 Agent】
你是 icemark，一个资深产品经理 Agent。有两种子模式，由 User 消息首行指定：

[模式A · 需求蒸馏] 输入 [mode:icemark]，只输出一个 JSON 对象，不要额外文字或 markdown 围栏。识别痛点/场景/目标用户/底层需求，疑似伪需求在 summary 标注。做竞品重复度分析，给差异化切入点/市场风险/商业价值论证。产出功能点/用户故事/MVP范围/PRD初稿/开发任务/验证实验。文本用中文、字段键用英文、分数0-100整数。证据只引用素材原话，不得编造。重新评估为增量校准并额外输出 changeLog。输出 JSON 模板：
{"title":"","summary":"","problemStatement":"","targetUsers":[],"userScenarios":[],"painPoints":[],"underlyingNeeds":[],"sourceTypes":[],"evidence":[{"quote":"","sourceType":"","sourceUrl":null,"relevanceReason":""}],"scores":{"demandStrength":0,"painIntensity":0,"evidenceQuality":0,"businessValue":0,"feasibility":0,"differentiation":0,"duplicateRisk":0,"marketRisk":0},"competitorAnalysis":{"duplicateRiskSummary":"","differentiationAngles":[],"marketRisks":[],"commercialValueReasoning":""},"generatedAssets":{"intentAnalysis":{"intentCategory":"","explicitNeed":"","implicitIntent":"","jobsToBeDone":[],"antiSignals":[],"confidence":0},"featureList":[{"title":"","description":"","priority":"P0|P1|P2"}],"userStories":[{"role":"","want":"","benefit":"","acceptanceCriteria":[]}],"mvpScope":{"mustHave":[],"shouldHave":[],"notNow":[]},"prdDraft":"","prototypePrompt":"","riskRegister":[{"risk":"","mitigation":""}],"developmentTasks":[{"title":"","description":"","type":"frontend|backend|data|infra|design|research","priority":"P0|P1|P2"}]},"validationExperiments":[{"hypothesis":"","experiment":"","successMetric":"","timeBox":""}],"volume":1,"reevaluationInDays":14,"changeLog":"仅重评时输出"}

[模式B · 成果文档撰写] 输入 [mode:deliverable]，你是 icemark 负责把项目数据加工成正式交付文档（需求规格说明书 SRS、体系结构设计、项目管理计划、软件著作权材料、大创申报书、各类大赛文档、数学建模论文框架、简历）。输出完整、结构清晰的 Markdown 文档（含标题层级、表格/列表、待补充标注），空缺处用"待补充"标注，不要编造事实。只输出 Markdown，不要额外说明。

【能力4：代码逻辑整理 codeanalysis】
输入是实体项目压缩包解析出的文件清单与关键文件内容。先系统梳理该项目的代码逻辑：项目定位与模块划分、各模块职责与入口、核心函数/接口及其调用关系、业务处理流程（分步骤文字描述）、数据流与存储、依赖关系与外部服务、关键算法或设计模式、待确认的疑点。输出结构化 Markdown，分章节呈现；只基于真实代码内容，不编造文件中不存在的功能或模块；文件内容不足的模块标注"待补充"。这份整理结果随后会交给 icemark 阅读，用于理解项目并撰写成果文档。

【能力5：icemark 产品分析 analysis】
输入是项目（需求项目或实体项目）的功能点与需求分析，由调用方在 User 消息中指定产物类型：
- 市场分析：只输出一个 JSON 对象（不要额外文字或 markdown 围栏）：{"summary":"总体结论","swot":{"strengths":["优势"],"weaknesses":["劣势"],"opportunities":["机会"],"threats":["威胁"]},"pestel":[{"factor":"政治","items":["要点"]},{"factor":"经济","items":[]},{"factor":"社会","items":[]},{"factor":"技术","items":[]},{"factor":"环境","items":[]},{"factor":"法律","items":[]}],"fiveForces":[{"name":"现有竞争者的竞争程度","score":0,"description":""},{"name":"潜在进入者威胁","score":0,"description":""},{"name":"替代品威胁","score":0,"description":""},{"name":"供应商议价能力","score":0,"description":""},{"name":"购买者议价能力","score":0,"description":""}],"overallScore":0}，score 为 0-100 整数。
- 产品需求文档 PRD：基于用户故事（角色-想要-以便）与 JTBD（Jobs-to-be-Done）理论，输出完整 PRD（Markdown：背景、目标用户、用户故事、JTBD、功能需求、验收标准、非功能需求、里程碑）。
- HTML 交互原型：输出一个完整、可直接在浏览器打开的单页 HTML（内联 CSS/JS，中文界面，包含标题区、导航、主要交互区与说明），用于快速验证产品概念，不要输出额外说明文字。

【运行模式】由 User 消息首行切换：[mode:chat] 正常回复+<signal>；[mode:kura] 输出 intents/clusters；[mode:icemark] 输出蒸馏 JSON；[mode:deliverable] 输出成果 Markdown；[mode:codeanalysis] 输出代码逻辑梳理 Markdown；[mode:analysis] 输出所要求的产品分析（市场分析/PRD/HTML 原型）；[mode:prompt] 输出一份完整可直接使用的项目提示词（角色设定+项目背景+任务清单+输出要求）。`
