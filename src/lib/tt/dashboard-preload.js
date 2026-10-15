// 精简版：原版多页面预加载（limits/leaderboard 页面路由）已随移植移除，
// 仅保留 use-usage-limits / DashboardPage 需要的 usage-limits 预加载缓存。
let limitsCache = null;

function cloneEntry(entry) {
  if (!entry) return null;
  try {
    return JSON.parse(JSON.stringify(entry));
  } catch {
    return entry;
  }
}

export function publishUsageLimitsPreloadState(data, options = {}) {
  limitsCache = {
    targetKey: "limits",
    contextKey: options.contextKey || getUsageLimitsPreloadContextKey(options.context || {}),
    source: options.source || "dashboard-existing",
    status: options.status || "fulfilled",
    error: options.error || null,
    generatedAt: options.generatedAt || new Date().toISOString(),
    data: cloneEntry(data),
  };
  return cloneEntry(limitsCache);
}

export function getUsageLimitsPreloadContextKey() {
  return "limits";
}

export function readUsageLimitsPreloadState() {
  return cloneEntry(limitsCache);
}

// 以下导出原版存在但本项目不再使用，保留空实现避免引用方报错
export function markDashboardMainContentVisible() {}
export function preloadDashboardPageResources() {}
export function getLeaderboardPreloadContextKey() {
  return "leaderboard";
}
export function preloadLeaderboardDefaultState() {}
export function publishLeaderboardPreloadState() {}
export function readLeaderboardPreloadState() {
  return null;
}
export function readReusablePageState() {
  return null;
}
export function resetDashboardPreload() {
  limitsCache = null;
}
export const DASHBOARD_PRELOAD_TARGETS = Object.freeze(["limits"]);
