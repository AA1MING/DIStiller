import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'
import { SOURCE_TYPES } from '../utils/constants.js'
import { arrayBufferToBase64 } from '../utils/file-utils.js'

function DistilleryPage({ onGotoProjects, startTask, endTask }) {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [includeHistory, setIncludeHistory] = useState(true)
  const [showDistilled, setShowDistilled] = useState(false)
  const [busyAction, setBusyAction] = useState(null) // run / parseFile / parsePaste / distillImport
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  // 导入素材蒸馏
  const [rawText, setRawText] = useState('')
  const [parsedText, setParsedText] = useState(null)
  const [fileName, setFileName] = useState('')
  const [sourceType, setSourceType] = useState('manual')
  const [sourceName, setSourceName] = useState('')
  const fileRef = useRef(null)

  const load = useCallback(async (force) => {
    const d = await cachedFetch('distilleryOverview', () => api.distilleryOverview(), { force })
    setData(d)
    // 默认只选未蒸馏的对话（已蒸馏的不再进入可选项）
    setSelected(new Set(d.sessions.filter((s) => s.all_distilled !== 1).map((s) => String(s.id))))
  }, [])
  useEffect(() => {
    const cached = cachedGet('distilleryOverview')
    if (cached) setData(cached)
    load().catch((e) => setError(e.message))
  }, [load])

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(String(id)) ? n.delete(String(id)) : n.add(String(id)); return n })
  const run = async () => {
    setBusyAction('run'); setError(null); setResult(null)
    startTask?.('需求蒸馏中…')
    try {
      const r = await api.distillBatch({ sessionIds: [...selected], includeHistory })
      setResult(r); await load()
    } catch (e) { setError(e.message) } finally { endTask?.(); setBusyAction(null) }
  }

  // 导入文件：docx 走 base64，其它走文本
  const handleFile = (file) => {
    setError(null); setParsedText(null)
    if (!file) return
    if (file.size > 400 * 1024 * 1024) { setError('文件过大（超过 400MB），请压缩后重试'); return }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = async () => {
      setBusyAction('parseFile')
      try {
        const isDocx = file.name.toLowerCase().endsWith('.docx')
        const content = isDocx ? arrayBufferToBase64(reader.result) : reader.result
        const r = await api.parseImport({ filename: file.name, content, format: isDocx ? 'docx' : undefined })
        setParsedText(r.text)
      } catch (e) { setError(e.message) } finally { setBusyAction(null) }
    }
    if (file.name.toLowerCase().endsWith('.docx')) reader.readAsArrayBuffer(file)
    else reader.readAsText(file, 'utf-8')
  }

  const parsePaste = async () => {
    setBusyAction('parsePaste'); setError(null); setParsedText(null)
    try { const r = await api.parseImport({ filename: '', content: rawText }); setParsedText(r.text) }
    catch (e) { setError(e.message) } finally { setBusyAction(null) }
  }

  const runImportDistill = async () => {
    if (!parsedText) return
    setBusyAction('distillImport'); setError(null)
    startTask?.('素材蒸馏中…')
    try {
      const r = await api.distillImport({ text: parsedText, sourceType, sourceName: sourceName || fileName || '导入素材' })
      setResult({ sessionCount: 0, signalCount: 0, opportunityId: r.result?.opportunity?.id, result: r.result })
    } catch (e) { setError(e.message) } finally { endTask?.(); setBusyAction(null) }
  }

  // 加载中不渲染占位框（避免闪现导致画面跳动）；失败时只显示错误提示
  if (!data) return error ? <div className="alert error">{error}</div> : null
  return <div style={{ maxWidth: 720, margin: '0 auto' }}>
    <div className="next-step">
      <div className="stage-body">
        <div className="reminder-title">{result ? '蒸馏完成' : '请先蒸馏'}</div>
        <div className="reminder-text">
          {result?.projects
            ? `已生成 ${result.count} 个项目：${result.projects.map((p) => p.title).join('、')}。一个对话对应一个项目，可前往项目页查看与调整。`
            : result
              ? `已蒸馏：${result?.result?.opportunity?.title || '需求机会'}，功能点已放入「功能点库」。`
              : '选择对话项目或导入素材，蒸馏为功能点并自动生成项目后再前往项目。'}
        </div>
      </div>
      <button className="btn primary" disabled={!result} onClick={() => onGotoProjects?.()}>下一步：项目管理</button>
    </div>
    <div className="card">
      <div className="opp-head"><h3 style={{ margin: 0 }}>需求蒸馏</h3></div>
      <div className="list" style={{ maxHeight: 360, overflow: 'auto' }}>
        {data.sessions.length === 0 ? <div className="empty">暂无对话项目，先去「项目对话」页聊几轮</div> : data.sessions.filter((s) => showDistilled || s.all_distilled !== 1).map((s) => {
          const on = selected.has(String(s.id))
          const distilled = s.all_distilled === 1
          return <div className="opp-card" key={s.id} onClick={() => !distilled && toggle(s.id)} style={{ borderColor: on ? 'var(--accent)' : undefined, background: on ? 'var(--surface-3)' : undefined, opacity: distilled ? 0.55 : 1, cursor: distilled ? 'not-allowed' : 'pointer' }}>
            <div className="opp-head"><div className="opp-title">
              <span style={{ color: on ? 'var(--accent-2)' : 'var(--text-mute)' }}>{distilled ? '已蒸馏' : (on ? '已选' : '未选')}</span> {s.title}
            </div><span className="chip">{s.message_count} 条消息</span></div>
            <div className="opp-meta">
              <span className="chip acc">{s.signal_count} signal</span>
              {distilled ? <span className="chip">已蒸馏，不可重复选择</span> : <span className="chip acc">待蒸馏</span>}
              <span className="chip muted">{s.updated_at}</span>
            </div>
            {s.signals?.length > 0 && <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>{s.signals.slice(0, 2).map((sig) => <div key={sig.id} className="muted" style={{ borderLeft: '2px solid rgba(201, 100, 66, 0.30)', paddingLeft: 8 }}>“{sig.content}”{sig.intent_category && <span className="chip" style={{ marginLeft: 6 }}>{sig.intent_category}</span>}</div>)}</div>}
          </div>
        })}
        {!showDistilled && data.sessions.some((s) => s.all_distilled === 1) && <div className="muted" style={{ padding: 8, textAlign: 'center' }}>已隐藏 {data.sessions.filter((s) => s.all_distilled === 1).length} 个已蒸馏会话</div>}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeHistory} onChange={(e) => setIncludeHistory(e.target.checked)} style={{ width: 16, height: 16 }} />
          统计并纳入全部历史 signal 作为补充证据（{data.stats.undistilledSignals} 条待蒸馏）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={showDistilled} onChange={(e) => setShowDistilled(e.target.checked)} style={{ width: 16, height: 16 }} />
          显示已蒸馏会话
        </label>
      </div>
      <button className="btn primary" onClick={run} disabled={busyAction !== null || (selected.size === 0 && !includeHistory)} style={{ marginTop: 12 }}>{busyAction === 'run' ? <span className="spin" /> : null}蒸馏对话为功能点</button>
    </div>

    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>导入素材蒸馏</h3>
      <div className="form-grid">
        <div className="field"><label>来源类型</label><select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>{SOURCE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        <div className="field"><label>来源名称（可选）</label><input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="如：用户反馈收集" /></div>
      </div>
      <div style={{ marginTop: 12 }}>
        <input ref={fileRef} type="file" accept=".txt,.md,.json,.jsonl,.csv,.docx" onChange={(e) => handleFile(e.target.files[0])} />
        {fileName && <span className="chip acc" style={{ marginLeft: 8 }}>{fileName}</span>}
      </div>
      <div className="field full" style={{ marginTop: 12 }}>
        <label>或直接粘贴素材</label>
        <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="粘贴问题、反馈、评论、对话……" style={{ minHeight: 80 }} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={parsePaste} disabled={busyAction !== null || !rawText.trim()}>{busyAction === 'parsePaste' ? <span className="spin" /> : null}解析粘贴内容</button>
        {parsedText != null && <span className="pill">已解析 {parsedText.length} 字符</span>}
        {parsedText != null && <button className="btn primary" onClick={runImportDistill} disabled={busyAction !== null}>{busyAction === 'distillImport' ? <span className="spin" /> : null}蒸馏为功能点</button>}
      </div>
    </div>

    {error && <div className="alert error">{error}</div>}
    
  </div>
}


export default DistilleryPage
