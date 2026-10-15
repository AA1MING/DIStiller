import { send, readBody } from '../middleware/http.js'
import { listAllFeatures, setFeatureFavorite, deleteFeature, generateProjectFromFeatures, regenerateProjectAnalysis, addFeatureToProject, removeFeatureFromProject, featureCandidatesForProject } from '../services/needs.js'

/** 功能点池 + 需求点整合生成项目 + 项目功能点管理。 */
export const handlers = {
  'GET /api/features': async (req, res) => send(res, 200, listAllFeatures()),
  'PUT /api/features/:id/favorite': async (req, res, p) => { try { const b = await readBody(req); send(res, 200, setFeatureFavorite(p.id, b.favorite)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'DELETE /api/features/:id': async (req, res, p) => { try { send(res, 200, deleteFeature(p.id)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },

  'POST /api/projects/generate': async (req, res) => { try { const b = await readBody(req); send(res, 201, await generateProjectFromFeatures(b)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) } },
  'POST /api/projects/:id/analysis': async (req, res, p) => { try { send(res, 200, await regenerateProjectAnalysis(p.id)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) } },
  'GET /api/projects/:id/candidates': async (req, res, p) => send(res, 200, featureCandidatesForProject(p.id)),
  'POST /api/projects/:id/features': async (req, res, p) => { try { const b = await readBody(req); send(res, 200, addFeatureToProject(p.id, b.featureId)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'DELETE /api/projects/:id/features/:fid': async (req, res, p) => { removeFeatureFromProject(p.id, p.fid); send(res, 200, { ok: true }) },
}
