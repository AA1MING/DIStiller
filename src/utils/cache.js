// ===== 页面数据缓存：登录后预取全部功能页数据；点开菜单时直接渲染缓存，
// 后台静默刷新，不再出现「先显示没有/暂无，数据后才出来」的空窗 =====
const pageDataCache = new Map()
const pageDataPending = new Map()
export const pageDataAt = new Map()
export const PAGE_DATA_TTL = 60 * 1000

export const cachedGet = (key) => pageDataCache.get(key)
export const cachedSet = (key, value) => { pageDataCache.set(key, value); pageDataAt.set(key, Date.now()) }
export function cachedFetch(key, loader, { force = false, ttl = PAGE_DATA_TTL } = {}) {
  const now = Date.now()
  if (!force && pageDataCache.has(key) && now - (pageDataAt.get(key) || 0) < ttl) {
    return Promise.resolve(pageDataCache.get(key))
  }
  if (pageDataPending.has(key)) return pageDataPending.get(key)
  const p = Promise.resolve()
    .then(loader)
    .then((value) => { cachedSet(key, value); return value })
    .catch((error) => { pageDataCache.delete(key); pageDataAt.delete(key); throw error })
    .finally(() => { pageDataPending.delete(key) })
  pageDataPending.set(key, p)
  return p
}

/** 退出登录时清空全部页面缓存，避免残留他人数据。 */
export function clearPageDataCache() {
  pageDataCache.clear()
  pageDataAt.clear()
  pageDataPending.clear()
}
