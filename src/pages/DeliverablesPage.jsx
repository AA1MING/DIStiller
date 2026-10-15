import { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedSet, cachedFetch } from '../utils/cache.js'
import { fileToBase64 } from '../utils/file-utils.js'
import { Section } from '../utils/markdown.jsx'

function DeliverablesPage({ initialProjectId, startTask, endTask, savedResult, onResult, onGotoPrompts }) {
  const [templates, setTemplates] = useState(() => cachedGet('templates') || [])
  const [projects, setProjects] = useState(() => cachedGet('projects') || [])
  const [templateId, setTemplateId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [extra, setExtra] = useState('')
  const [result, setResult] = useState(null)
  const [chatMsgs, setChatMsgs] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [exportFormat, setExportFormat] = useState('md')
  const [versions, setVersions] = useState([])
  const [busyAction, setBusyAction] = useState(null) // generate / saveFinal / download / removeTemplate / downloadTemplate
  const [error, setError] = useState(null)
  const [savedMsg, setSavedMsg] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showMarket, setShowMarket] = useState(false)
  const [marketData, setMarketData] = useState(() => cachedGet('market') || null)
  const [marketPreview, setMarketPreview] = useState(null)
  const fileRef = useRef(null)

  const loadTemplates = async (force) => { try { const t = await cachedFetch('templates', () => api.listTemplates(), { force }); setTemplates(t); if (templateId && !t.some((x) => String(x.id) === String(templateId))) setTemplateId(''); else if (!templateId && t.length) setTemplateId(t[0].id) } catch {} }
  const loadProjects = async (force) => { try { const list = await cachedFetch('projects', () => api.listProjects(), { force }); setProjects(list) } catch {} }
  const loadMarket = async (force) => { try { const d = await cachedFetch('market', () => api.marketTemplates(), { force }); setMarketData(d) } catch {} }
  const loadVersions = async () => { try { const v = await api.listDeliverableVersions(projectId || undefined); setVersions(v); cachedSet(`deliverableVersions:${projectId || ''}`, v) } catch {} }
  useEffect(() => {
    if (!cachedGet('projects')) loadProjects()
    else cachedFetch('projects', () => api.listProjects()).then(setProjects).catch(() => {})
    if (!cachedGet('market')) loadMarket()
    else cachedFetch('market', () => api.marketTemplates()).then(setMarketData).catch(() => {})
    const cachedVersions = cachedGet(`deliverableVersions:${projectId || ''}`)
    if (cachedVersions) setVersions(cachedVersions)
    loadVersions()
  }, [])
  useEffect(() => { if (initialProjectId) setProjectId(String(initialProjectId)) }, [initialProjectId])
  // 恢复全局保留的生成结果（跳转页面后返回不丢失）
  useEffect(() => { if (savedResult) setResult(savedResult) }, [savedResult])
  useEffect(() => { loadTemplates() }, [templateId])
  useEffect(() => { loadVersions() }, [projectId])

  // 项目下拉按类型分组：实体项目（source=repo）优先
  const repoProjects = projects.filter((p) => p.source === 'repo')
  const demandProjects = projects.filter((p) => p.source !== 'repo')

  const uploadTemplate = async (file) => {
    setUploading(true); setError(null)
    try {
      const content = await fileToBase64(file)
      const name = uploadName.trim() || (file.name || '模板').replace(/\.[^.]+$/, '')
      const created = await api.createTemplate({ name, filename: file.name, content })
      setTemplateId(created.id)
      setUploadName(''); setShowUpload(false)
      await loadTemplates()
    } catch (e) { setError(e.message) } finally { setUploading(false) }
  }

  const removeTemplate = async (id) => {
    setBusyAction('removeTemplate'); setError(null)
    try { await api.removeTemplate(id); if (String(templateId) === String(id)) setTemplateId(''); await loadTemplates() }
    catch (e) { setError(e.message) } finally { setBusyAction(null) }
  }

  const generate = async () => {
    if (!projectId) { setError('请先选择项目'); return }
    setBusyAction('generate'); setError(null); setResult(null); setSavedMsg(null); setChatMsgs([])
    startTask?.('文档生成中…')
    try { const r = await api.generateDeliverable({ templateId: templateId || null, projectId: projectId || null, extra: extra.trim() ? { notes: extra.trim() } : {} }); setResult(r); onResult?.(r); await loadVersions() }
    catch (e) { setError(e.message) } finally { endTask?.(); setBusyAction(null) }
  }

  const saveFinal = async () => {
    if (!result) return
    setBusyAction('saveFinal'); setError(null)
    try { await api.saveDeliverable({ kind: result.templateName || '成果', projectId: projectId || null, title: result.title, html: result.html }); setSavedMsg('最终版本已保存'); await loadVersions() }
    catch (e) { setError(e.message) } finally { setBusyAction(null) }
  }

  /** 载入历史版本到预览继续编辑。 */
  const loadVersion = async (v) => {
    if (!v.html) return
    setResult((prev) => { const merged = { ...(prev || {}), html: v.html, title: v.title, templateName: (prev?.templateName) || '成果', version: v.version }; onResult?.(merged); return merged })
    setChatMsgs([]); setSavedMsg(null); setError(null)
  }

  /** 删除单个历史版本。 */
  const removeVersion = async (id) => {
    setBusyAction('removeVersion'); setError(null)
    try { await api.removeDeliverableVersion(id); await loadVersions() } catch (e) { setError(e.message) } finally { setBusyAction(null) }
  }

  /** 按选择格式（md/docx/pdf/tex）导出下载。 */
  const downloadFormat = async () => {
    if (!result) return
    setBusyAction('download'); setError(null)
    startTask?.('文档导出中…')
    try {
      const r = await api.exportDeliverable({ templateId: templateId || null, projectId: projectId || null, html: result.html, title: result.title, format: exportFormat })
      const bytes = Uint8Array.from(atob(r.content), (c) => c.charCodeAt(0))
      saveBlob(new Blob([bytes], { type: r.mime }), r.filename)
    } catch (e) { setError(e.message) } finally { endTask?.(); setBusyAction(null) }
  }

  /** AI 对话式修改文档：把最新意见与历史一起发给 icemark 重写。 */
  const sendChat = async () => {
    const msg = chatInput.trim(); if (!msg || !result) return
    setChatMsgs((m) => [...m, { role: 'user', content: msg }])
    setChatInput(''); setChatBusy(true); setError(null)
    startTask?.('AI 修改文档中…')
    try {
      const r = await api.chatDeliverable({ templateId: templateId || null, projectId: projectId || null, html: result.html, history: chatMsgs.slice(-6), message: msg })
      setResult((prev) => { const next = { ...prev, html: r.markdown }; onResult?.(next); return next })
      setChatMsgs((m) => [...m, { role: 'ai', content: r.note || '已根据您的意见更新文档' }])
      await loadVersions()
    } catch (e) { setChatMsgs((m) => [...m, { role: 'ai', content: `修改失败：${e.message}` }]); setError(e.message) } finally { endTask?.(); setChatBusy(false) }
  }

  const saveBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadTemplate = async (t) => {
    setBusyAction('downloadTemplate'); setError(null)
    try {
      const d = await api.downloadTemplate(t.id)
      if (d.raw) {
        const bytes = Uint8Array.from(atob(d.raw), (c) => c.charCodeAt(0))
        saveBlob(new Blob([bytes]), d.filename || `${d.name}.bin`)
      } else {
        saveBlob(new Blob([d.content], { type: 'text/markdown;charset=utf-8' }), `${d.name}.txt`)
      }
    } catch (e) { setError(e.message) } finally { setBusyAction(null) }
  }

  /** 模板市场：预览（版式 iframe / 文本结构）。 */
  const previewMarket = async (t) => {
    setError(null)
    try { setMarketPreview(await api.marketPreview(t.id)) } catch (e) { setError(e.message) }
  }
  /** 模板市场：积分兑换，成功后模板直接进入我的模板库。 */
  const purchaseMarket = async (t) => {
    if (!window.confirm(`确定用 ${t.price} 积分兑换模板「${t.name}」？兑换后模板将加入你的模板库。`)) return
    setBusyAction('purchaseMarket'); setError(null); setSavedMsg(null)
    try {
      const r = await api.marketPurchase(t.id)
      setSavedMsg(`已用 ${r.price} 积分兑换「${r.name}」，模板已加入模板库`)
      await Promise.all([loadTemplates(true), loadMarket(true)])
      setShowMarket(false)
      try { cachedSet('points', await api.pointsMe()) } catch {}
    } catch (e) { setError(e.message) } finally { setBusyAction(null) }
  }

  const selectedTemplate = templates.find((t) => String(t.id) === String(templateId))
  const fmtLabel = (fname) => (/\\.tex$/i.test(fname) ? 'LaTeX' : /\\.docx$/i.test(fname) ? 'Word' : /\\.pdf$/i.test(fname) ? 'PDF' : /\\.md$/i.test(fname) ? 'Markdown' : '文本')
  const isTexTemplate = !!selectedTemplate && /\\.tex$/i.test(selectedTemplate.filename || '')
  // .tex 模板生成的文档仅支持导出 PDF（LaTeX 编译）
  useEffect(() => { if (isTexTemplate && exportFormat !== 'pdf') setExportFormat('pdf') }, [isTexTemplate])

  return <div style={{ maxWidth: 860, margin: '0 auto' }}>
    <div className="next-step">
      <div className="stage-body">
        <div className="reminder-title">提示词生成</div>
        <div className="reminder-text">完成文档编写与导出后，可为 AI 编程 Agent 生成项目开发提示词；生成与修改的历史版本都会自动保存。</div>
      </div>
      <button className="btn primary" onClick={() => onGotoPrompts?.()}>下一步：提示词生成</button>
    </div>
    <div className="card">
     <div className="opp-head" style={{ marginBottom: 10 }}>
       <h3 style={{ margin: 0 }}>文档工作台</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={() => setShowMarket(true)}>模板市场</button>
          <button className="btn" onClick={() => setShowUpload((v) => !v)} disabled={uploading}>{uploading ? <span className="spin" /> : (showUpload ? '收起' : '＋ 上传模板')}</button>
        </div>
       <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.tex" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadTemplate(f); e.target.value = '' }} />
      </div>
      {showUpload && <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', padding: 12, border: '1px dashed var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
        <span className="muted">模板名称：</span>
        <input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="留空则用文件名" style={{ maxWidth: 260 }} autoFocus />
        <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading}>选择文件上传</button>
        {uploading && <span className="chip acc">正在解析并提炼 HTML 模板…</span>}
      </div>}
      <Section title="模板库">
        {templates.length === 0 ? (
          <div className="empty"><div className="big">模板</div>还没有模板，点击右上角「上传模板」添加（支持 pdf / docx / txt / md）。<br />没有模板时无法生成成果。</div>
        ) : (
          <div className="list">{templates.map((t) => {
            const active = String(t.id) === String(templateId)
            return (
              <div className="task-item" key={t.id}
                onClick={() => { setTemplateId(t.id); setResult(null); setSavedMsg(null) }}
                style={{ cursor: 'pointer', borderColor: active ? 'var(--accent)' : undefined, background: active ? 'var(--surface-3)' : undefined }}>
                <div className="opp-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {active && <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="t">{t.name}</div>
                      <div className="opp-meta" style={{ marginTop: 4 }}><span className="chip acc">{fmtLabel(t.filename)}</span></div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={(e) => { e.stopPropagation(); downloadTemplate(t) }} disabled={busyAction !== null}>{busyAction === 'downloadTemplate' ? <span className="spin" /> : null}下载</button>
                    <button className="chip-del" title="删除模板" onClick={(e) => { e.stopPropagation(); if (confirm(`删除模板「${t.name}」？`)) removeTemplate(t.id) }}>✕</button>
                  </div>
                </div>
              </div>
            )
          })}</div>
        )}
      </Section>

      {selectedTemplate && <div className="form-grid" style={{ marginTop: 14 }}>
        <div className="field"><label>选择项目</label>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setResult(null) }}>
            {repoProjects.length === 0 && demandProjects.length === 0
              ? <option value="">（暂无项目，请先到项目页创建）</option>
              : <option value="">请选择项目</option>}
            <optgroup label="实体项目">{repoProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</optgroup>
            <optgroup label="需求项目">{demandProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</optgroup>
          </select>
        </div>
        <div className="field"><label>补充说明（可选）</label>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="例如：面向本科生的课程设计、要求 3000 字以上…" />
        </div>
      </div>}

      {selectedTemplate && <button className="btn primary" onClick={generate} disabled={busyAction !== null || !projectId} style={{ marginTop: 14 }}>{busyAction === 'generate' ? <span className="spin" /> : null}生成文档</button>}
      {error && <div className="alert error">{error}</div>}
      {savedMsg && <div className="alert info">{savedMsg}</div>}
    </div>

    {result && <div className="card" style={{ marginTop: 14 }}>
      <div className="opp-head">
        <h3 style={{ margin: 0 }}>{result.title} {result.version > 1 ? `· v${result.version}` : ''}</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} style={{ width: 140 }} disabled={isTexTemplate}>
            {isTexTemplate
              ? <option value="pdf">PDF（LaTeX）</option>
              : <>
                  <option value="md">Markdown</option>
                  <option value="docx">Word (.docx)</option>
                  <option value="pdf">PDF（LaTeX）</option>
                  <option value="tex">LaTeX (.tex)</option>
                </>}
          </select>
          <button className="btn" onClick={downloadFormat} disabled={busyAction !== null}>{busyAction === 'download' ? <span className="spin" /> : null}下载</button>
          <button className="btn" onClick={saveFinal} disabled={busyAction !== null}>{busyAction === 'saveFinal' ? <span className="spin" /> : null}保存最终版</button>
        </div>
      </div>
      <iframe srcDoc={result.html} title="文档预览" style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 12, background: '#faf9f5', marginTop: 10 }} />
      <Section title="AI 修改对话">
        <div className="chat-stream" style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', padding: '8px 2px' }}>
          {chatMsgs.length === 0 && <div className="chat-empty-state" style={{ padding: '18px 0' }}>输入修改意见，AI 会保持模板结构重写文档，可多轮对话。</div>}
          {chatMsgs.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.role}`} style={{ maxWidth: '88%', padding: '9px 12px', fontSize: 13, marginBottom: 8 }}>
              <div className="chat-role-label">{m.role === 'user' ? '你' : 'AI'}</div>{m.content}
            </div>
          ))}
          {chatBusy && <div className="chat-bubble ai" style={{ maxWidth: '88%', padding: '9px 12px', fontSize: 13 }}><span className="blink">正在修改…</span></div>}
        </div>
        <div className="chat-input-area" style={{ padding: '10px 0 0', borderTop: 0, background: 'transparent' }}>
          <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }} placeholder="例如：第三章补充性能指标、开头精简到半页、把技术栈换成 Vue…" style={{ minHeight: 46 }} rows={1} />
          <button className="btn primary chat-send-btn" onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>{chatBusy ? <span className="spin" /> : null}{chatBusy ? '修改中' : '发送'}</button>
        </div>
      </Section>
    </div>}

    {versions.length > 0 && <div className="card" style={{ marginTop: 14 }}>
      <div className="opp-head"><h3 style={{ margin: 0 }}>生成历史</h3><span className="pill">{versions.length} 个版本</span></div>
      <div className="list" style={{ marginTop: 10 }}>{versions.map((v) => (
        <div className="task-item" key={v.id}>
          <div className="opp-head"><div className="t">{v.title} · v{v.version}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {v.html && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => loadVersion(v)}>载入</button>}
              <button className="chip-del" title="删除历史版本" onClick={() => { if (confirm(`删除历史版本「${v.title} · v${v.version}」？`)) removeVersion(v.id) }}>✕</button>
            </div>
          </div>
          <div className="opp-meta"><span className="chip">{v.created_at}</span>{v.feedback && <span className="chip">修改：{v.feedback.slice(0, 50)}</span>}</div>
        </div>
      ))}</div>
    </div>}
    {showMarket && <div className="app-modal-anim" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setShowMarket(false)}>
      <div className="app-modal-card-anim" style={{ width: 'min(860px, 94vw)', maxHeight: '88vh', background: 'var(--surface)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }} onClick={(e) => e.stopPropagation()}>
        <div className="opp-head" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h4 style={{ margin: 0 }}>模板市场</h4>
            <div className="opp-meta" style={{ marginTop: 5 }}>
              <span className="chip acc">当前积分：{marketData ? marketData.balance : '—'}</span>
            </div>
          </div>
          <button className="btn" style={{ minHeight: 28, padding: '2px 14px', flexShrink: 0 }} onClick={() => setShowMarket(false)}>关闭</button>
        </div>
        <div style={{ overflow: 'auto', padding: 14 }}>
          {error && <div className="alert error" style={{ marginBottom: 10 }}>{error}</div>}
          {!marketData ? <div className="empty"><span className="spin" /></div>
            : marketData.templates.length === 0 ? <div className="empty">市场还没有模板。</div>
            : <div className="list">{marketData.templates.map((t) => (
                <div className="task-item" key={t.id}>
                  <div className="opp-head">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="t">{t.name}</div>
                      <div className="opp-meta" style={{ marginTop: 4 }}>
                        <span className="chip acc">{t.price} 积分</span>
                        <span className="chip">{fmtLabel(t.filename)}</span>
                        {t.source_type === 'work' && <span className="chip">作品导入</span>}
                      </div>
                      {t.description && <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{t.description}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => previewMarket(t)}>预览</button>
                      {t.purchased
                        ? <span className="chip" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}>已兑换</span>
                        : <button className="btn primary" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => purchaseMarket(t)} disabled={busyAction !== null}>{busyAction === 'purchaseMarket' ? <span className="spin" /> : null}兑换</button>}
                    </div>
                  </div>
                </div>
              ))}</div>}
        </div>
      </div>
    </div>}
    {marketPreview && <div className="app-modal-anim" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setMarketPreview(null)}>
      <div className="app-modal-card-anim" style={{ width: 'min(920px, 94vw)', maxHeight: '88vh', background: 'var(--surface)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }} onClick={(e) => e.stopPropagation()}>
        <div className="opp-head" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h4 style={{ margin: 0 }}>{marketPreview.name}</h4>
            <div className="opp-meta" style={{ marginTop: 5 }}>
              <span className="chip acc">{marketPreview.price} 积分</span>
              <span className="chip">{fmtLabel(marketPreview.filename)}</span>
            </div>
            {marketPreview.description && <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{marketPreview.description}</div>}
          </div>
          <button className="btn" style={{ minHeight: 28, padding: '2px 14px', flexShrink: 0 }} onClick={() => setMarketPreview(null)}>关闭</button>
        </div>
        {marketPreview.html_template
          ? <iframe srcDoc={marketPreview.html_template} title="模板市场预览" style={{ flex: 1, border: 0, width: '100%', minHeight: 420, background: '#faf9f5' }} />
          : <pre style={{ flex: 1, overflow: 'auto', padding: 18, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7 }}>{marketPreview.content}</pre>}
      </div>
    </div>}
  </div>
}


export default DeliverablesPage
