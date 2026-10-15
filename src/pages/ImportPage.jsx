import { useState, useRef } from 'react'
import { api } from '../api.js'
import { SOURCE_TYPES } from '../utils/constants.js'
import { arrayBufferToBase64 } from '../utils/file-utils.js'

function ImportPage({ onOpportunityCreated }) {
  const [sourceType, setSourceType] = useState('manual')
  const [sourceName, setSourceName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [rawText, setRawText] = useState('')
  const [parsedText, setParsedText] = useState(null)
  const [busyAction, setBusyAction] = useState(null) // parseFile / parsePaste / distill
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const handleFile = (file) => {
    setError(null); setParsedText(null)
    if (!file) return
    if (file.size > 400 * 1024 * 1024) { setError('文件过大（超过 400MB），请压缩后重试'); return }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = async () => {
      setBusyAction('parseFile')
      try {
        // docx 二进制走 base64；其它走文本
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

  const runDistill = async () => {
    setBusyAction('distill'); setError(null)
    try {
      const r = await api.distillImport({ text: parsedText, sourceType, sourceName: sourceName || fileName || '导入素材', sourceUrl })
      onOpportunityCreated(r.result?.opportunity?.id)
    } catch (e) { setError(e.message) } finally { setBusyAction(null) }
  }

  return <div style={{ maxWidth: 760, margin: '0 auto' }}>
    <div className="card">
      <h3 style={{ marginTop: 0 }}>导入蒸馏</h3>
      <div className="form-grid">
        <div className="field"><label>来源类型</label><select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>{SOURCE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        <div className="field"><label>来源名称</label><input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="如：ChatGPT 对话导出 / 竞品评论" /></div>
        <div className="field full"><label>来源链接</label><input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="可选 https://..." /></div>
      </div>
      <div style={{ marginTop: 14 }}>
        <input ref={fileRef} type="file" accept=".txt,.md,.json,.jsonl,.csv,.docx" onChange={(e) => handleFile(e.target.files[0])} />
        {fileName && <span className="chip acc" style={{ marginLeft: 8 }}>{fileName}</span>}
      </div>
      <div className="field full" style={{ marginTop: 12 }}>
        <label>或直接粘贴素材</label>
        <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="粘贴对话、问题、反馈、评论……（支持粘贴 json / 纯文本）" style={{ minHeight: 90 }} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="btn" onClick={parsePaste} disabled={busyAction !== null || !rawText.trim()}>{busyAction === 'parsePaste' ? <span className="spin" /> : null}解析粘贴内容</button>
      </div>
      {error && <div className="alert error">{error}</div>}
    </div>

    {parsedText != null && <div className="card" style={{ marginTop: 14 }}>
      <div className="opp-head"><h3 style={{ margin: 0 }}>解析预览</h3><span className="pill">{parsedText.length} 字符</span></div>
      <pre className="draft" style={{ maxHeight: 320, overflow: 'auto', marginTop: 10 }}>{parsedText.slice(0, 4000)}{parsedText.length > 4000 ? '\n…（截断显示）' : ''}</pre>
      <button className="btn primary" onClick={runDistill} disabled={busyAction !== null} style={{ marginTop: 10 }}>{busyAction === 'distill' ? <span className="spin" /> : null}蒸馏为机会</button>
    </div>}
  </div>
}


export default ImportPage
