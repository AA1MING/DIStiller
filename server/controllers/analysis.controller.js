import { send, readBody } from '../middleware/http.js'
import { marketAnalysis, prdAnalysis, prototypeHtml } from '../services/analysis.js'

/** icemark 产品分析：市场分析 / PRD / HTML 交互原型。 */
export const handlers = {
  'POST /api/analysis/market': async (req, res, p) => { try { const b = await readBody(req); send(res, 200, await marketAnalysis(b.projectId)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) } },
  'POST /api/analysis/prd': async (req, res, p) => { try { const b = await readBody(req); send(res, 200, await prdAnalysis(b.projectId)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) } },
  'POST /api/analysis/prototype': async (req, res, p) => { try { const b = await readBody(req); send(res, 200, await prototypeHtml(b.projectId)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) } },
}
