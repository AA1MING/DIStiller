import { send, readBody } from '../middleware/http.js'
import { requireAdmin } from '../middleware/auth.js'
import { listAllWorks, reviewWork, adminStats, userWorkStats, deleteUserWorks, deleteUserPurchases, deleteUserRecharges, getWorkWithAttachment, deleteWork } from '../services/works.js'
import { listAllUsers, deleteUser } from '../services/auth.js'
import { deleteUserDb } from '../dao/db.js'
import { loadPointsModels, savePointsModels, pointsModelUsage } from '../services/ai.js'

/** 管理端：用户管理 / 作品审核 / 统计。 */
export const handlers = {
  'GET /api/admin/works': async (req, res) => {
    try { requireAdmin(req); const url = new URL(req.url, 'http://localhost'); send(res, 200, { works: listAllWorks({ status: url.searchParams.get('status') || '' }) }) } catch (e) { send(res, e?.status || 403, { error: e.message }) }
  },
  'POST /api/admin/works/:id/review': async (req, res, p) => {
    try { requireAdmin(req); const b = await readBody(req); send(res, 200, reviewWork(p.id, b)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'DELETE /api/admin/works/:id': async (req, res, p) => {
    try { requireAdmin(req); send(res, 200, deleteWork(p.id)) } catch (e) { send(res, e?.status || 403, { error: e.message }) }
  },
  'GET /api/admin/points/stats': async (req, res) => {
    try { requireAdmin(req); send(res, 200, adminStats()) } catch (e) { send(res, e?.status || 403, { error: e.message }) }
  },
  'GET /api/admin/points/models': async (req, res) => {
    try { requireAdmin(req); send(res, 200, { models: loadPointsModels(), usage: pointsModelUsage() }) } catch (e) { send(res, e?.status || 403, { error: e.message }) }
  },
  'PUT /api/admin/points/models': async (req, res) => {
    try { requireAdmin(req); const b = await readBody(req); send(res, 200, { models: savePointsModels(b?.models), usage: pointsModelUsage() }) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'GET /api/admin/users': async (req, res) => {
    try {
      requireAdmin(req)
      const stats = new Map(userWorkStats().map((s) => [s.user_id, s]))
      send(res, 200, {
        users: listAllUsers().map((u) => {
          const s = stats.get(u.id) || { total: 0, pending: 0, approved: 0, rejected: 0, points: 0 }
          return { ...u, works: s.total, pending: s.pending, approved: s.approved, rejected: s.rejected, points: s.points }
        }),
      })
    } catch (e) { send(res, e?.status || 403, { error: e.message }) }
  },
  'DELETE /api/admin/users/:id': async (req, res, p) => {
    try {
      requireAdmin(req)
      const targetId = Number(p.id)
      if (targetId === req.user.id) return send(res, 400, { error: '不能删除当前登录的账号' })
      deleteUserWorks(targetId)
      deleteUserPurchases(targetId)
      deleteUserRecharges(targetId)
      const r = deleteUser(targetId)
      deleteUserDb(targetId)
      send(res, 200, { ok: true, username: r.username })
    } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'GET /api/admin/works/:id/attachment': async (req, res, p) => {
    try {
      requireAdmin(req)
      const work = getWorkWithAttachment(p.id)
      if (!work) return send(res, 404, { error: '作品不存在' })
      send(res, 200, { name: work.attachment_name, type: work.attachment_type, size: work.attachment_size, data: work.attachment_data || null })
    } catch (e) { send(res, e?.status || 403, { error: e.message }) }
  },
  'GET /api/admin/works/:id/evidence': async (req, res, p) => {
    try {
      requireAdmin(req)
      const work = getWorkWithAttachment(p.id)
      if (!work) return send(res, 404, { error: '作品不存在' })
      send(res, 200, { name: work.evidence_name, type: work.evidence_type, size: work.evidence_size, data: work.evidence_data || null })
    } catch (e) { send(res, e?.status || 403, { error: e.message }) }
  },
}
