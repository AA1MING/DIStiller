import { send, readBody } from '../middleware/http.js'
import { publicAiSettings, saveAiSettings, testAiConnection, listAiModels } from '../services/ai.js'

/** 统一 AI 配置（Provider / BaseUrl / Model / ApiKey / Enabled）。 */
export const handlers = {
  'GET /api/settings/ai': async (req, res) => send(res, 200, publicAiSettings()),
  'PUT /api/settings/ai': async (req, res) => { try { send(res, 200, saveAiSettings(await readBody(req))) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'POST /api/settings/ai/test': async (req, res) => { try { const r = await testAiConnection(await readBody(req)); send(res, r.ok ? 200 : 400, r) } catch (e) { send(res, 500, { ok: false, error: e.message }) } },
  'POST /api/settings/ai/models': async (req, res) => { try { send(res, 200, await listAiModels(await readBody(req))) } catch (e) { send(res, e?.status || 400, { ok: false, error: e.message }) } },
}
