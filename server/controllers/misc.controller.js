import { db } from '../dao/db.js'
import { send } from '../middleware/http.js'
import { publicAiSettings } from '../services/ai.js'
import { listSignals } from '../services/chat.js'
import { getUserByUsername, getProfile, createAuthSession } from '../services/auth.js'

/** 系统级接口：健康检查 / 信号 / TokenTracker 本地鉴权。 */
export const handlers = {
  'GET /api/health': async (req, res) => {
    const ai = publicAiSettings()
    send(res, 200, { ok: true, name: 'demand-distiller', aiConfigured: ai.hasApiKey && ai.enabled, opportunityCount: db.prepare('SELECT COUNT(*) AS c FROM opportunities').get().c, time: new Date().toISOString() })
  },

  'GET /api/signals': async (req, res) => send(res, 200, listSignals()),

  // 原版 TokenTracker 本地鉴权 token（local-api-auth.ts 需要；本地 CLI 同款行为）
  // 同时作为「小程序免登录同步」入口：为 MINI_SYNC_USER（默认 admin）签发会话令牌，
  // 小程序启动时静默调用即可同步电脑端账号数据，无需在手机上再登录。
  'GET /api/local-auth': async (req, res) => {
    const username = String(process.env.MINI_SYNC_USER || 'admin').trim()
    const user = getUserByUsername(username)
    if (!user) return send(res, 404, { error: '未找到同步账号「' + username + '」，请在服务器设置环境变量 MINI_SYNC_USER 指定电脑端账号' })
    const token = createAuthSession(user.id)
    send(res, 200, { token, user: getProfile(user.id) })
  },
}
