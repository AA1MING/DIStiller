import { send, readBody } from '../middleware/http.js'
import { usageTrend, usageDaily, usageSummary } from '../services/usage.js'
import { estimateTokens } from '../utils/token-metrics.js'

/** 用量统计 + Token 估算。 */
export const handlers = {
  'GET /api/usage/trend': async (req, res) => { const url = new URL(req.url, 'http://localhost'); send(res, 200, usageTrend(Number(url.searchParams.get('days') || 14))) },
  'GET /api/usage/daily': async (req, res) => { const url = new URL(req.url, 'http://localhost'); send(res, 200, usageDaily(Number(url.searchParams.get('days') || 14))) },
  'GET /api/usage/summary': async (req, res) => { const url = new URL(req.url, 'http://localhost'); send(res, 200, usageSummary(Number(url.searchParams.get('days') || 14))) },
  'POST /api/token/estimate': async (req, res) => { try { const b = await readBody(req); send(res, 200, { tokens: estimateTokens(b.text) }) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
}
