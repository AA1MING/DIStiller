import { send, readBody } from '../middleware/http.js'
import { registerUser, loginUser, createAuthSession, logoutToken } from '../services/auth.js'
import { claimLegacyDataForFirstUser } from '../dao/db.js'

/** 注册 / 登录（每人独立数据）。 */
export const handlers = {
  'POST /api/auth/register': async (req, res) => {
    try {
      const b = await readBody(req)
      const user = registerUser(b.username, b.password)
      // 首个注册用户接管旧版单用户数据（仅一次，此后每人独立库）
      claimLegacyDataForFirstUser(user.id)
      const token = createAuthSession(user.id)
      send(res, 201, { user, token })
    } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'POST /api/auth/login': async (req, res) => {
    try {
      const b = await readBody(req)
      const user = loginUser(b.username, b.password)
      const token = createAuthSession(user.id)
      send(res, 200, { user, token })
    } catch (e) { send(res, e?.status || 401, { error: e.message }) }
  },
  'POST /api/auth/logout': async (req, res) => {
    logoutToken((req.headers['authorization'] || '').replace(/^Bearer\s+/i, ''))
    send(res, 200, { ok: true })
  },
  'GET /api/auth/me': async (req, res) => send(res, 200, { user: req.user }),
}
