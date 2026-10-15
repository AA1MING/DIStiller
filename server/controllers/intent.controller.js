import { db } from '../dao/db.js'
import { send } from '../middleware/http.js'
import { buildIntentMap, buildOpportunityConstellation, buildPmPortfolio } from '../services/intent.js'

/** 意图地图 / PM 组合 / Changelog。 */
export const handlers = {
  'GET /api/intent/map': async (req, res) => send(res, 200, { intents: buildIntentMap(), constellation: buildOpportunityConstellation() }),
  'GET /api/pm/portfolio': async (req, res) => send(res, 200, buildPmPortfolio()),

  'GET /api/changelog': async (req, res) => send(res, 200, db.prepare('SELECT * FROM changelog_entries ORDER BY created_at DESC').all()),
  'DELETE /api/changelog/:id': async (req, res, p) => { db.prepare('DELETE FROM changelog_entries WHERE id = ?').run(Number(p.id)); send(res, 200, { ok: true }) },
  'GET /api/changelog/:id/export': async (req, res, p) => {
    const row = db.prepare('SELECT * FROM changelog_entries WHERE id = ?').get(Number(p.id))
    if (!row) return send(res, 404, { error: '不存在' })
    const body = `# ${row.title}\n\n${row.body}\n`
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="changelog-${row.id}.md"` })
    res.end(body)
  },
}
