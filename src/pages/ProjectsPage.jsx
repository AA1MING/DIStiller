import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'
import { arrayBufferToBase64 } from '../utils/file-utils.js'

function ProjectsPage({ onGotoDeliverables, onGotoAnalysis, startTask, endTask }) {
  const [projects, setProjects] = useState(() => cachedGet('projects') || [])
  const [kind, setKind] = useState('demand') // demand=需求项目 / repo=实体项目(托管)
  const [busyAction, setBusyAction] = useState(null) // 当前进行中的操作标识
  const [err, setErr] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', theme: '', features: '' })
  const [editingId, setEditingId] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [addTarget, setAddTarget] = useState(null)
  const [addFeatureId, setAddFeatureId] = useState('')
  const [analysisMsg, setAnalysisMsg] = useState(null)
  const repoRef = useRef(null)
  const [repoMsg, setRepoMsg] = useState(null)
  const [expanded, setExpanded] = useState(new Set())

  const toggleExpand = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const load = useCallback(async () => { try { setProjects(await cachedFetch('projects', () => api.listProjects(), { force: true })) } catch (e) { setErr(e.message) } }, [])
  useEffect(() => {
    const cached = cachedGet('projects')
    if (cached) setProjects(cached)
    cachedFetch('projects', () => api.listProjects()).then(setProjects).catch((e) => setErr(e.message))
  }, [load])

  const readRepo = async (id) => {
    setBusyAction('readRepo'); setErr(null); setRepoMsg(null)
    startTask?.('AI 阅读项目中…')
    try { const r = await api.readRepoProject(id); setRepoMsg(`AI 阅读完成：「${r.title}」，提炼 ${r.features?.length || 0} 个功能点${r.codeLogicLength ? `，代码逻辑 ${r.codeLogicLength} 字` : ''}`); await load() } catch (e) { setErr(e.message || 'AI 阅读失败') } finally { endTask?.(); setBusyAction(null) }
  }

  const openAdd = async (id) => {
    setAddTarget(id); setAddFeatureId('')
    try { setCandidates(await api.projectCandidates(id)) } catch (e) { setErr(e.message) }
  }

  const addFeature = async () => {
    if (!addTarget || !addFeatureId) return
    setBusyAction('addFeature'); setErr(null)
    try { await api.addProjectFeature(addTarget, addFeatureId); setAddTarget(null); await load() } catch (e) { setErr(e.message) } finally { setBusyAction(null) }
  }

  const removeFeature = async (pid, fid) => {
    setBusyAction('removeFeature'); setErr(null)
    try { await api.removeProjectFeature(pid, fid); await load() } catch (e) { setErr(e.message) } finally { setBusyAction(null) }
  }

  const regenerate = async (pid) => {
    setBusyAction('regenerate'); setErr(null); setAnalysisMsg(null)
    startTask?.('重新分析中…')
    try { const r = await api.regenerateAnalysis(pid); setAnalysisMsg(`「${r.title}」需求分析已更新`); await load() } catch (e) { setErr(e.message) } finally { endTask?.(); setBusyAction(null) }
  }

  const createSubmit = async () => {
    setBusyAction('create'); setErr(null)
    try {
      const features = form.features.split(/\n/).map((s) => s.trim()).filter(Boolean).map((title) => ({ title }))
      await api.createProject({ title: form.title, description: form.description, theme: form.theme, features })
      setForm({ title: '', description: '', theme: '', features: '' }); setShowCreate(false); await load()
    } catch (e) { setErr(e.message) } finally { setBusyAction(null) }
  }

  const saveEdit = async (id) => {
    setBusyAction('saveEdit'); setErr(null)
    try { await api.updateProject(id, { title: form.title }); setEditingId(null); await load() } catch (e) { setErr(e.message) } finally { setBusyAction(null) }
  }

  const importRepoFile = (file) => {
    if (!file) return
    if (file.size > 400 * 1024 * 1024) { setErr('文件过大（超过 400MB），请先压缩项目（排除 node_modules 与图片等资源）后重试'); return }
    setRepoMsg(null); setErr(null)
    const reader = new FileReader()
    reader.onload = async () => {
      setBusyAction('importRepo')
      startTask?.('导入项目压缩包中…')
      try {
        const b64 = arrayBufferToBase64(reader.result)
        const p = await api.importRepo({ filename: file.name, content: b64 })
        setRepoMsg(`已存储实体项目「${p.title}」（${p.fileCount} 个文本文件）。点击「AI 阅读」整理代码逻辑并提炼项目信息。`)
        setKind('repo')
        await load()
      } catch (e) { setErr(e.message || '导入失败，请确认是有效的项目 zip') } finally { endTask?.(); setBusyAction(null) }
    }
    reader.readAsArrayBuffer(file)
  }

  const repoProjects = projects.filter((p) => p.source === 'repo')
  const demandProjects = projects.filter((p) => p.source !== 'repo')
  const shown = kind === 'repo' ? repoProjects : demandProjects

  return <div style={{ maxWidth: 860, margin: '0 auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={kind === 'demand' ? 'active' : ''} onClick={() => setKind('demand')}>需求项目</button>
        <button className={kind === 'repo' ? 'active' : ''} onClick={() => setKind('repo')}>实体项目</button>
      </div>
      {kind === 'demand' && <button className={'btn' + (showCreate ? '' : ' primary')} style={{ marginLeft: 'auto' }} onClick={() => setShowCreate(!showCreate)}>{showCreate ? '收起表单' : '＋ 新建项目'}</button>}
    </div>

    {kind === 'demand' && <div className="next-step">
      <div className="stage-body">
        <div className="reminder-title">产品分析</div>
        <div className="reminder-text">调整完项目功能结构后，即可开展市场分析与 PRD 生成。</div>
      </div>
      <button className="btn primary" onClick={() => onGotoAnalysis?.()}>下一步：产品分析</button>
    </div>}
    {kind === 'repo' && <div className="next-step">
      <div className="reminder-title">实体项目</div>
      <div className="reminder-text">导入项目压缩包（zip）后仅做托管存储，点击「AI 阅读」整理代码逻辑，供编写成果文档使用。</div>
      <input ref={repoRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={(e) => importRepoFile(e.target.files[0])} />
      <button className="btn primary" onClick={() => repoRef.current?.click()} disabled={busyAction !== null}>{busyAction === 'importRepo' ? <span className="spin" /> : null}导入实体项目 zip</button>
    </div>}
    {kind === 'demand' && showCreate && <div className="card create-card" style={{ marginBottom: 14 }}>
      <div className="create-card-head">
        <div>
          <h3>新建需求项目</h3>
        </div>
        <button className="chip-del" title="收起表单" onClick={() => setShowCreate(false)}>✕</button>
      </div>
      <div className="form-grid">
        <div className="field"><label>项目标题 <span className="req">*</span></label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：智能客服工作台" /></div>
        <div className="field"><label>主题</label><input value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} placeholder="如：企业服务 / AI 工具" /></div>
        <div className="field full"><label>项目简介</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="一句话说明项目定位与目标用户" /></div>
        <div className="field full"><label>功能点（每行一个）</label><textarea value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder={'功能点A\n功能点B\n功能点C'} style={{ minHeight: 110 }} /></div>
      </div>
      <div className="create-card-foot">
        <button className="btn" onClick={() => setShowCreate(false)}>取消</button>
        <button className="btn primary" onClick={createSubmit} disabled={busyAction !== null || !form.title.trim()}>{busyAction === 'create' ? <span className="spin" /> : null}创建项目</button>
      </div>
    </div>}{repoMsg && kind === 'repo' && <div className="alert info">{repoMsg}</div>}
    {analysisMsg && <div className="alert info">{analysisMsg}</div>}
    {err && <div className="alert error">{err}</div>}

    <div className="list" key={kind}>{shown.length === 0 ? <div className="empty">{kind === 'repo' ? '还没有实体项目。导入项目 zip 后托管在此，用于编写成果文档。' : '还没有需求项目。可从「需求蒸馏」生成，或新建 / 导入。'}</div> : shown.map((p, idx) => {
      const isOpen = expanded.has(p.id)
      return (
      <div className="card project-card" key={p.id} style={{ marginBottom: 14, '--i': idx }}>
        <div className="opp-head" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(p.id)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="project-title-row">
              {editingId === p.id
                ? <><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ width: 300 }} onClick={(e) => e.stopPropagation()} />
                  <button className="btn" style={{ minHeight: 30, padding: '2px 12px' }} onClick={(e) => { e.stopPropagation(); saveEdit(p.id) }} disabled={busyAction !== null}>{busyAction === 'saveEdit' ? <span className="spin" /> : null}保存</button></>
                : <>
                    <h3>{p.title}</h3>
                    <span className="edit-pencil" title="编辑项目名称" onClick={(e) => { e.stopPropagation(); setEditingId(p.id); setForm({ title: p.title }) }}>✎</span>
                    <span className="chip project-count">{p.features?.length || 0} 个功能点</span>
                  </>}
            </div>
            {/* 每个项目顶部一行简单介绍 */}
            {p.description && <div className="muted" style={{ marginTop: 6 }}>{p.description.split('\n')[0].slice(0, 120)}{p.description.split('\n')[0].length > 120 ? '…' : ''}</div>}
          </div>
          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
            {kind === 'repo' && p.repo_status !== 'read' && <button className="btn primary" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => readRepo(p.id)} disabled={busyAction !== null}>{busyAction === 'readRepo' ? <span className="spin" /> : null}AI 阅读</button>}
            {kind === 'repo' && p.repo_status === 'read' && <span className="pill" style={{ height: 26 }}>已由 AI 阅读</span>}
            <button className="icon-btn" title="删除项目" onClick={() => { if (confirm('删除该项目？功能点不会被删但关联会解除。')) { api.removeProject(p.id).then(() => load()) } }}>✕</button>
            <span className={`collapse-arrow ${isOpen ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); toggleExpand(p.id); }} title={isOpen ? '收起' : '展开'}>▾</span>
          </div>
        </div>
        {isOpen && <div className="project-body">
          {kind === 'demand' && p.description && <details style={{ marginTop: 8 }} open><summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' }}>项目需求分析</summary><pre className="draft" style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>{p.description}</pre></details>}
          {kind === 'repo' && p.repo_status === 'read' && p.code_logic && <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' }}>查看 AI 整理的代码逻辑（{p.code_logic.length} 字）</summary><pre className="draft" style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>{p.code_logic.slice(0, 4000)}{p.code_logic.length > 4000 ? '\n…（截断显示）' : ''}</pre></details>}
          {kind === 'demand' && addTarget === p.id && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <select value={addFeatureId} onChange={(e) => setAddFeatureId(e.target.value)} style={{ flex: 1 }}>
              <option value="">{candidates.length ? '选择要添加的功能点' : '没有可添加的功能点'}</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}{c.intent_category ? `（${c.intent_category}）` : ''}</option>)}
            </select>
            <button className="btn primary" onClick={addFeature} disabled={busyAction !== null || !addFeatureId || !candidates.length}>{busyAction === 'addFeature' ? <span className="spin" /> : null}添加</button>
            <button className="btn" onClick={() => setAddTarget(null)}>取消</button>
          </div>}
          {kind === 'demand' && addTarget !== p.id && <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => openAdd(p.id)}>＋ 添加功能</button>}
          <div className="project-features-head"><span>功能点</span><span className="muted">{p.features.length} 项</span></div>
          <div className="list" style={{ marginTop: 10 }}>
            {p.features.length === 0 && <div className="muted" style={{ padding: '4px 2px' }}>暂无功能点</div>}
            {p.features.map((f, fidx) => {
              const kept = f.status === 'kept'
              return <div className="task-item" key={f.id} style={{ opacity: kind === 'repo' ? 1 : (kept ? 1 : 0.45), '--i': fidx, '--o': kind === 'repo' || kept ? 1 : 0.45, borderColor: kind === 'repo' || kept ? undefined : 'var(--border-soft)' }}>
                <div className="opp-head"><div className="t">
                  {f.title}
                  {f.priority && <span className="chip">{f.priority}</span>}
                </div>
                {kind === 'demand' && <div className="task-actions">
                  <button className="btn danger" style={{ minHeight: 30, padding: '4px 10px' }} onClick={() => removeFeature(p.id, f.id)} disabled={busyAction !== null}>{busyAction === 'removeFeature' ? <span className="spin" /> : null}移除</button>
                </div>}
              </div>
              {f.description && <div className="muted" style={{ marginTop: 6 }}>{f.description}</div>}
              <div className="opp-meta">{f.opportunity_title ? <span className="chip">来源机会：{f.opportunity_title}</span> : <span className="chip">{kind === 'repo' ? '实体项目功能' : '手动录入'}</span>}{kind === 'demand' && !kept && <span className="chip">已舍弃</span>}</div>
            </div>
            })}
          </div>
        </div>}
      </div>
      )
    })}</div>
  </div>
}


export default ProjectsPage
