/**
 * TokenTracker 本地数据采集：移植 TokenTracker 对 Claude Code / Codex 本地会话日志的
 * 扫描与聚合口径（sessions / usage-summary / usage-daily 三个视图），不依赖 7681 服务。
 * 数据来源：~/.claude/projects/** /<session-id>.jsonl、~/.codex/sessions/** / *.jsonl。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const CACHE_TTL_MS = 30 * 1000
const MAX_FILES = 2000
const MAX_FILE_BYTES = 60 * 1024 * 1024

const home = os.homedir()
// 云部署时通过 TT_DATA_HOME 指向随包携带的 TokenTracker 数据目录（默认本机 ~/.claude、~/.codex）
const dataHome = process.env.TT_DATA_HOME ? path.resolve(process.env.TT_DATA_HOME) : home
const CLAUDE_DIR = path.join(dataHome, '.claude', 'projects')
const CODEX_DIR = path.join(dataHome, '.codex', 'sessions')
// 未知模型按中位价估算，保证成本视图可用。
function priceFor(model) {
  const m = String(model || '').toLowerCase()
  if (m.startsWith('claude-opus-4')) return { input: 15, output: 75 }
  if (m.startsWith('claude-sonnet-4')) return { input: 3, output: 15 }
  if (m.startsWith('claude-haiku-4')) return { input: 1, output: 5 }
  if (m.startsWith('claude-3-7')) return { input: 3, output: 15 }
  if (m.startsWith('claude-3-5')) return { input: 3, output: 15 }
  if (m.startsWith('claude-3-opus')) return { input: 15, output: 75 }
  if (m.startsWith('claude-3-haiku')) return { input: 0.8, output: 4 }
  if (m.startsWith('gpt-5')) return { input: 1.25, output: 10 }
  if (m.startsWith('gpt-4')) return { input: 2.5, output: 10 }
  if (m.startsWith('grok')) return { input: 3, output: 15 }
  return { input: 3, output: 15 }
}

/** 计费口径：缓存写入 1.25x 输入价、缓存读取 0.1x 输入价（与原版一致）。 */
function billableTokens(u) {
  const input = Number(u.input_tokens || 0)
  const output = Number(u.output_tokens || 0)
  const cacheWrite = Number(u.cache_creation_input_tokens || 0)
  const cacheRead = Number(u.cache_read_input_tokens || 0)
  return input + output + cacheWrite * 1.25 + cacheRead * 0.1
}

function totalTokens(u) {
  return Number(u.input_tokens || 0) + Number(u.output_tokens || 0) + Number(u.cache_creation_input_tokens || 0) + Number(u.cache_read_input_tokens || 0)
}

function costUsd(u, model) {
  const p = priceFor(model)
  const input = Number(u.input_tokens || 0) + Number(u.cache_creation_input_tokens || 0) * 1.25 + Number(u.cache_read_input_tokens || 0) * 0.1
  const output = Number(u.output_tokens || 0)
  return (input * p.input + output * p.output) / 1e6
}

/** Claude Code 的目录名编码 → 原始路径（C--Users-Violet → C:/Users/Violet）。 */
function decodeProjectDir(name) {
  let s = String(name)
  const drive = s.match(/^([A-Za-z])--/)
  if (drive) s = `${drive[1]}:/` + s.slice(3)
  return s.replace(/-/g, '/')
}

