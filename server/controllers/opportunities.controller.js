import { db, listOpportunities, getOpportunity } from '../dao/db.js'
import { send, readBody } from '../middleware/http.js'
import { distillFromText, reevaluateOpportunity, deleteOpportunity, updateStatus } from '../services/distill.js'
import { similarOpportunities } from '../services/dedup.js'
import { buildPmBrief } from '../services/intent.js'

/** 机会池 / 标签 / 导入源。 */
export const handlers = {
  'GET /api/opportunities': async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const tag = url.searchParams.get('tag')
    send(res, 200, listOpportunities(tag))
  },
  'GET /api/opportunities/:id': async (req, res, p) => {
    const id = Number(p.id); if (!Number.isInteger(id)) return send(res, 400, { error: '非法 ID' })
    const detail = getOpportunity(id); if (!detail) return send(res, 404, { error: '机会不存在' })
    detail.similar = similarOpportunities(id); send(res, 200, detail)
  },
  'POST /api/opportunities/distill': async (req, res) => {
    try { const b = await readBody(req); const t = String(b.text || '').trim(); if (t.length < 5) return send(res, 400, { error: '请输入至少 5 个字符的需求素材' });
      send(res, 201, await distillFromText({ text: t, sourceType: b.sourceType, sourceName: b.sourceName, sourceUrl: b.sourceUrl, force: !!b.force })) }
    catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
  'POST /api/opportunities/:id/reevaluate': async (req, res, p) => { try { send(res, 200, await reevaluateOpportunity(Number(p.id))) } catch (e) { send(res, e?.status || 500, { error: e.message }) } },
  'PUT /api/opportunities/:id/status': async (req, res, p) => { try { send(res, 200, updateStatus(Number(p.id), (await readBody(req)).status)) } catch (e) { send(res, e?.status || 500, { error: e.message }) } },
  'POST /api/opportunities/:id/pm-brief': async (req, res, p) => { const brief = buildPmBrief(Number(p.id)); if (!brief) return send(res, 404, { error: '机会不存在' }); send(res, 200, brief) },
  'GET /api/opportunities/:id/activity': async (req, res, p) => send(res, 200, db.prepare('SELECT * FROM opportunity_activity WHERE opportunity_id = ? ORDER BY id DESC').all(Number(p.id))),
  'DELETE /api/opportunities/:id': async (req, res, p) => { deleteOpportunity(Number(p.id)); send(res, 200, { ok: true }) },

  'GET /api/opportunities/:id/tags': async (req, res, p) => send(res, 200, db.prepare('SELECT t.* FROM tags t JOIN opportunity_tags ot ON ot.tag_id = t.id WHERE ot.opportunity_id = ? ORDER BY t.name').all(Number(p.id))),
  'POST /api/opportunities/:id/tags': async (req, res, p) => {
    try {
      const id = Number(p.id); const b = await readBody(req)
      let tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(b.name)
      if (!tag) { const info = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(b.name, b.color || '#3b82f6'); tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(Number(info.lastInsertRowid)) }
      db.prepare('INSERT OR IGNORE INTO opportunity_tags (opportunity_id, tag_id) VALUES (?, ?)').run(id, tag.id)
      send(res, 200, db.prepare('SELECT t.* FROM tags t JOIN opportunity_tags ot ON ot.tag_id = t.id WHERE ot.opportunity_id = ? ORDER BY t.name').all(id))
    } catch (e) { send(res, e?.status || 500, { error: e.message }) }
  },
  'DELETE /api/opportunities/:id/tags/:tagId': async (req, res, p) => { db.prepare('DELETE FROM opportunity_tags WHERE opportunity_id = ? AND tag_id = ?').run(Number(p.id), Number(p.tagId)); send(res, 200, { ok: true }) },

  'GET /api/tags': async (req, res) => send(res, 200, db.prepare('SELECT * FROM tags ORDER BY name').all()),
  'DELETE /api/tags/:id': async (req, res, p) => {
    db.prepare('DELETE FROM opportunity_tags WHERE tag_id = ?').run(Number(p.id))
    db.prepare('DELETE FROM tags WHERE id = ?').run(Number(p.id))
    send(res, 200, { ok: true })
  },

  'GET /api/sources': async (req, res) => send(res, 200, db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all()),
  'POST /api/sources': async (req, res) => { try { const b = await readBody(req); if (!b.name) return send(res, 400, { error: '名称必填' }); const info = db.prepare('INSERT INTO sources (name, source_type, url) VALUES (?, ?, ?)').run(b.name, b.sourceType || 'community', b.url || null); send(res, 201, db.prepare('SELECT * FROM sources WHERE id = ?').get(Number(info.lastInsertRowid))) } catch (e) { send(res, e?.status || 400, { error: e.message }) } },
  'DELETE /api/sources/:id': async (req, res, p) => { db.prepare('DELETE FROM sources WHERE id = ?').run(Number(p.id)); send(res, 200, { ok: true }) },
}
