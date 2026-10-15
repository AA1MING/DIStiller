import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'
import { Md } from '../utils/markdown.jsx'

function ChatWorkspace({ onGotoDistillery }) {
  const [sessions, setSessions] = useState(() => cachedGet('chatSessions') || [])
  const [current, setCurrent] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [streaming, setStreaming] = useState('')
  const [thinking, setThinking] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [showJump, setShowJump] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ title: '', description: '', features: '' })
  const [createError, setCreateError] = useState('')
  const createBtnRef = useRef(null)
  const cardRef = useRef(null)
  const abortRef = useRef(null)
  const streamRef = useRef(null)
  const endRef = useRef(null)
  const copyTimer = useRef(null)

  const loadSessions = useCallback(async (force) => {
    const list = await cachedFetch('chatSessions', () => api.listChatSessions(), { force })
    setSessions(list)
    // 只自动选中最近一个会话，不自动新建（新对话由用户「新建项目」或发送首条消息时创建）
    if (!current && list[0]) setCurrent(await api.getChatSession(list[0].id))
  }, [current])

  useEffect(() => {
    const cached = cachedGet('chatSessions')
    if (cached) setSessions(cached)
    loadSessions().catch((e) => setError(e.message))
  }, [])
  // 滚到最底部：双机制——直接赋值 scrollTop + 底部哨兵 scrollIntoView
  //（scrollIntoView 不依赖哪个祖先才是滚动容器，必定把底部带进视野）
  const scrollToBottomNow = () => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
    try { endRef.current?.scrollIntoView?.({ block: 'end' }) } catch {}
    setShowJump(false)
  }
  // 记录用户是否远离底部（决定「回到底部」按钮显隐）
  const onStreamScroll = (e) => {
    const el = e.currentTarget
    if (!el) return
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 400)
  }
  // 自动滚动：回复生成中（busy）始终跟随到底；新消息/流式增长时贴近底部也跟随
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (busy || nearBottom) scrollToBottomNow()
  }, [current?.messages?.length, streaming, thinking, busy])
  // 生成期间兜底轮询：即使状态更新时机有偏差，也保证一直跟随到底部
  useEffect(() => {
    if (!busy) return
    const t = setInterval(scrollToBottomNow, 400)
    return () => clearInterval(t)
  }, [busy])

  useEffect(() => {
    if (!newOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setNewOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newOpen])

  const openCreate = () => {
    setNewOpen(true)
    setCreateForm({ title: '', description: '', features: '' })
    setCreateError('')
  }

  // Dock-open: anchor the zoom at the button center (button rect is never transformed)
  useLayoutEffect(() => {
    if (!newOpen) return
    const btn = createBtnRef.current
    const card = cardRef.current
    if (!btn || !card) return
    const b = btn.getBoundingClientRect()
    card.style.setProperty('--bx', (b.left + b.width / 2) + 'px')
    card.style.setProperty('--by', (b.top + b.height / 2) + 'px')
    card.style.setProperty('--s0', (b.width / Math.min(520, window.innerWidth - 32)).toFixed(4))
  }, [newOpen])

  const copyMsg = async (m) => {
    try { await navigator.clipboard.writeText(m.content) } catch { /* 剪贴板不可用时静默 */ }
    setCopiedId(m.id)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedId(null), 1500)
  }

  const buildContext = (description, features) => {
    const parts = []
    const desc = (description || '').trim()
    const feats = (features || '').split('\n').map((x) => x.trim()).filter(Boolean)
    if (desc) parts.push('项目简介：' + desc)
    if (feats.length) parts.push('初始需求：\n' + feats.map((f) => '- ' + f).join('\n'))
    return parts.join('\n\n')
  }
  const submitCreate = async () => {
    const title = createForm.title.trim()
    if (!title) { setCreateError('请填写项目名称'); return }
    setCreateError(''); setBusy(true); setError(null)
    try {
      const s = await api.createChatSession(title)
      setCurrent(s); setNewOpen(false)
      const keep = { ...createForm }
      setCreateForm({ title: '', description: '', features: '' }); await loadSessions()
      const context = buildContext(keep.description, keep.features)
      if (context) sendContent(context, s.session.id)
      else setBusy(false)
    } catch (e) { setError(e.message); setBusy(false) }
  }
  const openSession = async (id) => { setError(null); setCurrent(await api.getChatSession(id)) }
  const removeSession = async (id) => {
    if (!confirm('确认删除该会话？删除后不可恢复。')) return
    await api.removeChatSession(id)
    const rest = sessions.filter((x) => x.id !== id)
    if (current?.session?.id === id) setCurrent(rest[0] ? await api.getChatSession(rest[0].id) : null)
    await loadSessions()
  }

  // 流式增量节流：思考过程与正文都批量合并 setState，避免长回复时每 token 一次重渲染导致卡顿
  const deltaBuf = useRef('')
  const thinkBuf = useRef('')
  const deltaTimer = useRef(null)
  const thinkTimer = useRef(null)
  const flushDelta = () => { if (deltaBuf.current) { setStreaming((p) => p + deltaBuf.current); deltaBuf.current = '' } }
  const flushThink = () => { if (thinkBuf.current) { setThinking((p) => p + thinkBuf.current); thinkBuf.current = '' } }
  const clearStreamTimers = () => {
    if (deltaTimer.current) { clearTimeout(deltaTimer.current); deltaTimer.current = null }
    if (thinkTimer.current) { clearTimeout(thinkTimer.current); thinkTimer.current = null }
  }
  // 强制滚到底部（发送新消息 / 回复落库后调用），双次延时确保 React 提交与浏览器布局完成后再滚
  const forceScrollBottom = () => {
    for (const delay of [60, 220]) {
      setTimeout(scrollToBottomNow, delay)
    }
  }

  const sendContent = async (raw, sessionIdOverride) => {
    const content = (raw || '').trim(); if (!content) return
    // 收起键盘（手机端网页）：避免虚拟键盘把消息区底部遮住
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() } catch {}
    setBusy(true); setError(null); setStreaming(''); setThinking(''); setInput('')
    // 乐观更新：立刻把用户消息显示在气泡列表里，不等 AI 回复完成
    const tmpId = `tmp-${Date.now()}`
    setCurrent((c) => (c ? { ...c, messages: [...(c.messages || []), { id: tmpId, role: 'user', content }] } : c))
    forceScrollBottom()
    try {
      let id = sessionIdOverride || current?.session?.id
      if (!id) { const s = await api.createChatSession(content.slice(0, 28)); id = s.session.id; await loadSessions() }
      abortRef.current = api.streamChatMessage(id, content,
        (delta) => {
          deltaBuf.current += delta
          if (!deltaTimer.current) deltaTimer.current = setTimeout(() => { deltaTimer.current = null; flushDelta() }, 30)
        },
        (delta) => {
          thinkBuf.current += delta
          if (!thinkTimer.current) thinkTimer.current = setTimeout(() => { thinkTimer.current = null; flushThink() }, 50)
        },
        (done) => {
          clearStreamTimers(); flushDelta(); flushThink()
          setStreaming(''); setThinking(''); loadSessions(); api.getChatSession(id).then((c) => { setCurrent(c); forceScrollBottom() }).catch(() => {}); setBusy(false)
        }
      )
    } catch (e) { setError(e.message); setBusy(false) } finally {}
  }
  const send = () => sendContent(input)
  const cancelStream = () => { if (abortRef.current) { abortRef.current.abort(); abortRef.current = null } clearStreamTimers(); flushDelta(); flushThink(); setStreaming(''); setThinking(''); setBusy(false) }

  return <>
    <div className="chat-shell">
    <div className="next-step">
      <div className="stage-body">
        <div className="reminder-title">需求蒸馏</div>
        <div className="reminder-text">与 AI 项目经理聊完需求后，对话内容可蒸馏为功能点并自动生成项目。</div>
      </div>
      <button className="btn primary" onClick={() => onGotoDistillery?.()}>下一步：需求蒸馏</button>
    </div>
    <aside className="chat-sidebar">
      <div className="chat-sidebar-head">
        <button ref={createBtnRef} className="btn primary" onClick={openCreate}>{'＋ 新建项目'}</button>
      </div>
      <div className="chat-sidebar-list">
        {sessions.length === 0 ? <div style={{ padding: 10, color: 'var(--text-mute)', fontSize: 13 }}>暂无项目，点击上方「新建项目」开始</div> : sessions.map((s) => (
          <div key={s.id} className={`chat-session ${current?.session?.id === s.id ? 'active' : ''}`} onClick={() => openSession(s.id)}>
            <div className="s-row">
              <span className="s-title">{s.title}</span>
              <span className="s-del" title="删除项目" onClick={(e) => { e.stopPropagation(); removeSession(s.id) }}>✕</span>
            </div>
            <span className="s-time">{s.updated_at}</span>
          </div>
        ))}
      </div>
    </aside>
    <div className="chat-main">
      <div className="chat-main-head">{current?.session?.title || '未选择项目'}</div>
      <div className="chat-stream" ref={streamRef} onScroll={onStreamScroll} style={{ display: 'flex', flexDirection: 'column' }}>
        {(current?.messages || []).length === 0 && !streaming && !busy
          ? <div className="chat-empty-state">开始新的对话，与 AI 项目经理讨论您的需求</div>
          : <>
            {current?.messages?.map((m) => {
              // 数据库 role 为 assistant，归一化为 ai 以匹配气泡样式
              const role = m.role === 'assistant' ? 'ai' : m.role
              return (
              <div className={`chat-row ${role}`} key={m.id}>
                <div className="chat-avatar">{role === 'user' ? '我' : 'AI'}</div>
                <div className={`chat-bubble ${role}${copiedId === m.id ? ' copied' : ''}`} onClick={() => copyMsg(m)} title="点击复制">
                  <div className="chat-role-label">{role === 'user' ? '你' : 'AI 项目经理'}</div>
                  {m.thinking && <details className="chat-thinking"><summary>思考过程</summary><pre>{m.thinking}</pre></details>}
                  <Md text={m.content} />
                  {copiedId === m.id && <div className="copied-tip">已复制</div>}
                </div>
              </div>
              )
            })}
            {(busy || streaming) && <div className="chat-row ai">
              <div className="chat-avatar">AI</div>
              <div className="chat-bubble ai">
                <div className="chat-role-label">AI 项目经理</div>
                {thinking && <details className="chat-thinking" open><summary>思考过程</summary><pre>{thinking}</pre></details>}
                {streaming ? <Md text={streaming} /> : <span className="muted">正在思考…</span>}<span className="blink">|</span>
              </div>
            </div>}
          </>
        }
        <div ref={endRef} style={{ height: 1, flexShrink: 0 }} />
      </div>
      {showJump && <button className="btn jump-bottom" onClick={scrollToBottomNow} title="回到底部">↓</button>}
      {error && <div className="alert error" style={{ margin: '0 16px' }}>{error}</div>}
      <div className="chat-input-area">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="输入消息，回车发送，Shift+Enter 换行" rows={1} />
        {busy
          ? <button className="btn chat-send-btn" onClick={cancelStream}>取消</button>
          : <button className="btn primary chat-send-btn" onClick={send} disabled={!input.trim()}>发送</button>
        }
      </div>
    </div>
    
    </div>
    {newOpen && (
      <div className="modal-overlay" onClick={() => setNewOpen(false)}>
        <div ref={cardRef} className="card modal-card create-modal" onClick={(e) => e.stopPropagation()}>
          <div className="create-card-head">
            <div>
              <h3>{'新建需求项目'}</h3>
            </div>
            <button className="chip-del" title={'收起表单'} onClick={() => setNewOpen(false)}>{'✕'}</button>
          </div>
          <div className="form-grid">
            <div className="field full"><label>{'项目名称'} <span className="req">*</span></label><input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder={'如：校园二手交易'} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') submitCreate() }} /></div>
            <div className="field full"><label>{'项目简介'}</label><textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder={'一句话说明项目定位与目标用户'} style={{ minHeight: 72 }} /></div>
            <div className="field full"><label>{'初始需求（每行一个）'}</label><textarea value={createForm.features} onChange={(e) => setCreateForm({ ...createForm, features: e.target.value })} placeholder={'需求A\n需求B\n需求C'} style={{ minHeight: 96 }} /></div>
          </div>
          {createError && <div className="field-error">{createError}</div>}
          <div className="create-card-foot">
            <button className="btn" onClick={() => setNewOpen(false)}>{'取消'}</button>
            <button className="btn primary" onClick={submitCreate} disabled={busy}>{busy ? <span className="spin" /> : null}{'创建项目'}</button>
          </div>
        </div>
      </div>
    )}
  </>
}


export default ChatWorkspace
