import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedSet } from '../utils/cache.js'
import { fileToBase64 } from '../utils/file-utils.js'

function AdminMarketPanel() {
  const [stats, setStats] = useState(null)
  const [templates, setTemplates] = useState(() => { const d = cachedGet('market'); return d ? d.templates : null })
  const [works, setWorks] = useState(null)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addPrice, setAddPrice] = useState(50)
  const [addFile, setAddFile] = useState(null)
  const [importingId, setImportingId] = useState(null)
  const [importForm, setImportForm] = useState({})
  const [importBusyId, setImportBusyId] = useState(null)
  const load = useCallback(async () => {
    try {
      const [s, t, w] = await Promise.all([api.adminMarketStats(), api.marketTemplates(), api.adminListWorks('approved')])
      setStats(s); setTemplates(t.templates); setWorks(w.works)
      cachedSet('market', t)
    } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  const pickAddFile = async (e) => {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { setErr('模板文件不能超过 5MB'); e.target.value = ''; return }
    try { setAddFile({ name: f.name, type: f.type || 'application/octet-stream', data: await fileToBase64(f) }); setErr(null) }
    catch { setErr('读取文件失败') }
  }
  const submitAdd = async () => {
    if (!addFile) { setErr('请选择模板文件'); return }
    setAdding(true); setErr(null); setMsg(null)
    try {
      await api.adminMarketAdd({ name: addName.trim(), description: addDesc.trim(), price: Number(addPrice) || 0, filename: addFile.name, content: addFile.data })
      setMsg(`模板「${addName.trim() || addFile.name}」已上架到市场`)
      setAddName(''); setAddDesc(''); setAddPrice(50); setAddFile(null)
      load()
    } catch (e) { setErr(e.message) } finally { setAdding(false) }
  }
  const startImport = (w) => {
    setImportingId(w.id)
    setImportForm({ name: w.title, description: w.description || '', price: 50 })
  }
  const submitImport = async (w) => {
    setImportBusyId(w.id); setErr(null); setMsg(null)
    try {
      await api.adminMarketImportWork(w.id, { name: importForm.name?.trim() || w.title, description: importForm.description?.trim() || '', price: Number(importForm.price) || 0 })
      setMsg(`已把作品「${w.title}」导入为市场模板`)
      setImportingId(null); setImportForm({})
      load()
    } catch (e) { setErr(e.message) } finally { setImportBusyId(null) }
  }
  const removeTpl = async (t) => {
    if (!window.confirm(`确定从市场下架模板「${t.name}」？已兑换用户的模板库不受影响。`)) return
    setErr(null)
    try { await api.adminMarketDelete(t.id); load() } catch (e) { setErr(e.message) }
  }
  const importable = (works || []).filter((w) => w.attachment_name)
  return <div style={{ maxWidth: 1000, margin: '0 auto' }}>
    <div className="stats">
      <div className="stat"><div className="v">{stats ? stats.templates : '—'}</div><div className="k">市场模板</div></div>
      <div className="stat"><div className="v">{stats ? stats.from_works : '—'}</div><div className="k">作品导入</div></div>
      <div className="stat"><div className="v">{stats ? stats.purchases : '—'}</div><div className="k">兑换次数</div></div>
      <div className="stat"><div className="v">{stats ? stats.revenue : '—'}</div><div className="k">兑换消耗积分</div></div>
      <div className="stat"><div className="v">{stats ? stats.buyers : '—'}</div><div className="k">兑换用户</div></div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="opp-head" style={{ marginBottom: 10 }}><h3 style={{ margin: 0 }}>上架新模板</h3></div>
      <div className="form-grid">
        <div className="field"><label>模板名称</label><input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="留空则用文件名" /></div>
        <div className="field"><label>兑换价格（积分）</label><input type="number" min={0} max={1000000} value={addPrice} onChange={(e) => setAddPrice(e.target.value)} /></div>
        <div className="field full"><label>模板说明</label><textarea rows={2} value={addDesc} onChange={(e) => setAddDesc(e.target.value)} placeholder="介绍模板用途 / 适用文档类型…" /></div>
        <div className="field full"><label>模板文件 <span className="req">*</span></label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label className="btn file-btn">选择文件<input type="file" accept=".pdf,.docx,.txt,.md,.tex" style={{ display: 'none' }} onChange={pickAddFile} /></label>
            {addFile && <span className="chip acc">已选择：{addFile.name}</span>}
          </div>
        </div>
      </div>
      <button className="btn primary" onClick={submitAdd} disabled={adding || !addFile} style={{ marginTop: 10 }}>{adding ? <span className="spin" /> : null}上架到市场</button>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="opp-head" style={{ marginBottom: 10 }}><h3 style={{ margin: 0 }}>从已审核作品导入</h3></div>
      {!works ? <div className="empty"><span className="spin" /></div>
        : importable.length === 0 ? <div className="empty">暂无带附件的已通过作品，可在「作品审核」中先通过作品。</div>
        : <div className="list">{importable.map((w) => (
            <div className="opp-card" key={w.id} style={{ cursor: 'default' }}>
              <div className="opp-head">
                <div className="opp-title" style={{ flex: 1 }}>{w.title}<span className="chip" style={{ marginLeft: 8 }}>#{w.id} · {w.username}</span></div>
                {importingId !== w.id
                  ? <button className="btn" onClick={() => startImport(w)}>导入为模板</button>
                  : <button className="btn" onClick={() => setImportingId(null)}>取消</button>}
              </div>
              <div className="opp-meta"><span className="chip">附件：{w.attachment_name}（{Math.max(1, Math.round(w.attachment_size / 1024))}KB）</span>{w.created_at && <span className="chip">{w.created_at}</span>}</div>
              {importingId === w.id && <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="field"><label>模板名称</label><input value={importForm.name || ''} onChange={(e) => setImportForm({ ...importForm, name: e.target.value })} /></div>
                <div className="field"><label>兑换价格（积分）</label><input type="number" min={0} max={1000000} value={importForm.price ?? 50} onChange={(e) => setImportForm({ ...importForm, price: e.target.value })} /></div>
                <div className="field full"><label>模板说明</label><textarea rows={2} value={importForm.description || ''} onChange={(e) => setImportForm({ ...importForm, description: e.target.value })} /></div>
                <div><button className="btn primary" onClick={() => submitImport(w)} disabled={importBusyId === w.id}>{importBusyId === w.id ? <span className="spin" /> : null}确认导入</button></div>
              </div>}
            </div>
          ))}</div>}
    </div>

    <div className="card">
      <div className="opp-head" style={{ marginBottom: 10 }}><h3 style={{ margin: 0 }}>市场模板管理</h3></div>
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert info">{msg}</div>}
      {!templates ? <div className="empty"><span className="spin" /></div>
        : templates.length === 0 ? <div className="empty">市场还没有模板，先上架一个吧。</div>
        : <div className="list">{templates.map((t) => (
            <div className="task-item" key={t.id}>
              <div className="opp-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t">{t.name}</div>
                  <div className="opp-meta" style={{ marginTop: 4 }}>
                    <span className="chip acc">{t.price} 积分</span>
                    <span className="chip">{t.filename}</span>
                    {t.source_type === 'work'
                      ? <span className="chip">作品 #{t.source_work_id}（{t.source_username}）</span>
                      : <span className="chip">手动上架</span>}
                    <span className="chip">{t.created_at}</span>
                  </div>
                  {t.description && <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{t.description}</div>}
                </div>
                <button className="btn danger" onClick={() => removeTpl(t)}>下架</button>
              </div>
            </div>
          ))}</div>}
    </div>
  </div>
}

// ===== 个人中心：基本资料 / 修改密码 / 积分充值 =====

export default AdminMarketPanel