function safeTitle(content) {
  if (typeof content !== 'string') return ''
  const t = content.trim()
  if (!t) return ''
  const first = t.split('\n')[0].replace(/^```[\w-]*\s*/, '').trim()
  return first.slice(0, 80)
}

/** 递归收集目录下的 jsonl 文件（按 mtime 降序，限量）。 */
async function collectJsonl(root, out = []) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break
    if (e.name === 'memory' || e.name.startsWith('.')) continue
    const full = path.join(root, e.name)
    if (e.isDirectory()) await collectJsonl(full, out)
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        const st = await stat(full)
        out.push({ file: full, mtime: st.mtimeMs, size: st.size })
      } catch {}
    }
  }
  return out
}

/** 解析一个 Claude Code 会话文件。 */
async function parseClaudeSession(file, meta) {
  if (meta.size > MAX_FILE_BYTES) return null
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  const sessionId = path.basename(file, '.jsonl')
  const projectDir = decodeProjectDir(path.basename(path.dirname(file)))
  const s = {
    session_id: sessionId,
    session_hash: sessionId,
    source: 'claude',
    model: null,
    project_key: projectDir.split('/').pop() || projectDir,
    project_ref: projectDir,
    title: '',
    started_at: null,
    ended_at: null,
    duration_ms: 0,
    total_tokens: 0,
    billable_total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    turns: 0,
    edit_turns: 0,
    first_pass: false,
    resume_command: `claude --resume ${sessionId}`,
  }
  const lines = text.split('\n')
  let first = null
  let last = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object') continue
    if (o.timestamp) {
      const ts = String(o.timestamp)
      if (!first || ts < first) first = ts
      if (!last || ts > last) last = ts
    }
    if (o.type === 'user') {
      s.turns += 1
      if (!s.title) {
        const c = o.message?.content
        const t = typeof c === 'string' ? safeTitle(c) : Array.isArray(c) ? safeTitle(c.map((b) => b?.text || '').join(' ')) : ''
        if (t) s.title = t
      }
      continue
    }
    if (o.type !== 'assistant') continue
    const msg = o.message || {}
    const u = msg.usage
    if (u && typeof u === 'object') {
      s.input_tokens += Number(u.input_tokens || 0)
      s.output_tokens += Number(u.output_tokens || 0)
      s.cached_input_tokens = (s.cached_input_tokens || 0) + Number(u.cache_read_input_tokens || 0)
      s.cache_creation_input_tokens = (s.cache_creation_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0)
      s.total_tokens += totalTokens(u)
      s.billable_total_tokens += billableTokens(u)
      s.cost_usd += costUsd(u, msg.model)
    }
    if (msg.model && !s.model) s.model = msg.model
    if (!s.model && o.model) s.model = o.model
    const content = msg.content
    if (Array.isArray(content)) {
      const tools = content.filter((b) => b?.type === 'tool_use').length
      s.edit_turns += tools
    }
  }
  if (!s.turns) return null
  s.started_at = first
  s.ended_at = last
  if (first && last) {
    const d = Date.parse(last) - Date.parse(first)
    if (Number.isFinite(d) && d > 0) s.duration_ms = d
  }
  return s
}

/** 解析一个 Codex 会话文件（rollout jsonl，usage 缺失时仅记录时间与模型）。 */
async function parseCodexSession(file, meta) {
  if (meta.size > MAX_FILE_BYTES) return null
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  const sessionId = path.basename(file, '.jsonl')
  const s = {
    session_id: sessionId,
    session_hash: sessionId,
    source: 'codex',
    model: null,
    project_key: '',
    project_ref: '',
    title: '',
    started_at: null,
    ended_at: null,
    duration_ms: 0,
    total_tokens: 0,
    billable_total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    cost_usd: 0,
    turns: 0,
    edit_turns: 0,
    first_pass: false,
    resume_command: `codex resume ${sessionId}`,
  }
  let first = null
  let last = null
  // Codex session usage is carried by event_msg type=token_count. total_token_usage
  // is the session-cumulative value, so the last event equals the whole session.
  let tokenUsage = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!s.model) {
      const mm = line.match(/"model"\s*:\s*"([^"]+)"/)
      if (mm && mm[1] && !mm[1].startsWith('_')) s.model = mm[1]
    }
    const ts = o?.timestamp
    if (ts) {
      if (!first || ts < first) first = ts
      if (!last || ts > last) last = ts
    }
    if (o?.type === 'response_item') {
      const p = o.payload || {}
      if (p.type === 'message' && p.role === 'user') {
        s.turns += 1
        if (!s.title) {
          const c = p.content
          const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b?.text || '').join(' ') : ''
          if (t) {
            // strip the injected environment context (allow a missing closing
            // tag), then any leftover tags; only accept a real prompt as title.
            const qm = t.match(/<user_query>([\s\S]*?)<\/user_query>/)
            const cleaned = (qm ? qm[1] : t.replace(/<environment_context>[\s\S]*?(<\/environment_context>)?[\s\S]*/, ''))
              .replace(/<[^>]+>/g, '')
              .trim()
            if (cleaned) s.title = cleaned.slice(0, 80)
          }
        }
      }
      if (p.type === 'message' && p.role === 'assistant' && p.model && !s.model) s.model = p.model
      if (p.type === 'function_call') s.edit_turns += 1
    }
    // token_count event: keep the latest cumulative total for the session
    if (o?.type === 'event_msg' && o?.payload?.type === 'token_count') {
      const info = o.payload.info || {}
      tokenUsage = info.total_token_usage || info.last_token_usage || tokenUsage
    }
    // user turns can also arrive as event_msg type=user_message
    if (o?.type === 'event_msg' && o?.payload?.type === 'user_message') {
      s.turns += 1
      if (!s.title) {
        const arr = Array.isArray(o.payload.text_elements) ? o.payload.text_elements.map((b) => b?.text || '').join(' ') : ''
        const t = String(arr || o.payload.message || '').trim()
        const cleaned = t.replace(/<environment_context>[\s\S]*?(<\/environment_context>)?[\s\S]*/, '').replace(/<[^>]+>/g, '').trim()
        if (cleaned) s.title = cleaned.slice(0, 80)
      }
    }
  }
  if (tokenUsage && typeof tokenUsage === 'object') {
    const totalInput = Number(tokenUsage.input_tokens || 0)
    const cachedRead = Number(tokenUsage.cached_input_tokens || 0)
    const cacheWrite = Number(tokenUsage.cache_write_input_tokens || 0)
    const output = Number(tokenUsage.output_tokens || 0)
    const reasoning = Number(tokenUsage.reasoning_output_tokens || 0)
    // Codex input_tokens already includes cached tokens; split them out so
    // billing math does not double-count.
    const plainInput = Math.max(0, totalInput - cachedRead - cacheWrite)
    s.input_tokens = plainInput
    s.output_tokens = output
    s.cached_input_tokens = cachedRead
    s.cache_creation_input_tokens = cacheWrite
    s.reasoning_output_tokens = reasoning
    s.total_tokens = Number(tokenUsage.total_tokens) || (totalInput + output)
    const u = {
      input_tokens: plainInput,
      output_tokens: output,
      cache_read_input_tokens: cachedRead,
      cache_creation_input_tokens: cacheWrite,
    }
    s.billable_total_tokens = billableTokens(u)
    s.cost_usd = costUsd(u, s.model)
  }
  if (!s.turns && !s.total_tokens) return null
  s.started_at = first
  s.ended_at = last
  if (first && last) {
    const d = Date.parse(last) - Date.parse(first)
    if (Number.isFinite(d) && d > 0) s.duration_ms = d
  }
  return s
}
// --- 缓存 ---
let cache = { at: 0, sessions: [] }

async function scanAll() {
  const files = []
  await collectJsonl(CLAUDE_DIR, files)
  await collectJsonl(CODEX_DIR, files)
  files.sort((a, b) => b.mtime - a.mtime)
  const sessions = []
  for (const f of files.slice(0, MAX_FILES)) {
    const s = f.file.includes(path.join('.claude', 'projects'))
      ? await parseClaudeSession(f.file, f)
      : await parseCodexSession(f.file, f)
    if (s) sessions.push(s)
  }
  sessions.sort((a, b) => String(b.ended_at || b.started_at || '').localeCompare(String(a.ended_at || a.started_at || '')))
  return sessions
}

async function ensureScan(force = false) {
  const now = Date.now()
  if (!force && cache.sessions.length && now - cache.at < CACHE_TTL_MS) return cache.sessions
  cache.sessions = await scanAll()
  cache.at = now
  return cache.sessions
}

const dayKey = (iso) => String(iso || '').slice(0, 10)

function inLastDays(iso, days) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  const start = new Date()
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return t >= start.getTime()
}

function totalsOf(list) {
  const totals = {
    total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0,
    cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    total_cost_usd: 0, conversation_count: list.length,
  }
  for (const s of list) {
    totals.total_tokens += s.total_tokens
    totals.billable_total_tokens += s.billable_total_tokens
    totals.input_tokens += s.input_tokens
    totals.output_tokens += s.output_tokens
    totals.cached_input_tokens += s.cached_input_tokens || 0
    totals.cache_creation_input_tokens += s.cache_creation_input_tokens || 0
    totals.total_cost_usd += s.cost_usd
  }
  return totals
}

/** 对应原版 /functions/tokentracker-usage-summary */
export async function getTokenTrackerUsage(params = {}) {
  try {
    const sessions = await ensureScan(Boolean(params.refresh))
    const totals = totalsOf(sessions)
    const d7 = sessions.filter((s) => inLastDays(s.ended_at || s.started_at, 7))
    const d30 = sessions.filter((s) => inLastDays(s.ended_at || s.started_at, 30))
    const activeDays = new Set(d30.map((s) => dayKey(s.ended_at || s.started_at))).size
    return {
      available: true,
      totals,
      rolling: {
        last_7d: { totals: totalsOf(d7) },
        last_30d: { totals: totalsOf(d30), active_days: activeDays },
      },
    }
  } catch (e) {
    return { available: false, error: `本地采集失败: ${e.message}` }
  }
}

/** 对应原版 /functions/tokentracker-usage-daily */
export async function getTokenTrackerUsageDaily(params = {}) {
  try {
    const sessions = await ensureScan(Boolean(params.refresh))
    const byDay = new Map()
    for (const s of sessions) {
      const day = dayKey(s.ended_at || s.started_at)
      if (!day || day === '') continue
      let row = byDay.get(day)
      if (!row) {
        row = { day, total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, total_cost_usd: 0 }
        byDay.set(day, row)
      }
      row.total_tokens += s.total_tokens
      row.billable_total_tokens += s.billable_total_tokens
      row.input_tokens += s.input_tokens
      row.output_tokens += s.output_tokens
      row.total_cost_usd += s.cost_usd
    }
    const data = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
    return { available: true, data }
  } catch (e) {
    return { available: false, error: `本地采集失败: ${e.message}` }
  }
}

/** 对应原版 /functions/tokentracker-sessions */
export async function getTokenTrackerSessions(params = {}) {
  try {
    const sessions = await ensureScan(Boolean(params.refresh))
    const sessionsOut = sessions.map(({ cache_creation_input_tokens, cached_input_tokens, ...rest }) => rest)
    return { available: true, sessions: sessionsOut, session_count: sessions.length, returned_count: sessions.length }
  } catch (e) {
    return { available: false, error: `本地采集失败: ${e.message}` }
  }
}

/** 会话洞察：来源与模型分布。 */
export async function getTokenTrackerSessionInsights(params = {}) {
  try {
    const sessions = await ensureScan(Boolean(params.refresh))
    const sources = {}
    const models = {}
    for (const s of sessions) {
      const src = s.source || 'unknown'
      const mdl = s.model || 'unknown'
      sources[src] = sources[src] || { source: src, tokens: 0, sessions: 0 }
      sources[src].tokens += s.billable_total_tokens
      sources[src].sessions += 1
      models[mdl] = models[mdl] || { model: mdl, tokens: 0, sessions: 0 }
      models[mdl].tokens += s.billable_total_tokens
      models[mdl].sessions += 1
    }
    return { available: true, sources: Object.values(sources).sort((a, b) => b.tokens - a.tokens), models: Object.values(models).sort((a, b) => b.tokens - a.tokens) }
  } catch (e) {
    return { available: false, error: `本地采集失败: ${e.message}` }
  }
}

// ===== 原版仪表盘接口（/functions/*，无 {available} 包装，格式与 local-api.js 一致） =====

function isoDate(ts) {
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toISOString().slice(0, 10)
}

function inRange(s, from, to) {
  const d = isoDate(s.ended_at || s.started_at)
  if (!d) return true
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

function zeroTotals() {
  return { total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 }
}

function sumSessions(list) {
  const totals = zeroTotals()
  for (const s of list) {
    totals.total_tokens += s.total_tokens
    totals.billable_total_tokens += s.billable_total_tokens
    totals.total_cost_usd += s.cost_usd
    totals.input_tokens += s.input_tokens
    totals.output_tokens += s.output_tokens
    totals.cached_input_tokens += s.cached_input_tokens || 0
    totals.cache_creation_input_tokens += s.cache_creation_input_tokens || 0
    totals.conversation_count += 1
  }
  return totals
}

const shiftDay = (dayStr, delta) => {
  const d = new Date(`${dayStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function collectDays(allDaily, todayStr, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const ds = shiftDay(todayStr, -i)
    const dd = allDaily.find((x) => x.day === ds)
    if (dd) out.push(dd)
  }
  return out
}

/** 会话明细（原版 schema）。 */
export async function rawSessions(params = {}) {
  const sessions = await ensureScan(Boolean(params.refresh))
  const from = String(params.from || '')
  const to = String(params.to || '')
  const list = sessions.filter((s) => inRange(s, from, to)).map(({ cache_creation_input_tokens, cached_input_tokens, ...rest }) => rest)
  return { sessions: list, session_count: list.length, returned_count: list.length }
}

/** 用量汇总（原版 schema：totals/rolling/days/scope）。 */
export async function rawUsageSummary(params = {}) {
  const from = String(params.from || '')
  const to = String(params.to || '')
  const sessions = (await ensureScan(Boolean(params.refresh))).filter((s) => inRange(s, from, to))
  const totals = sumSessions(sessions)
  const todayStr = new Date().toISOString().slice(0, 10)
  // 先按天聚合（与 rawUsageDaily 同口径），滚动窗口基于每日行计算；
  // 直接对会话对象调用 collectDays 会因缺少 day 字段而恒为空。
  const byDay = new Map()
  for (const s of sessions) {
    const day = isoDate(s.ended_at || s.started_at)
    if (!day) continue
    let row = byDay.get(day)
    if (!row) {
      row = { day, total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 }
      byDay.set(day, row)
    }
    row.total_tokens += s.total_tokens
    row.billable_total_tokens += s.billable_total_tokens
    row.total_cost_usd += s.cost_usd
    row.input_tokens += s.input_tokens
    row.output_tokens += s.output_tokens
    row.cached_input_tokens += s.cached_input_tokens || 0
    row.cache_creation_input_tokens += s.cache_creation_input_tokens || 0
    row.conversation_count += 1
  }
  const daily = [...byDay.values()]
  const l7 = collectDays(daily, todayStr, 7)
  const l30 = collectDays(daily, todayStr, 30)
  const sumDays = (days) => days.reduce((a, r) => {
  a.total_tokens += r.total_tokens
  a.billable_total_tokens += r.billable_total_tokens
  a.total_cost_usd += r.total_cost_usd
  a.input_tokens += r.input_tokens
  a.output_tokens += r.output_tokens
  a.cached_input_tokens += r.cached_input_tokens || 0
  a.cache_creation_input_tokens += r.cache_creation_input_tokens || 0
  a.reasoning_output_tokens += r.reasoning_output_tokens || 0
  a.conversation_count += r.conversation_count
  return a
}, { total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 })
  const l7t = sumDays(l7)
  const l30t = sumDays(l30)
  const l7Active = l7.filter((r) => Number(r.billable_total_tokens) > 0).length
  const l30Active = l30.filter((r) => Number(r.billable_total_tokens) > 0).length
  return {
    from, to, days: sessions.length, scope: 'local', excluded_sources: [],
    totals: { ...totals, total_cost_usd: totals.total_cost_usd.toFixed(6) },
    rolling: {
      last_7d: { from: shiftDay(todayStr, -6), to: todayStr, active_days: l7Active, totals: l7t },
      last_30d: { from: shiftDay(todayStr, -29), to: todayStr, active_days: l30Active, totals: l30t, avg_per_active_day: l30Active > 0 ? Math.round(l30t.billable_total_tokens / l30Active) : 0 },
    },
  }
}

/** 按天汇总（原版 schema）。 */
export async function rawUsageDaily(params = {}) {
  const from = String(params.from || '')
  const to = String(params.to || '')
  const sessions = (await ensureScan(Boolean(params.refresh))).filter((s) => inRange(s, from, to))
  const byDay = new Map()
  for (const s of sessions) {
    const day = isoDate(s.ended_at || s.started_at)
    if (!day) continue
    let row = byDay.get(day)
    if (!row) {
      row = { day, total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 }
      byDay.set(day, row)
    }
    row.total_tokens += s.total_tokens
    row.billable_total_tokens += s.billable_total_tokens
    row.total_cost_usd += s.cost_usd
    row.input_tokens += s.input_tokens
    row.output_tokens += s.output_tokens
    row.cached_input_tokens += s.cached_input_tokens || 0
    row.cache_creation_input_tokens += s.cache_creation_input_tokens || 0
    row.conversation_count += 1
  }
  const data = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  return { from, to, scope: 'local', excluded_sources: [], data }
}

// ---- 时区工具（与 rawUsageDaily 的 UTC 口径不同：hourly/monthly 按请求的
//      tz / tz_offset_minutes 归桶，前端 fillHourlyGaps / markMonthlyFuture 同口径） ----

function timeZoneContext(params = {}) {
  const tz = String(params.tz || '').trim()
  const rawOffset = Number(params.tz_offset_minutes)
  return {
    timeZone: tz || null,
    offsetMinutes: Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : null,
  }
}

function zonedParts(date, { timeZone, offsetMinutes } = {}) {
  const dt = date instanceof Date ? date : new Date(date)
  if (!Number.isFinite(dt.getTime())) return null
  if (timeZone && typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
      const parts = formatter.formatToParts(dt)
      const values = parts.reduce((acc, part) => {
        if (part.type && part.value) acc[part.type] = part.value
        return acc
      }, {})
      const year = Number(values.year)
      const month = Number(values.month)
      const day = Number(values.day)
      const hour = Number(values.hour)
      const minute = Number(values.minute)
      const second = Number(values.second)
      if ([year, month, day, hour, minute, second].every(Number.isFinite)) {
        return { year, month, day, hour, minute, second }
      }
    } catch {
      // 无效时区名 → 落到固定偏移 / 本地时间
    }
  }
  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(dt.getTime() + offsetMinutes * 60 * 1000)
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    }
  }
  return {
    year: dt.getFullYear(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
    hour: dt.getHours(),
    minute: dt.getMinutes(),
    second: dt.getSeconds(),
  }
}

