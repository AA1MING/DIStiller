import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'
import AgentCard from '../components/AgentCard.jsx'

function PromptsPage({ startTask, endTask, savedResult, onResult }) {
  const [projects, setProjects] = useState(() => cachedGet('projects') || [])
  const [projectId, setProjectId] = useState('')
  const [templates, setTemplates] = useState(() => cachedGet('promptTemplates') || [])
  const [templateId, setTemplateId] = useState('')
  const [prompt, setPrompt] = useState(null)
  const [busyAction, setBusyAction] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const cached = cachedGet('projects')
    if (cached) setProjects(cached)
    cachedFetch('projects', () => api.listProjects()).then(setProjects).catch(() => {})
  }, [])
  useEffect(() => {
    const cached = cachedGet('promptTemplates')
    if (cached) { setTemplates(cached); if (cached.length && !templateId) setTemplateId(cached[0].id) }
    cachedFetch('promptTemplates', () => api.listPromptTemplates()).then((t) => { setTemplates(t); if (t.length && !templateId) setTemplateId(t[0].id) }).catch(() => {})
  }, [])
  // 恢复全局保留的提示词结果（跳转页面后返回不丢失）
  useEffect(() => { if (savedResult) setPrompt(savedResult) }, [savedResult])

  const generate = async () => {
    if (!projectId) { setError('请先选择项目'); return }
    if (!templateId) { setError('请先选择编程工具'); return }
    setBusyAction('generate'); setError(null); setPrompt(null); setCopied(false)
    startTask?.('提示词生成中…')
    try {
      const r = await api.generatePrompt({ projectId, templateId })
      setPrompt(r); onResult?.(r)
    } catch (e) { setError(e.message) } finally { endTask?.(); setBusyAction(null) }
  }

  const copyPrompt = async () => {
    if (!prompt?.prompt) return
    try { await navigator.clipboard.writeText(prompt.prompt) } catch { /* 剪贴板不可用时静默 */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const downloadPrompt = () => {
    if (!prompt?.prompt) return
    const blob = new Blob([prompt.prompt], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${prompt.title}-${prompt.template?.name || '提示词'}.md`; a.click()
    URL.revokeObjectURL(url)
  }

  const repoProjects = projects.filter((p) => p.source === 'repo')
  const demandProjects = projects.filter((p) => p.source !== 'repo')

  return <div style={{ maxWidth: 860, margin: '0 auto' }}>
    <div className="card">
      <h3 style={{ marginTop: 0 }}>项目开发提示词生成</h3>
      <div className="form-grid">
        <div className="field"><label>选择项目</label>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPrompt(null) }}>
            {repoProjects.length === 0 && demandProjects.length === 0
              ? <option value="">（暂无项目，请先到项目页创建）</option>
              : <option value="">请选择项目</option>}
            <optgroup label="实体项目">{repoProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</optgroup>
            <optgroup label="需求项目">{demandProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</optgroup>
          </select>
        </div>
      </div>
      <div className="agent-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 14 }}>
        {templates.map((t, idx) => (
          <AgentCard key={t.id} t={t} idx={idx} active={templateId === t.id}
            onSelect={() => { setTemplateId(t.id); setPrompt(null) }} />
        ))}
      </div>
      <button className="btn primary" onClick={generate} disabled={busyAction !== null || !projectId || !templateId} style={{ marginTop: 14 }}>{busyAction === 'generate' ? <span className="spin" /> : null}生成项目提示词</button>
      {error && <div className="alert error">{error}</div>}
    </div>

    {prompt && <div className="card" style={{ marginTop: 14 }}>
      <div className="opp-head">
        <h3 style={{ margin: 0 }}>{prompt.title} · {prompt.template?.name}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={copyPrompt}>{copied ? '已复制 ✓' : '复制提示词'}</button>
          <button className="btn" onClick={downloadPrompt}>下载 .md</button>
        </div>
      </div>
      <pre className="draft" style={{ maxHeight: 520, overflow: 'auto', marginTop: 12, whiteSpace: 'pre-wrap' }}>{prompt.prompt}</pre>
    </div>}
  </div>
}


export default PromptsPage
