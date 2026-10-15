import { send, readBody } from '../middleware/http.js'
import { distilleryOverview, distillBatch } from '../services/distillery.js'
import { parseImport, clampText } from '../services/import.js'
import { distillFromText } from '../services/distill.js'

/** 蒸馏工作台 + 导入解析（txt/md/json/csv/docx + AI 对话导出）。 */
export const handlers = {
  'GET /api/distillery/overview': async (req, res) => send(res, 200, distilleryOverview()),
  'POST /api/distillery/distill': async (req, res) => { try { const b = await readBody(req); send(res, 201, await distillBatch(b)) } catch (e) { send(res, e?.status || 500, { error: e.message }) } },

  'POST /api/import/parse': async (req, res) => {
    try {
      const b = await readBody(req)
      const text = clampText(parseImport({ filename: b.filename, content: b.content, format: b.format }))
      send(res, 200, { text, length: text.length })
    } catch (e) { send(res, e?.status || 400, { error: e.message || String(e) }) }
  },
  'POST /api/import/distill': async (req, res) => {
    try {
      const b = await readBody(req)
      const parsed = clampText(parseImport({ filename: b.filename, content: b.content, format: b.format }))
      const result = await distillFromText({ text: b.text || parsed, sourceType: b.sourceType || 'manual', sourceName: b.sourceName || b.filename || '导入素材', sourceUrl: b.sourceUrl })
      send(res, 201, result)
    } catch (e) { send(res, e?.status || 500, { error: e.message || String(e) }) }
  },
}
