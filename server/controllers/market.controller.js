import { send, readBody } from '../middleware/http.js'
import { requireAdmin } from '../middleware/auth.js'
import { listMarketTemplates, getMarketTemplate, deleteMarketTemplate, addMarketTemplateFromFile, importWorkAsMarketTemplate, previewMarketTemplate, purchaseMarketTemplate, marketStats } from '../services/market.js'
import { pointsBalance, userPurchases, marketPurchaseStats } from '../services/works.js'

/** 模板市场：用户端浏览 / 预览 / 积分兑换 + 管理端上架 / 导入 / 下架 / 统计。 */
export const handlers = {
  'GET /api/market/templates': async (req, res) => {
    try { send(res, 200, { templates: listMarketTemplates(req.user.id), balance: pointsBalance(req.user.id) }) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'GET /api/market/my': async (req, res) => send(res, 200, { purchases: userPurchases(req.user.id) }),
  'POST /api/market/templates/:id/preview': async (req, res, p) => {
    try { send(res, 200, previewMarketTemplate(p.id)) } catch (e) { send(res, e?.status || 404, { error: e.message }) }
  },
  'POST /api/market/templates/:id/purchase': async (req, res, p) => {
    try { send(res, 200, purchaseMarketTemplate(req.user.id, p.id)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },

  // 管理端：上架 / 从已审核作品导入 / 下架 / 统计
  'POST /api/market/templates': async (req, res) => {
    try { requireAdmin(req); const b = await readBody(req); send(res, 201, addMarketTemplateFromFile({ ...b, createdBy: req.user.username })) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'POST /api/market/templates/import-work/:workId': async (req, res, p) => {
    try { requireAdmin(req); const b = await readBody(req); send(res, 201, importWorkAsMarketTemplate(p.workId, b, req.user.username)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'DELETE /api/market/templates/:id': async (req, res, p) => {
    try { requireAdmin(req); send(res, 200, deleteMarketTemplate(p.id)) } catch (e) { send(res, e?.status || 400, { error: e.message }) }
  },
  'GET /api/admin/market/stats': async (req, res) => {
    try { requireAdmin(req); send(res, 200, { ...marketStats(), ...marketPurchaseStats() }) } catch (e) { send(res, e?.status || 403, { error: e.message }) }
  },
}