function partsDayKey(parts) {
  if (!parts) return ''
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/** 以 months 为窗口、以 to 为终点推算起始月（YYYY-MM）。 */
function shiftMonth(monthStr, delta) {
  const m = String(monthStr).match(/^(\d{4})-(\d{2})$/)
  if (!m) return ''
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** 按小时汇总（原版 schema，供日视图）。 */
export async function rawUsageHourly(params = {}) {
  const tzCtx = timeZoneContext(params)
  const nowParts = zonedParts(new Date(), tzCtx)
  const day = String(params.day || (nowParts ? partsDayKey(nowParts) : new Date().toISOString().slice(0, 10)))
  const sessions = await ensureScan(Boolean(params.refresh))
  const byHour = new Map()
  for (const s of sessions) {
    const ts = s.ended_at || s.started_at
    if (!ts) continue
    const parts = zonedParts(new Date(ts), tzCtx)
    if (!parts || partsDayKey(parts) !== day) continue
    const hourKey = `${day}T${String(parts.hour).padStart(2, '0')}:00:00`
    let bucket = byHour.get(hourKey)
    if (!bucket) {
      bucket = {
        hour: hourKey,
        total_tokens: 0,
        billable_total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
        models: {},
      }
      byHour.set(hourKey, bucket)
    }
    bucket.total_tokens += s.total_tokens || 0
    bucket.billable_total_tokens += s.billable_total_tokens ?? s.total_tokens ?? 0
    bucket.input_tokens += s.input_tokens || 0
    bucket.output_tokens += s.output_tokens || 0
    bucket.cached_input_tokens += s.cached_input_tokens || 0
    bucket.cache_creation_input_tokens += s.cache_creation_input_tokens || 0
    bucket.reasoning_output_tokens += s.reasoning_output_tokens || 0
    bucket.conversation_count += 1
    const model = s.model || 'unknown'
    bucket.models[model] = (bucket.models[model] || 0) + (s.total_tokens || 0)
  }
  const data = [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour))
  return { day, scope: 'local', excluded_sources: [], data }
}

/** 按月汇总（原版 schema，供总视图）。 */
export async function rawUsageMonthly(params = {}) {
  const tzCtx = timeZoneContext(params)
  let from = String(params.from || '').trim()
  const to = String(params.to || '').trim()
  const months = Number(params.months) || 0
  if (!from && months > 0 && to) {
    from = shiftMonth(to.slice(0, 7), -(months - 1))
  }
  const sessions = await ensureScan(Boolean(params.refresh))
  const byMonth = new Map()
  for (const s of sessions) {
    const ts = s.ended_at || s.started_at
    if (!ts) continue
    const parts = zonedParts(new Date(ts), tzCtx)
    const day = partsDayKey(parts)
    if (!day) continue
    if (from && day < from) continue
    if (to && day > to) continue
    const month = day.slice(0, 7)
    let bucket = byMonth.get(month)
    if (!bucket) {
      bucket = {
        month,
        total_tokens: 0,
        billable_total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
        models: {},
      }
      byMonth.set(month, bucket)
    }
    bucket.total_tokens += s.total_tokens || 0
    bucket.billable_total_tokens += s.billable_total_tokens ?? s.total_tokens ?? 0
    bucket.input_tokens += s.input_tokens || 0
    bucket.output_tokens += s.output_tokens || 0
    bucket.cached_input_tokens += s.cached_input_tokens || 0
    bucket.cache_creation_input_tokens += s.cache_creation_input_tokens || 0
    bucket.reasoning_output_tokens += s.reasoning_output_tokens || 0
    bucket.conversation_count += 1
    const model = s.model || 'unknown'
    bucket.models[model] = (bucket.models[model] || 0) + (s.total_tokens || 0)
  }
  const data = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  return { from, to, scope: 'local', excluded_sources: [], data }
}

/** 模型分布（原版 schema）。 */
export async function rawModelBreakdown(params = {}) {
  const from = String(params.from || '')
  const to = String(params.to || '')
  const sessions = (await ensureScan(Boolean(params.refresh))).filter((s) => inRange(s, from, to))
  const bySource = new Map()
  for (const s of sessions) {
    const src = s.source || 'unknown'
    const mdl = s.model || 'unknown'
    if (!bySource.has(src)) {
      bySource.set(src, { source: src, source_scope: src, totals: zeroTotals(), models: new Map() })
    }
    const sa = bySource.get(src)
    sa.totals.total_tokens += s.total_tokens
    sa.totals.billable_total_tokens += s.billable_total_tokens
    sa.totals.input_tokens += s.input_tokens
    sa.totals.output_tokens += s.output_tokens
    sa.totals.cached_input_tokens += s.cached_input_tokens || 0
    sa.totals.cache_creation_input_tokens += s.cache_creation_input_tokens || 0
    sa.totals.total_cost_usd += s.cost_usd
    sa.totals.conversation_count += 1
    if (!sa.models.has(mdl)) {
      sa.models.set(mdl, { model: mdl, model_id: mdl, totals: zeroTotals() })
    }
    const ma = sa.models.get(mdl)
    ma.totals.total_tokens += s.total_tokens
    ma.totals.billable_total_tokens += s.billable_total_tokens
    ma.totals.input_tokens += s.input_tokens
    ma.totals.output_tokens += s.output_tokens
    ma.totals.cached_input_tokens += s.cached_input_tokens || 0
    ma.totals.cache_creation_input_tokens += s.cache_creation_input_tokens || 0
    ma.totals.total_cost_usd += s.cost_usd
    ma.totals.conversation_count += 1
  }
  const sources = Array.from(bySource.values()).map((s) => ({
    source: s.source,
    source_scope: s.source,
    totals: { ...s.totals, total_cost_usd: s.totals.total_cost_usd.toFixed(6) },
    models: Array.from(s.models.values())
      .map((m) => ({ model: m.model, model_id: m.model, totals: { ...m.totals, total_cost_usd: m.totals.total_cost_usd.toFixed(6) } }))
      .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens),
  }))
  return {
    from, to, days: 0, scope: 'local', excluded_sources: [], sources,
    pricing: { model: 'per-model', pricing_mode: 'per_token_type', source: 'litellm', effective_from: new Date().toISOString().slice(0, 10) },
  }
}

