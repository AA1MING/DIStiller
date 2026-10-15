import { send, readBody } from '../middleware/http.js'
import { createWork, listMyWorks, deleteMyWork, pointsBalance, pointsEarned, getWorkWithAttachment, pointsLeaderboard, rechargePoints, listRecharges } from '../services/works.js'
import { getProfile, updateProfile, changePassword, deleteOtherSessions } from '../services/auth.js'

/** 积分激励（用户端）+ 个人中心（资料 / 密码 / 充值）。 */
export const handlers = {
  'GET /api/points/me': async (req, res) => {
    const works = listMyWorks(req.user.id)
    send(res, 200, { balance: pointsBalance(req.user.id), earned: pointsEarned(req.user.id), works })
  },
  'GET /api/points/leaderboard': async (req, res) => {
    const lb = pointsLeaderboard()
    const idx = lb.findIndex((r) => r.user_id === req.user.id)
    send(res, 200, { leaderboard: lb.slice(0, 20), my: idx >= 0 ? { rank: idx + 1, ...lb[idx] } : null })
  },
  'POST /api/points/works': async (req, res) => {
    try { const b = await readBody(req); send(res, 201, createWork(req.user.id, req.user.username, b)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'DELETE /api/points/works/:id': async (req, res, p) => {
    try { send(res, 200, deleteMyWork(req.user.id, p.id)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'GET /api/points/works/:id/attachment': async (req, res, p) => {
    try {
      const work = getWorkWithAttachment(p.id)
      if (!work || work.user_id !== req.user.id) return send(res, 404, { error: '作品不存在' })
      send(res, 200, { name: work.attachment_name, type: work.attachment_type, size: work.attachment_size, data: work.attachment_data || null })
    } catch (e) { send(res, 400, { error: e.message }) }
  },
  'GET /api/points/works/:id/evidence': async (req, res, p) => {
    try {
      const work = getWorkWithAttachment(p.id)
      if (!work || work.user_id !== req.user.id) return send(res, 404, { error: '作品不存在' })
      send(res, 200, { name: work.evidence_name, type: work.evidence_type, size: work.evidence_size, data: work.evidence_data || null })
    } catch (e) { send(res, 400, { error: e.message }) }
  },

  'GET /api/profile': async (req, res) => {
    try { send(res, 200, getProfile(req.user.id)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'PUT /api/profile': async (req, res) => {
    try { const b = await readBody(req); send(res, 200, updateProfile(req.user.id, b)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'POST /api/profile/password': async (req, res) => {
    try {
      const b = await readBody(req)
      changePassword(req.user.id, b.oldPassword, b.newPassword)
      deleteOtherSessions(req.user.id, (req.headers['authorization'] || '').replace(/^Bearer\s+/i, ''))
      send(res, 200, { ok: true })
    } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'POST /api/points/recharge': async (req, res) => {
    try { const b = await readBody(req); send(res, 201, rechargePoints(req.user.id, b.amount, b.method)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'GET /api/points/recharges': async (req, res) => send(res, 200, { recharges: listRecharges(req.user.id) }),
}
