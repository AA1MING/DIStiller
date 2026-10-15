import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'
import MarketVisual from '../components/MarketVisual.jsx'

function AnalysisPage({ initialProjectId, onGotoDeliverables, startTask, endTask, savedResult, onResult }) {
  const [projects, setProjects] = useState(() => cachedGet('projects') || [])
  const [projectId, setProjectId] = useState(initialProjectId || '')
  const [busyAction, setBusyAction] = useState(null) // 当前进行的分析操作：market / prd / prototype
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    const cached = cachedGet('projects')
    if (cached) setProjects(cached)
    cachedFetch('projects', () => api.listProjects()).then(setProjects).catch(() => {})
  }, [])
  useEffect(() => { if (initialProjectId) setProjectId(String(initialProjectId)) }, [initialProjectId])
  // 分析必须绑定项目：无显式选择时默认选中第一个项目
  useEffect(() => { if (projects.length) setProjectId((cur) => cur || String(projects[0].id)) }, [projects])
  // 恢复全局保留的分析结果（跳转页面后返回不丢失）
  useEffect(() => { if (savedResult) setResult(savedResult) }, [savedResult])

  const run = async (kind) => {
    if (!projectId) return
    setBusyAction(kind); setErr(null); setResult(null)
    startTask?.(kind === 'market' ? '市场分析生成中…' : kind === 'prd' ? 'PRD 生成中…' : '原型生成中…')
    try {
      const r = kind === 'market' ? await api.analysisMarket(projectId) : kind === 'prd' ? await api.analysisPrd(projectId) : await api.analysisPrototype(projectId)
      setResult(r); onResult?.(r)
    } catch (e) { setErr(e.message) } finally { endTask?.(); setBusyAction(null) }
  }

  const downloadHtml = () => {
    if (!result?.html) return
    const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${result.title}.html`; a.click()
    URL.revokeObjectURL(url)
  }

  return <div style={{ maxWidth: 860, margin: '0 auto' }}>
    <div className="next-step">
      <div className="stage-body">
        <div className="reminder-title">文档生成</div>
        <div className="reminder-text">项目分析定型后，即可前往文档工作台编写项目文档。</div>
      </div>
      <button className="btn primary" onClick={() => onGotoDeliverables?.(projectId)} disabled={!projectId}>下一步：文档生成</button>
    </div>
    <div className="card">
      <h3 style={{ marginTop: 0 }}>icemark 产品分析</h3>
      <div className="form-grid">
        <div className="field"><label>选择项目</label>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setResult(null) }}>
            {projects.length === 0 && <option value="">（暂无项目，请先到项目页创建）</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => run('market')} disabled={busyAction !== null || !projectId}>{busyAction === 'market' ? <span className="spin" /> : null}市场分析</button>
        <button className="btn" onClick={() => run('prd')} disabled={busyAction !== null || !projectId}>{busyAction === 'prd' ? <span className="spin" /> : null}产品需求文档</button>
        <button className="btn" onClick={() => run('prototype')} disabled={busyAction !== null || !projectId}>{busyAction === 'prototype' ? <span className="spin" /> : null}HTML 交互原型</button>
      </div>
      
      {err && <div className="alert error">{err}</div>}
    </div>
    {result && <div className="card" style={{ marginTop: 14 }}>
      <div className="opp-head">
        <h3 style={{ margin: 0 }}>{result.title}</h3>
        {result.html && <button className="btn" onClick={downloadHtml}>下载 HTML</button>}
      </div>
      {result.data ? <MarketVisual data={result.data} /> : result.markdown
        ? <pre className="draft" style={{ maxHeight: 520, overflow: 'auto', marginTop: 10 }}>{result.markdown}</pre>
        : result.html
          ? <iframe srcDoc={result.html} title="原型预览" style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 12, background: '#faf9f5', marginTop: 10 }} />
          : null}
    </div>}
  </div>
}

/** 市场分析可视化模板：综合评分 + SWOT 四象限 + PESTEL + 波特五力评分条。 */

export default AnalysisPage
