import { send, readBody } from '../middleware/http.js'
import { generateDeliverable, reviseDeliverable, saveDeliverableVersion, listDeliverableVersions, deleteDeliverableVersion, importVersionToProject, listTemplates, createTemplate, deleteTemplate, downloadTemplate, exportDeliverable, chatDeliverable } from '../services/deliverables.js'
import { listAgentTemplates, generateProjectPrompt } from '../services/prompts.js'

/** 文档生成（模板库 / 生成 / 修订 / 导出 / 版本 / AI 对话）+ AI 提示词。 */
export const handlers = {
  'GET /api/templates': async (req, res) => send(res, 200, listTemplates()),
  'POST /api/templates': async (req, res) => { try { const b = await readBody(req); send(res, 201, await createTemplate(b)) } catch (e) { send(res, e?.status || 400, { error: e.message || String(e) }) } },
  'DELETE /api/templates/:id': async (req, res, p) => { deleteTemplate(p.id); send(res, 200, { ok: true }) },
  'GET /api/templates/:id/download': async (req, res, p) => { try { send(res, 200, downloadTemplate(p.id)) } catch (e) { send(res, 404, { error: e.message || String(e) }) } },
  'POST /api/deliverables/generate': async (req, res) => {
    try { const b = await readBody(req); send(res, 200, await generateDeliverable(b)) }
    catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
  'POST /api/deliverables/revise': async (req, res) => {
    try { const b = await readBody(req); send(res, 200, await reviseDeliverable(b)) }
    catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
  'POST /api/deliverables/export': async (req, res) => {
    try { const b = await readBody(req); send(res, 200, await exportDeliverable(b)) }
    catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
  'GET /api/prompts/templates': async (req, res) => { send(res, 200, listAgentTemplates()) },
  'POST /api/prompts/generate': async (req, res) => {
    try { const b = await readBody(req); send(res, 200, await generateProjectPrompt(b)) }
    catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
  'POST /api/deliverables/chat': async (req, res) => {
    try { const b = await readBody(req); send(res, 200, await chatDeliverable(b)) }
    catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
  'POST /api/deliverables/save': async (req, res) => {
    try { const b = await readBody(req); send(res, 200, saveDeliverableVersion(b)) }
    catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
  'GET /api/deliverables/versions': async (req, res) => { const url = new URL(req.url, 'http://localhost'); const pid = url.searchParams.get('projectId'); send(res, 200, listDeliverableVersions(pid)) },
  'DELETE /api/deliverables/versions/:id': async (req, res, p) => {
    try { send(res, 200, deleteDeliverableVersion(p.id)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
  'POST /api/deliverables/versions/:id/import': async (req, res, p) => {
    try { send(res, 200, importVersionToProject(p.id)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
}
