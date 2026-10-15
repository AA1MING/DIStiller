import { send, readBody } from '../middleware/http.js'
import { createSession, listSessions, getSession, deleteSession, sendMessage, sendMessageStream, listSignals, distillSession } from '../services/chat.js'

/** AI 对话会话：持久化 / 消息 / 流式 / 信号 / 一键蒸馏。 */
export const handlers = {
  'GET /api/chat/sessions': async (req, res) => send(res, 200, listSessions()),
  'POST /api/chat/sessions': async (req, res) => { const b = await readBody(req); send(res, 201, createSession(b.title || '新的需求对话')) },
  'GET /api/chat/sessions/:id': async (req, res, p) => { const s = getSession(Number(p.id)); if (!s) return send(res, 404, { error: '对话不存在' }); send(res, 200, s) },
  'DELETE /api/chat/sessions/:id': async (req, res, p) => { const n = deleteSession(Number(p.id)); send(res, 200, { ok: true, deleted: n }) },
  'GET /api/chat/sessions/:id/signals': async (req, res, p) => send(res, 200, listSignals(Number(p.id))),
  'POST /api/chat/sessions/:id/messages': async (req, res, p) => { try { const b = await readBody(req); const c = String(b.content || '').trim(); if (!c) return send(res, 400, { error: '消息不能为空' }); send(res, 200, await sendMessage(Number(p.id), c)) } catch (e) { send(res, e?.status || 500, { error: e.message }) } },
  'POST /api/chat/sessions/:id/stream': async (req, res, p) => {
    try {
      const b = await readBody(req)
      const c = String(b.content || '').trim()
      if (!c) return send(res, 400, { error: '消息不能为空' })
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' })
      await sendMessageStream(Number(p.id), c, res, (ev) => { res.write(`data: ${JSON.stringify(ev)}\n\n`) })
      res.end()
    } catch (e) { if (!res.headersSent) send(res, e?.status || 500, { error: e.message }); else res.end(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`) }
  },
  'POST /api/chat/sessions/:id/distill': async (req, res, p) => { try { send(res, 201, await distillSession(Number(p.id))) } catch (e) { send(res, e?.status || 500, { error: e.message }) } },
}
