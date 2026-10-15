import { send, readBody } from '../middleware/http.js'
import { getStatus, getLogs, setupOpenWiki, startOpenWikiVisualizer, startOpenWikiProjectVisualizer, stopOpenWikiVisualizer, runOpenWikiTask, runOpenWikiProjectTask, setupTokenTracker, startTokenTracker, stopTokenTracker, runTokenTrackerSync, buildTokenTrackerPet, startTokenTrackerPet, stopTokenTrackerPet } from '../services/integrations.js'

/** 外部集成：OpenWiki / TokenTracker 生命周期与任务。 */
export const handlers = {
  'GET /api/integrations/status': async (req, res) => send(res, 200, getStatus()),
  'GET /api/integrations/:service/logs': async (req, res, p) => send(res, 200, { logs: getLogs(p.service) }),
  'POST /api/integrations/openwiki/setup': async (req, res) => send(res, 200, setupOpenWiki()),
  'POST /api/integrations/openwiki/start': async (req, res) => send(res, 200, startOpenWikiVisualizer()),
  'POST /api/integrations/openwiki/start-project': async (req, res) => { try { const b = await readBody(req); send(res, 200, startOpenWikiProjectVisualizer(b.projectId)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'POST /api/integrations/openwiki/stop': async (req, res) => send(res, 200, stopOpenWikiVisualizer()),
  'POST /api/integrations/openwiki/task': async (req, res) => { try { const b = await readBody(req); send(res, 200, runOpenWikiTask(b)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'POST /api/integrations/openwiki/project': async (req, res) => { try { const b = await readBody(req); send(res, 200, await runOpenWikiProjectTask(b)) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'POST /api/integrations/tokentracker/setup': async (req, res) => send(res, 200, setupTokenTracker()),
  'POST /api/integrations/tokentracker/start': async (req, res) => send(res, 200, startTokenTracker()),
  'POST /api/integrations/tokentracker/stop': async (req, res) => send(res, 200, stopTokenTracker()),
  'POST /api/integrations/tokentracker/sync': async (req, res) => send(res, 200, runTokenTrackerSync()),
  'POST /api/integrations/tokentracker/pet/build': async (req, res) => send(res, 200, buildTokenTrackerPet()),
  'POST /api/integrations/tokentracker/pet/start': async (req, res) => send(res, 200, startTokenTrackerPet()),
  'POST /api/integrations/tokentracker/pet/stop': async (req, res) => send(res, 200, stopTokenTrackerPet()),
}
