const BASE = '/api'

function authToken() {
  try { return localStorage.getItem('dd-token') || '' } catch { return '' }
}

function saveAuth(user, token) {
  try {
    localStorage.setItem('dd-token', token)
    localStorage.setItem('dd-user', JSON.stringify(user))
  } catch {}
}

function clearAuth() {
  try {
    localStorage.removeItem('dd-token')
    localStorage.removeItem('dd-user')
  } catch {}
}

function notifyUnauthorized() {
  try { window.dispatchEvent(new Event('dd-unauthorized')) } catch {}
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = authToken()
  if (token) headers.Authorization = 'Bearer ' + token
  const res = await fetch(BASE + path, { headers, ...options })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    clearAuth()
    notifyUnauthorized()
  }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`)
  return data
}

export const api = {
  // ===== 注册 / 登录（每人独立数据） =====
  authRegister: (username, password) => request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  authLogin: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  authLogout: () => request('/auth/logout', { method: 'POST' }),
  authMe: () => request('/auth/me'),
  currentUser: () => {
    try {
      const u = JSON.parse(localStorage.getItem('dd-user') || 'null')
      return u && u.username ? u : null
    } catch { return null }
  },
  saveAuth,
  clearAuth,

  health: () => request('/health'),
  getAiSettings: () => request('/settings/ai'),
  saveAiSettings: (cfg) => request('/settings/ai', { method: 'PUT', body: JSON.stringify(cfg) }),
  testAi: (cfg) => request('/settings/ai/test', { method: 'POST', body: JSON.stringify(cfg) }),
  listAiModels: (cfg) => request('/settings/ai/models', { method: 'POST', body: JSON.stringify(cfg) }),
  listChatSessions: () => request('/chat/sessions'),
  createChatSession: (title) => request('/chat/sessions', { method: 'POST', body: JSON.stringify({ title }) }),
  getChatSession: (id) => request(`/chat/sessions/${id}`),
  removeChatSession: (id) => request(`/chat/sessions/${id}`, { method: 'DELETE' }),
  getSignals: (id) => request(`/chat/sessions/${id}/signals`),
  sendChatMessage: (id, content) => request(`/chat/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
  /** 流式发送，返回 AbortController 供取消 */
  streamChatMessage: (id, content, onDelta, onThinking, onDone) => {
    const abort = new AbortController()
    const headers = { 'Content-Type': 'application/json' }
    const token = authToken()
    if (token) headers.Authorization = 'Bearer ' + token
    fetch('/api/chat/sessions/' + id + '/stream', { method: 'POST', headers, body: JSON.stringify({ content }), signal: abort.signal })
      .then(async (res) => {
        if (res.status === 401) { clearAuth(); notifyUnauthorized(); return }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() || ''
          for (const part of parts) {
            const line = part.replace(/^data: /, '')
            try {
              const ev = JSON.parse(line)
              if (ev.type === 'delta') onDelta(ev.delta)
              else if (ev.type === 'thinking') onThinking?.(ev.delta)
              else if (ev.type === 'done') onDone(ev)
            } catch {}
          }
        }
      })
      .catch(() => {})
    return abort
  },
  distillChatSession: (id) => request(`/chat/sessions/${id}/distill`, { method: 'POST' }),
  distilleryOverview: () => request('/distillery/overview'),
  distillBatch: (payload) => request('/distillery/distill', { method: 'POST', body: JSON.stringify(payload) }),
  listProjects: () => request('/projects'),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (payload) => request('/projects', { method: 'POST', body: JSON.stringify(payload) }),
  importProjects: (payload) => request('/projects/import', { method: 'POST', body: JSON.stringify(payload) }),
  importRepo: (payload) => request('/projects/import-repo', { method: 'POST', body: JSON.stringify(payload) }),
  readRepoProject: (id) => request(`/projects/${id}/read`, { method: 'POST' }),
  updateProject: (id, payload) => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  removeProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  rebuildProjects: () => request('/projects/rebuild', { method: 'POST' }),
  generateProject: (payload) => request('/projects/generate', { method: 'POST', body: JSON.stringify(payload) }),
  regenerateAnalysis: (id) => request(`/projects/${id}/analysis`, { method: 'POST' }),
  projectCandidates: (id) => request(`/projects/${id}/candidates`),
  addProjectFeature: (id, featureId) => request(`/projects/${id}/features`, { method: 'POST', body: JSON.stringify({ featureId }) }),
  removeProjectFeature: (id, featureId) => request(`/projects/${id}/features/${featureId}`, { method: 'DELETE' }),
  setFeatureStatus: (id, status) => request(`/features/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  setFeatureFavorite: (id, favorite) => request(`/features/${id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite }) }),
  deleteFeature: (id) => request(`/features/${id}`, { method: 'DELETE' }),
  listFeatures: () => request('/features'),
  listOppFeatures: (oppId) => request(`/opportunities/${oppId}/features`),
  projectDigest: (id) => request(`/projects/${id}/digest`),
  projectWiki: (id) => request(`/projects/${id}/wiki`),
  wikiGalaxy: () => request('/projects/wiki-galaxy'),
  generateProjectWiki: (id) => request(`/projects/${id}/wiki-generate`, { method: 'POST' }),
  listOpportunities: (tag) => request(`/opportunities${tag ? `?tag=${tag}` : ''}`),
  getOpportunity: (id) => request(`/opportunities/${id}`),
  getPmBrief: (id) => request(`/opportunities/${id}/pm-brief`, { method: 'POST' }),
  updateStatus: (id, status) => request(`/opportunities/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  reevaluate: (id) => request(`/opportunities/${id}/reevaluate`, { method: 'POST' }),
  remove: (id) => request(`/opportunities/${id}`, { method: 'DELETE' }),
  getActivity: (id) => request(`/opportunities/${id}/activity`),
  addTag: (id, name, color) => request(`/opportunities/${id}/tags`, { method: 'POST', body: JSON.stringify({ name, color }) }),
  removeTag: (id, tagId) => request(`/opportunities/${id}/tags/${tagId}`, { method: 'DELETE' }),
  distill: (payload) => request('/opportunities/distill', { method: 'POST', body: JSON.stringify(payload) }),
  parseImport: (payload) => request('/import/parse', { method: 'POST', body: JSON.stringify(payload) }),
  distillImport: (payload) => request('/import/distill', { method: 'POST', body: JSON.stringify(payload) }),
  listTags: () => request('/tags'),
  removeTagGlobal: (id) => request(`/tags/${id}`, { method: 'DELETE' }),
  listSources: () => request('/sources'),
  createSource: (s) => request('/sources', { method: 'POST', body: JSON.stringify(s) }),
  removeSource: (id) => request(`/sources/${id}`, { method: 'DELETE' }),
  intentMap: () => request('/intent/map'),
  pmPortfolio: () => request('/pm/portfolio'),
  listChangelog: () => request('/changelog'),
  removeChangelog: (id) => request(`/changelog/${id}`, { method: 'DELETE' }),
  listTemplates: () => request('/templates'),
  createTemplate: (payload) => request('/templates', { method: 'POST', body: JSON.stringify(payload) }),
  removeTemplate: (id) => request(`/templates/${id}`, { method: 'DELETE' }),
  downloadTemplate: (id) => request(`/templates/${id}/download`),
  generateDeliverable: (payload) => request('/deliverables/generate', { method: 'POST', body: JSON.stringify(payload) }),
  reviseDeliverable: (payload) => request('/deliverables/revise', { method: 'POST', body: JSON.stringify(payload) }),
  exportDeliverable: (payload) => request('/deliverables/export', { method: 'POST', body: JSON.stringify(payload) }),
  chatDeliverable: (payload) => request('/deliverables/chat', { method: 'POST', body: JSON.stringify(payload) }),
  saveDeliverable: (payload) => request('/deliverables/save', { method: 'POST', body: JSON.stringify(payload) }),
  listDeliverableVersions: (projectId) => request(`/deliverables/versions${projectId ? `?projectId=${projectId}` : ''}`),
  removeDeliverableVersion: (id) => request(`/deliverables/versions/${id}`, { method: 'DELETE' }),
  importDeliverableVersion: (id) => request(`/deliverables/versions/${id}/import`, { method: 'POST' }),
  usageTrend: (days) => request(`/usage/trend?days=${days || 14}`),
  usageDaily: (days) => request(`/usage/daily?days=${days || 14}`),
  usageSummary: (days) => request(`/usage/summary?days=${days || 14}`),
  integrationStatus: () => request('/integrations/status'),
  integrationLogs: (service) => request(`/integrations/${service}/logs`),
  openwikiSetup: () => request('/integrations/openwiki/setup', { method: 'POST' }),
  openwikiStart: () => request('/integrations/openwiki/start', { method: 'POST' }),
  openwikiStop: () => request('/integrations/openwiki/stop', { method: 'POST' }),
  openwikiTask: (payload) => request('/integrations/openwiki/task', { method: 'POST', body: JSON.stringify(payload) }),
  openwikiProject: (payload) => request('/integrations/openwiki/project', { method: 'POST', body: JSON.stringify(payload) }),
  tokentrackerSetup: () => request('/integrations/tokentracker/setup', { method: 'POST' }),
  tokentrackerStart: () => request('/integrations/tokentracker/start', { method: 'POST' }),
  tokentrackerStop: () => request('/integrations/tokentracker/stop', { method: 'POST' }),
  tokentrackerSync: () => request('/integrations/tokentracker/sync', { method: 'POST' }),
  buildPet: () => request('/integrations/tokentracker/pet/build', { method: 'POST' }),
  startPet: () => request('/integrations/tokentracker/pet/start', { method: 'POST' }),
  stopPet: () => request('/integrations/tokentracker/pet/stop', { method: 'POST' }),
  tokentrackerUsage: () => request('/tokentracker/usage'),
  tokentrackerUsageDaily: () => request('/tokentracker/usage-daily'),
  tokentrackerSessions: (refresh) => request(`/tokentracker/sessions${refresh ? '?refresh=1' : ''}`),
  tokentrackerSessionInsights: () => request('/tokentracker/session-insights'),
  tokenEstimate: (text) => request('/token/estimate', { method: 'POST', body: JSON.stringify({ text }) }),
  analysisMarket: (projectId) => request('/analysis/market', { method: 'POST', body: JSON.stringify({ projectId }) }),
  analysisPrd: (projectId) => request('/analysis/prd', { method: 'POST', body: JSON.stringify({ projectId }) }),
  analysisPrototype: (projectId) => request('/analysis/prototype', { method: 'POST', body: JSON.stringify({ projectId }) }),
  listPromptTemplates: () => request('/prompts/templates'),
  generatePrompt: (payload) => request('/prompts/generate', { method: 'POST', body: JSON.stringify(payload) }),

  // ===== 积分激励（用户端） =====
  pointsMe: () => request('/points/me'),
  pointsLeaderboard: () => request('/points/leaderboard'),
  submitWork: (payload) => request('/points/works', { method: 'POST', body: JSON.stringify(payload) }),
  deleteWork: (id) => request(`/points/works/${id}`, { method: 'DELETE' }),
  workAttachment: (id) => request(`/points/works/${id}/attachment`),
  workEvidence: (id) => request(`/points/works/${id}/evidence`),

  // ===== 个人中心：资料 / 密码 / 积分充值 =====
  getProfile: () => request('/profile'),
  updateProfile: (payload) => request('/profile', { method: 'PUT', body: JSON.stringify(payload) }),
  changePassword: (payload) => request('/profile/password', { method: 'POST', body: JSON.stringify(payload) }),
  rechargePoints: (payload) => request('/points/recharge', { method: 'POST', body: JSON.stringify(payload) }),
  rechargeHistory: () => request('/points/recharges'),

  // ===== 管理端（仅管理员，普通用户调用返回 403） =====
  adminListWorks: (status) => request('/admin/works' + (status ? `?status=${status}` : '')),
  adminReviewWork: (id, payload) => request(`/admin/works/${id}/review`, { method: 'POST', body: JSON.stringify(payload) }),
  adminDeleteWork: (id) => request(`/admin/works/${id}`, { method: 'DELETE' }),
  adminPointsStats: () => request('/admin/points/stats'),
  adminGetPointsModels: () => request('/admin/points/models'),
  adminSavePointsModels: (models) => request('/admin/points/models', { method: 'PUT', body: JSON.stringify({ models }) }),
  adminListUsers: () => request('/admin/users'),
  adminDeleteUser: (id) => request('/admin/users/' + id, { method: 'DELETE' }),
  adminWorkAttachment: (id) => request(`/admin/works/${id}/attachment`),
  adminWorkEvidence: (id) => request(`/admin/works/${id}/evidence`),

  // ===== 模板市场（用户端：浏览 / 预览 / 积分兑换） =====
  marketTemplates: () => request('/market/templates'),
  marketMy: () => request('/market/my'),
  marketPreview: (id) => request(`/market/templates/${id}/preview`, { method: 'POST' }),
  marketPurchase: (id) => request(`/market/templates/${id}/purchase`, { method: 'POST' }),

  // ===== 模板市场管理（仅管理员） =====
  adminMarketAdd: (payload) => request('/market/templates', { method: 'POST', body: JSON.stringify(payload) }),
  adminMarketImportWork: (workId, payload) => request(`/market/templates/import-work/${workId}`, { method: 'POST', body: JSON.stringify(payload) }),
  adminMarketDelete: (id) => request(`/market/templates/${id}`, { method: 'DELETE' }),
  adminMarketStats: () => request('/admin/market/stats'),
}
