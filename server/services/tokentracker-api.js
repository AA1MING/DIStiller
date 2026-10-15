const TOKENTRACKER_BASE = `http://127.0.0.1:${process.env.TOKENTRACKER_PORT || 7681}`
const REQUEST_TIMEOUT_MS = 6000

function unavailable(error = 'TokenTracker 服务未运行') {
  return { available: false, error }
}

async function fetchTokenTracker(pathname, params = {}) {
  const url = new URL(pathname, TOKENTRACKER_BASE)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return unavailable(`TokenTracker 返回 ${res.status}`)
    const data = await res.json()
    return { available: true, ...data }
  } catch (e) {
    return unavailable(e?.name === 'AbortError' ? 'TokenTracker 请求超时' : 'TokenTracker 服务未运行')
  } finally {
    clearTimeout(timer)
  }
}

export function getTokenTrackerUsage(params = {}) {
  return fetchTokenTracker('/functions/tokentracker-usage-summary', params)
}

export function getTokenTrackerUsageDaily(params = {}) {
  return fetchTokenTracker('/functions/tokentracker-usage-daily', params)
}

export function getTokenTrackerSessions(params = {}) {
  return fetchTokenTracker('/functions/tokentracker-sessions', params)
}

export function getTokenTrackerSessionInsights(params = {}) {
  return fetchTokenTracker('/functions/tokentracker-session-insights', params)
}
