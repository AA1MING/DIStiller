import { send } from '../middleware/http.js'
import { getTokenTrackerUsage, getTokenTrackerUsageDaily, getTokenTrackerSessions, getTokenTrackerSessionInsights } from '../services/tokentracker-local.js'

/** TokenTracker 本地采集数据接口。 */
export const handlers = {
  'GET /api/tokentracker/usage': async (req, res) => { const url = new URL(req.url, 'http://localhost'); send(res, 200, await getTokenTrackerUsage(Object.fromEntries(url.searchParams))) },
  'GET /api/tokentracker/usage-daily': async (req, res) => { const url = new URL(req.url, 'http://localhost'); send(res, 200, await getTokenTrackerUsageDaily(Object.fromEntries(url.searchParams))) },
  'GET /api/tokentracker/sessions': async (req, res) => { const url = new URL(req.url, 'http://localhost'); send(res, 200, await getTokenTrackerSessions(Object.fromEntries(url.searchParams))) },
  'GET /api/tokentracker/session-insights': async (req, res) => { const url = new URL(req.url, 'http://localhost'); send(res, 200, await getTokenTrackerSessionInsights(Object.fromEntries(url.searchParams))) },
}
