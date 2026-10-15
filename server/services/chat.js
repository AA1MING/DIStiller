import { db } from '../dao/db.js'
import { getAiSettings, chatText, chatTextStream, UNIFIED_SYSTEM_PROMPT } from './ai.js'
import { distillFromText } from './distill.js'
import { analyzeSignal } from './kura.js'

/** 从助手回复里解析 <signal>疑似需求：xxx</signal>，返回提取后的纯文本，并剥离 [mode:xxx] 等模式标记。 */
function parseSignal(content) {
  let raw = String(content || '')
    .replace(/^\s*\[mode:\w+\]\s*/g, '')   // 模型可能复述模式标记，一律剥离
    .replace(/\n\s*\[mode:\w+\]\s*/g, '\n')
  let signal = null
  // 完整标签（容忍空格/属性变体）：提取内容并整段移除
  const m = raw.match(/<\s*signal[^>]*>([\s\S]*?)<\/\s*signal>/i)
  if (m) {
    signal = m[1].trim().replace(/^疑似需求[:：]/, '').trim()
    raw = raw.replace(m[0], '')
  } else {
    // 残缺标签兜底：未闭合的 <signal 视为信号段整体移除；孤立的 </signal>、<> 直接清除
    const open = raw.match(/<\s*signal[^>]*>/i)
    if (open) {
      const after = raw.slice(open.index + open[0].length).replace(/^疑似需求[:：]/, '').trim()
      if (after) signal = after.replace(/<\/?\s*signal[^>]*>/gi, '').trim()
      raw = raw.slice(0, open.index)
    } else {
      raw = raw.replace(/<\/?\s*signal[^>]*>/gi, '').replace(/<>/g, '')
    }
  }
  // 任何残留的标签碎片一律清除（模型偶发输出 <></signal> 之类）；markdown 标记保留供前端渲染
  raw = raw.replace(/<\/?\s*signal[^>]*>/gi, '').replace(/<>/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return { text: raw, signal: signal || null }
}

/** 展示层清理：去除正文里的 signal 标签残片与模式标记（含历史消息）；markdown 保留供渲染。 */
function stripSignalFragments(content) {
  return String(content || '')
    .replace(/^\s*\[mode:\w+\]\s*/g, '')
    .replace(/\n\s*\[mode:\w+\]\s*/g, '\n')
    .replace(/<\s*signal[\s\S]*?<\/\s*signal>/gi, '')
    .replace(/<\/?\s*signal[^>]*>/gi, '')
    .replace(/<>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function createSession(title = '新的需求对话') {
  const info = db.prepare('INSERT INTO chat_sessions (title) VALUES (?)').run(title)
  return getSession(Number(info.lastInsertRowid))
}

export function listSessions() {
  return db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all()
}

export function getSession(id) {
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id)
  if (!session) return null
  const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC').all(id)
  // 输出前清理 signal 标签残片（历史脏数据一并修正，不动库）
  return { session, messages: messages.map((m) => ({ ...m, content: stripSignalFragments(m.content) })) }
}

export function deleteSession(id) {
  const info = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(Number(id))
  return Number(info.changes)
}

function serializeSignal(row) {
  if (!row) return row
  return { ...row, jobsToBeDone: (() => { try { return row.jobs_to_be_done ? JSON.parse(row.jobs_to_be_done) : [] } catch { return [] } })(), antiSignals: (() => { try { return row.anti_signals ? JSON.parse(row.anti_signals) : [] } catch { return [] } })() }
}

export function listSignals(sessionId) {
  const rows = sessionId
    ? db.prepare('SELECT * FROM signals WHERE session_id = ? ORDER BY id DESC').all(sessionId)
    : db.prepare('SELECT * FROM signals ORDER BY id DESC').all()
  return rows.map(serializeSignal)
}

function fallbackReply(text) {
  return `我先按"需求意图理解"的方式拆解：\n\n1. 表层诉求：${text.slice(0, 120)}\n2. 可能的隐性意图：用户希望减少判断成本、提高机会识别准确率或自动化重复整理工作。\n3. 需要补充的证据：谁遇到这个问题？频率多高？当前替代方案是什么？愿意为什么结果付费？\n4. 下一步：继续补充更多原始对话/评论，或点击"蒸馏为机会"生成 PRD、MVP 与验证实验。`
}

/**
 * 流式信号标签过滤器：把 <signal>…</signal>（含残缺写法 </signal>、<>、带空格/大小写变体）
 * 与模型回声的模式标记 [mode:xxx] 从输出给前端的 delta 中剥离，避免脏内容随流式输出显示；
 * 完整原始文本仍由调用方保留用于 parseSignal。
 */
export function createSignalStreamFilter(writeDelta) {
  let hold = ''
  let inSignal = false

  /** 尾部可能构成 <signal / </signal / [mode: 前缀的长度（防半标签跨块）。 */
  const tagPrefixTail = (s) => {
    const t = s.toLowerCase()
    for (let n = Math.min(s.length, 8); n >= 1; n--) {
      const tail = t.slice(-n)
      if ('<signal'.startsWith(tail) || '</signal'.startsWith(tail) || '[mode:'.startsWith(tail)) return n
    }
    return 0
  }
  /** 需要暂留的尾部长度：未闭合的 signal 标签（含空格/部分单词变体）与未闭合的 [mode:xxx。 */
  const openTailRe = /<\s*(?:s(?:i(?:g(?:n(?:a(?:l)?)?)?)?)?)?\s*$/i
  const closeTailRe = /<\/\s*(?:s(?:i(?:g(?:n(?:a(?:l)?)?)?)?)?)?\s*$/i
  const modeTailRe = /\[mode:\w*$/i
  const tailHold = (s) => {
    let t = 0
    for (const re of [openTailRe, closeTailRe, modeTailRe]) {
      const m = s.match(re)
      if (m) t = Math.max(t, m[0].length)
    }
    return Math.max(t, tagPrefixTail(s))
  }
  const writeSafe = (s) => { if (s) writeDelta(s) }
  /** 清理非信号段里的模式标记与完整标签残片（markdown 保留供前端渲染）。 */
  const cleanJunk = (s) => s
    .replace(/\[mode:\w+\]/gi, '')
    .replace(/<\/?\s*signal[^>]*>/gi, '')
    .replace(/<>/g, '')

  const findOpen = (s) => {
    const m = s.match(/<\s*signal/i)
    if (!m) return null
    return { idx: m.index, gt: s.indexOf('>', m.index) }
  }
  const findClose = (s) => {
    const m = s.match(/<\/\s*signal/i)
    if (!m) return null
    return { idx: m.index, gt: s.indexOf('>', m.index) }
  }

  const step = (delta) => {
    hold += delta
    while (true) {
      if (!inSignal) {
        const open = findOpen(hold)
        if (!open) break
        writeSafe(hold.slice(0, open.idx))
        if (open.gt < 0) { hold = ''; inSignal = true; break }
        hold = hold.slice(open.gt + 1)
        inSignal = true
        continue
      }
      const close = findClose(hold)
      if (!close) break
      if (close.gt < 0) break // 闭合标签可能跨块，保留尾部等下一块
      hold = hold.slice(close.gt + 1)
      inSignal = false
      continue
    }
    if (!inSignal) {
      // 非信号段：剥离孤立闭合标签、空标签碎片与模式标记，半标签尾部暂留
      const cleaned = cleanJunk(hold)
      const t = tailHold(cleaned)
      writeSafe(cleaned.slice(0, cleaned.length - t))
      hold = cleaned.slice(cleaned.length - t)
    } else {
      // 信号段：内容直接丢弃，只保留可能是闭合标签前缀的尾部
      const t = tailHold(hold)
      if (hold.length > t) hold = hold.slice(hold.length - t)
    }
  }

  return {
    step,
    flush() {
      if (!inSignal) {
        const cleaned = cleanJunk(hold)
        hold = ''
        writeSafe(cleaned)
      } else {
        hold = ''
      }
    }
  }
}
/** 组装对话历史：存量消息剥离 [mode:xxx] 前缀，[mode:chat] 只加在当前用户消息首行，避免模型模仿输出。 */
function buildChatHistory(history) {
  const msgs = (history || []).map((m) => ({ role: m.role, content: String(m.content || '').replace(/^\s*\[mode:\w+\]\s*/g, '').trim() }))
  const last = msgs[msgs.length - 1]
  if (last && last.role === 'user') last.content = `[mode:chat]\n${last.content}`
  return msgs
}

export async function sendMessage(sessionId, content) {
  let session = sessionId ? getSession(sessionId) : null
  if (!session) session = createSession(content.slice(0, 28) || '新的需求对话')
  const id = session.session.id
  db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(id, 'user', content)

  // 只取最近 12 条作为上下文，避免对话越长请求越大
  const history = db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id ASC').all(id).slice(-12)
  const ai = getAiSettings()
  let raw
  if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
    raw = await chatText(
      ai,
      [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, ...buildChatHistory(history)],
      { step: 'chat' }
    )
  } else {
    raw = fallbackReply(content)
  }

  const { text, signal } = parseSignal(raw)
  db.prepare('INSERT INTO chat_messages (session_id, role, content, thinking) VALUES (?, ?, ?, ?)').run(id, 'assistant', text, '')
  // signal 入库为待蒸馏候选，kura 意图分析在后台执行，不阻塞本次回复
  if (signal) {
    const info = db.prepare('INSERT INTO signals (session_id, content) VALUES (?, ?)').run(id, signal)
    analyzeSignal(Number(info.lastInsertRowid)).catch(() => {})
  }

  db.prepare("UPDATE chat_sessions SET title = CASE WHEN title = '新的需求对话' THEN ? ELSE title END, updated_at = datetime('now') WHERE id = ?")
    .run(content.slice(0, 28) || '需求对话', id)
  return getSession(id)
}

/** SSE 流式发送。resWrite 为向 Client SSE 写 delta 的函数 */
export async function sendMessageStream(sessionId, content, res, writeSse) {
  let session = sessionId ? getSession(sessionId) : null
  if (!session) session = createSession(content.slice(0, 28) || '新的需求对话')
  const id = session.session.id
  db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(id, 'user', content)

  // 只取最近 12 条作为上下文，避免对话越长请求越大
  const history = db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id ASC').all(id).slice(-12)
  const ai = getAiSettings()
  // 流式输出前过滤 signal 标签：delta 给前端前先过过滤器，标签绝不显示在正文里
  const sigFilter = createSignalStreamFilter((delta) => writeSse({ type: 'delta', delta }))
  let raw
  let thinkingRaw = ''
  if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
    const streamRes = await chatTextStream(
      ai,
      [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, ...buildChatHistory(history)],
      (ev) => {
        if (ev.type === 'delta') sigFilter.step(ev.delta)
        else if (ev.type === 'thinking') writeSse({ type: 'thinking', delta: ev.delta })
      },
      { step: 'chat' }
    )
    raw = streamRes.content
    thinkingRaw = streamRes.thinking || ''
  } else {
    // 无 AI，但逐字给前端伪流式体验
    const fb = fallbackReply(content)
    const chunkSize = 4
    for (let i = 0; i < fb.length; i += chunkSize) {
      sigFilter.step(fb.slice(i, i + chunkSize))
      await new Promise((r) => setTimeout(r, 8))
    }
    raw = fb
  }
  sigFilter.flush()

  const { text, signal } = parseSignal(raw)
  db.prepare('INSERT INTO chat_messages (session_id, role, content, thinking) VALUES (?, ?, ?, ?)').run(id, 'assistant', text, thinkingRaw || '')
  // signal 入库为待蒸馏候选，kura 意图分析在后台执行，不阻塞 done
  if (signal) {
    const info = db.prepare('INSERT INTO signals (session_id, content) VALUES (?, ?)').run(id, signal)
    analyzeSignal(Number(info.lastInsertRowid)).catch(() => {})
  }
  db.prepare("UPDATE chat_sessions SET title = CASE WHEN title = '新的需求对话' THEN ? ELSE title END, updated_at = datetime('now') WHERE id = ?")
    .run(content.slice(0, 28) || '需求对话', id)
  writeSse({ type: 'done', signal, text, thinking: thinkingRaw || '' })
}

export async function distillSession(sessionId) {
  const session = getSession(sessionId)
  if (!session) throw new Error('对话不存在')
  const transcript = session.messages.map((m) => `${m.role === 'user' ? '用户' : 'AI助手'}：${m.content}`).join('\n\n')
  const result = await distillFromText({ text: transcript, sourceType: 'ai_chat', sourceName: session.session.title, sourceUrl: `chat:${sessionId}` })
  // 标记该会话 signals 已蒸馏并关联机会
  const oppId = result.result?.opportunity?.id
  if (oppId) db.prepare('UPDATE signals SET distilled = 1, opportunity_id = ? WHERE session_id = ? AND distilled = 0').run(oppId, sessionId)
  return result
}
