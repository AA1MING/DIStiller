/**
 * TokenTracker 原版仪表盘数据接口适配：/functions/* → 本地采集引擎。
 * 响应格式与原版 local-api.js 一致（无 {available} 包装），
 * 供前端 src/tt/（原版源码抄录重写）直接消费。
 */
import {
  rawSessions,
  rawUsageSummary,
  rawUsageDaily,
  rawUsageHourly,
  rawUsageMonthly,
  rawModelBreakdown,
  rawHeatmap,
  rawSessionInsights,
  forceRescan,
} from './tokentracker-local.js'

function json(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(payload))
}

const SESSION_FIELDS = ['session_id', 'session_hash', 'source', 'model', 'project_key', 'project_ref', 'title', 'started_at', 'ended_at', 'duration_ms', 'total_tokens', 'billable_total_tokens', 'input_tokens', 'output_tokens', 'cost_usd', 'turns', 'edit_turns', 'first_pass', 'resume_command']

export async function handleTtFunctions(req, res, url) {
  const p = url.pathname
  const q = Object.fromEntries(url.searchParams)
  if (p === '/functions/tokentracker-usage-summary') return json(res, await rawUsageSummary(q))
  if (p === '/functions/tokentracker-usage-daily') return json(res, await rawUsageDaily(q))
  if (p === '/functions/tokentracker-usage-model-breakdown') return json(res, await rawModelBreakdown(q))
  if (p === '/functions/tokentracker-usage-heatmap') return json(res, await rawHeatmap(q))
  if (p === '/functions/tokentracker-usage-hourly') return json(res, await rawUsageHourly(q))
  if (p === '/functions/tokentracker-usage-monthly') return json(res, await rawUsageMonthly(q))
  if (p === '/functions/tokentracker-usage-category-breakdown') return json(res, { sources: [] })
  if (p === '/functions/tokentracker-sessions') {
    const out = await rawSessions(q)
    const sessions = out.sessions.map((s) => {
      const row = {}
      for (const k of SESSION_FIELDS) if (s[k] !== undefined) row[k] = s[k]
      return row
    })
    return json(res, { sessions, session_count: out.session_count, returned_count: out.returned_count })
  }
  if (p === '/functions/tokentracker-session-insights') return json(res, await rawSessionInsights(q))
  if (p === '/functions/tokentracker-context-health') return json(res, { overall: null, categories: [] })
  if (p === '/functions/tokentracker-project-usage-summary') return json(res, { projects: [] })
  if (p === '/functions/tokentracker-project-usage-detail') return json(res, { error: 'not_available' })
  if (p === '/functions/tokentracker-user-status') return json(res, { user_id: 'local', email: '', name: 'Local', is_public: false, pro: { active: false, sources: [], expires_at: null, partial: false }, install: { has_active_device_token: false }, as_of: new Date().toISOString() })
  if (p === '/functions/tokentracker-achievements') return json(res, { badges: [] })
  if (p === '/functions/tokentracker-usage-limits') return json(res, { limits: [] })
  if (p === '/functions/tokentracker-outcomes') return json(res, { available: false })
  if (p === '/functions/tokentracker-local-sync') {
    await forceRescan()
    return json(res, { ok: true, synced_at: new Date().toISOString() })
  }
  if (p === '/functions/tokentracker-machine-id') return json(res, { machine_id: 'local-distiller' })
  if (p === '/functions/tokentracker-pets') return json(res, { pets: [] })
  if (p === '/functions/tokentracker-telemetry-pref') return json(res, { enabled: false })
  if (p === '/functions/tokentracker-cloud-sync-pref') return json(res, { enabled: false })
  if (p === '/functions/tokentracker-public-visibility') return json(res, { is_public: false })
  if (p === '/api/health') return json(res, { ok: true, local: true })
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ error: `unsupported: ${p}` }))
}
