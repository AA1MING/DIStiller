import { db } from '../dao/db.js'
import { computeRowCost } from '../utils/token-metrics.js'

function roundMoney(n) {
  return Math.round(Number(n || 0) * 1e6) / 1e6
}

/** ???? AI ???K1=B??????? */
export function logUsage({ step, model, inputTokens = 0, outputTokens = 0, durationMs = 0, ok = true, rawItemId = null, opportunityId = null }) {
  db.prepare(
    `INSERT INTO ai_usage_log (step, model, input_tokens, output_tokens, duration_ms, ok, raw_item_id, opportunity_id)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(step, model || 'unknown', Number(inputTokens) || 0, Number(outputTokens) || 0, Number(durationMs) || 0, ok ? 1 : 0, rawItemId, opportunityId)
}

function mergeByKey(rows, keyOf, init) {
  const map = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (!map.has(key)) map.set(key, init(row))
    const out = map.get(key)
    out.calls += Number(row.calls || 0)
    out.input_tokens += Number(row.input_tokens || 0)
    out.output_tokens += Number(row.output_tokens || 0)
    if ('duration_ms' in out) out.duration_ms += Number(row.duration_ms || 0)
    if ('seconds' in out) out.seconds += Number(row.seconds || 0)
    out.ok_calls += Number(row.ok_calls || 0)
    out.cost_usd += computeRowCost(row)
  }
  return [...map.values()]
}

/** ? step ???? N ???? */
export function usageTrend(daysParam = 14) {
  const range = `-${Number(daysParam) || 14} days`
  const dayRows = db
    .prepare(
      `SELECT step, DATE(created_at) AS day, model,
              COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(duration_ms) AS duration_ms,
              SUM(ok) AS ok_calls
       FROM ai_usage_log
       WHERE created_at >= datetime('now', ?)
       GROUP BY step, day, model
       ORDER BY day DESC, step`
    )
    .all(range)
  const days = mergeByKey(
    dayRows,
    (r) => `${r.step}\0${r.day}`,
    (r) => ({ step: r.step, day: r.day, calls: 0, input_tokens: 0, output_tokens: 0, duration_ms: 0, ok_calls: 0, cost_usd: 0 })
  )

  const totalRows = db
    .prepare(
      `SELECT step, model, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(duration_ms) AS duration_ms, SUM(ok) AS ok_calls
       FROM ai_usage_log GROUP BY step, model`
    )
    .all()
  const totals = mergeByKey(
    totalRows,
    (r) => r.step,
    (r) => ({ step: r.step, calls: 0, input_tokens: 0, output_tokens: 0, duration_ms: 0, ok_calls: 0, cost_usd: 0 })
  ).map((t) => ({ step: t.step, calls: t.calls, input_tokens: t.input_tokens, output_tokens: t.output_tokens, avg_ms: t.calls ? Math.round(t.duration_ms / t.calls) : 0, ok_calls: t.ok_calls, cost_usd: t.cost_usd }))

  for (const d of days) d.cost_usd = roundMoney(d.cost_usd)
  for (const t of totals) t.cost_usd = roundMoney(t.cost_usd)
  return { days, totals }
}

/** ???????????step ???? */
export function usageDaily(days = 14) {
  const rows = db
    .prepare(
      `SELECT DATE(created_at) AS day, step, model,
              COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              ROUND(SUM(duration_ms) / 1000.0, 1) AS seconds,
              SUM(ok) AS ok_calls
       FROM ai_usage_log
       WHERE created_at >= datetime('now', ?)
       GROUP BY day, step, model
       ORDER BY day DESC, step`
    )
    .all(`-${Number(days) || 14} days`)
  const merged = mergeByKey(
    rows,
    (r) => `${r.day}\0${r.step}`,
    (r) => ({ day: r.day, step: r.step, calls: 0, input_tokens: 0, output_tokens: 0, seconds: 0, ok_calls: 0, cost_usd: 0 })
  )
  for (const d of merged) d.cost_usd = roundMoney(d.cost_usd)
  return merged
}

/** TokenTracker ??????????????????? */
export function usageSummary(days = 14) {
  const safeDays = Math.max(1, Number(days) || 14)
  const rows = db
    .prepare(
      `SELECT DATE(created_at) AS day, step, model,
              COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(ok) AS ok_calls
       FROM ai_usage_log
       WHERE created_at >= datetime('now', ?)
       GROUP BY day, step, model
       ORDER BY day DESC, step`
    )
    .all(`-${safeDays} days`)

  const byDay = mergeByKey(
    rows,
    (r) => r.day,
    (r) => ({ day: r.day, calls: 0, input_tokens: 0, output_tokens: 0, ok_calls: 0, cost_usd: 0 })
  )
  const byStep = mergeByKey(
    rows,
    (r) => r.step,
    (r) => ({ step: r.step, calls: 0, input_tokens: 0, output_tokens: 0, ok_calls: 0, cost_usd: 0 })
  )

  const total = { calls: 0, input_tokens: 0, output_tokens: 0, ok_calls: 0, cost_usd: 0 }
  for (const row of rows) {
    total.calls += Number(row.calls || 0)
    total.input_tokens += Number(row.input_tokens || 0)
    total.output_tokens += Number(row.output_tokens || 0)
    total.ok_calls += Number(row.ok_calls || 0)
    total.cost_usd += computeRowCost(row)
  }
  for (const list of [byDay, byStep]) for (const item of list) item.cost_usd = roundMoney(item.cost_usd)
  total.cost_usd = roundMoney(total.cost_usd)
  return { days: safeDays, totalCostUsd: total.cost_usd, totalInputTokens: total.input_tokens, totalOutputTokens: total.output_tokens, totalCalls: total.calls, okCalls: total.ok_calls, byDay, byStep }
}