/** 活跃热力图（原版 schema：weeks/active_days/streak_days）。 */
export async function rawHeatmap(params = {}) {
  const daily = (await rawUsageDaily(params)).data
  // 周数默认 52（与前端 use-activity-heatmap 的 weeks=52 一致），支持任意周数。
  const weekCount = Math.max(1, Math.min(104, Number(params.weeks) || 52))
  // 网格按请求的周起始日对齐；cells 为扁平数组（前端 buildActivityHeatmap
  // 期望 weeks 是"数组的数组"，每个 cell 含 day/level/value，而非 { cells: [] } 对象）。
  const weekStartsOn = params.week_starts_on === 'mon' ? 'mon' : 'sun'
  const desiredDow = weekStartsOn === 'mon' ? 1 : 0
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const dow = (today.getUTCDay() - desiredDow + 7) % 7
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - dow - (weekCount - 1) * 7)
  const byDay = new Map(daily.map((r) => [r.day, r]))
  const weeks = []
  for (let w = 0; w < weekCount; w++) {
    const cells = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setUTCDate(start.getUTCDate() + w * 7 + d)
      const key = date.toISOString().slice(0, 10)
      const row = byDay.get(key)
      cells.push({ day: key, billable_total_tokens: Number(row?.billable_total_tokens || 0), total_tokens: Number(row?.total_tokens || 0), models: row ? [row] : [] })
    }
    weeks.push(cells)
  }
  const active = daily.filter((r) => Number(r.billable_total_tokens) > 0)
  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10), week_starts_on: weekStartsOn, weeks, active_days: active.length, streak_days: 0, data: daily }
}

