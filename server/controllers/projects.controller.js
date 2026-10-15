import { db } from '../dao/db.js'
import { send, readBody } from '../middleware/http.js'
import { listProjects, getProject, rebuildProjects, keptFeatureDigest, createProject, importProjects, updateProject, setFeatureStatus, listFeatures } from '../services/projects.js'
import { importRepo, readProject, deleteRepoProject } from '../services/repo-import.js'
import { readOpenWikiGraph, buildOpenWikiProjectGraph, buildWikiGalaxy, deleteOpenWikiProject } from '../services/integrations.js'
import { generateProjectWiki } from '../services/wiki-generate.js'

/** 项目管理 + Wiki 知识图 + 功能点状态。 */
export const handlers = {
  'GET /api/projects': async (req, res) => send(res, 200, listProjects()),
  'POST /api/projects': async (req, res) => { try { const b = await readBody(req); send(res, 201, createProject(b)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'POST /api/projects/import': async (req, res) => { try { const b = await readBody(req); send(res, 201, importProjects(b)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'POST /api/projects/import-repo': async (req, res) => { try { const b = await readBody(req); send(res, 201, await importRepo(b)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) } },
  'DELETE /api/projects/:id': async (req, res, p) => { await deleteOpenWikiProject(p.id); deleteRepoProject(p.id); db.prepare('DELETE FROM projects WHERE id = ?').run(Number(p.id)); send(res, 200, { ok: true }) },
  'POST /api/projects/:id/read': async (req, res, p) => { try { send(res, 200, await readProject(p.id)) } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) } },
  'PUT /api/projects/:id': async (req, res, p) => { try { const b = await readBody(req); send(res, 200, updateProject(p.id, b)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'GET /api/projects/:id': async (req, res, p) => { const pr = getProject(p.id); if (!pr) return send(res, 404, { error: '项目不存在' }); send(res, 200, pr) },
  'GET /api/projects/:id/wiki': async (req, res, p) => send(res, 200, await readOpenWikiGraph(Number(p.id))),
  'GET /api/projects/wiki-galaxy': async (req, res) => send(res, 200, await buildWikiGalaxy()),
  'GET /api/projects/:id/wiki-graph': async (req, res, p) => send(res, 200, await buildOpenWikiProjectGraph(Number(p.id))),
  'POST /api/projects/:id/wiki-generate': async (req, res, p) => { try { send(res, 200, await generateProjectWiki(Number(p.id))) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'POST /api/projects/rebuild': async (req, res) => { const removedIds = listProjects().filter((p) => p.auto).map((p) => p.id); const result = rebuildProjects(); for (const id of removedIds) await deleteOpenWikiProject(id); send(res, 200, result) },
  'POST /api/features/:id/status': async (req, res, p) => { try { const b = await readBody(req); send(res, 200, setFeatureStatus(p.id, b.status)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'GET /api/opportunities/:id/features': async (req, res, p) => send(res, 200, listFeatures(Number(p.id))),
  'GET /api/projects/:id/digest': async (req, res, p) => send(res, 200, { digest: keptFeatureDigest(Number(p.id)) }),
}