/** 会话洞察（原版 schema：sources/models 含 totals）。 */
export async function rawSessionInsights(params = {}) {
  const sessions = await ensureScan(Boolean(params.refresh))
  const sources = {}
  const models = {}
  for (const s of sessions) {
    const src = s.source || 'unknown'
    const mdl = s.model || 'unknown'
    if (!sources[src]) sources[src] = { source: src, totals: { total_tokens: 0, billable_total_tokens: 0, cost_usd: 0 }, sessions: 0 }
    sources[src].totals.total_tokens += s.total_tokens
    sources[src].totals.billable_total_tokens += s.billable_total_tokens
    sources[src].totals.cost_usd += s.cost_usd
    sources[src].sessions += 1
    if (!models[mdl]) models[mdl] = { model: mdl, totals: { total_tokens: 0, billable_total_tokens: 0, cost_usd: 0 }, sessions: 0 }
    models[mdl].totals.total_tokens += s.total_tokens
    models[mdl].totals.billable_total_tokens += s.billable_total_tokens
    models[mdl].totals.cost_usd += s.cost_usd
    models[mdl].sessions += 1
  }
  return {
    generated_at: new Date().toISOString(),
    sources: Object.values(sources).sort((a, b) => b.totals.billable_total_tokens - a.totals.billable_total_tokens),
    models: Object.values(models).sort((a, b) => b.totals.billable_total_tokens - a.totals.billable_total_tokens),
  }
}

/** 强制重扫本地会话日志。 */
export async function forceRescan() {
  await ensureScan(true)
  return { ok: true }
}

