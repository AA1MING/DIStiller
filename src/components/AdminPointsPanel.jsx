import { useState, useEffect, useRef, useLayoutEffect, Fragment } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedSet } from '../utils/cache.js'

/** 兼容新旧数据结构：旧版 { model, pricePerM, url, key } → { model, pricePerM, urls: [{ url, keys }] } */
function normalizeModel(m) {
  if (!m || !m.model) return null
  const urls = Array.isArray(m.urls)
    ? m.urls.map((u) => ({ url: u?.url || '', keys: Array.isArray(u?.keys) ? u.keys.map((k) => String(k)) : [] }))
    : []
  if (!urls.length && (m.url || m.key)) urls.push({ url: m.url || '', keys: m.key ? [String(m.key)] : [] })
  return { model: m.model, pricePerM: Math.max(0, Number(m.pricePerM) || 0), urls }
}

function cleanModel(r) {
  return {
    model: (r.model || '').trim(),
    pricePerM: Math.max(0, Number(r.pricePerM) || 0),
    urls: (r.urls || [])
      .map((u) => ({ url: (u.url || '').trim(), keys: (u.keys || []).map((k) => String(k).trim()).filter(Boolean) }))
      .filter((u) => u.url || u.keys.length),
  }
}

/** 管理端：积分模型管理（一个模型多个 URL，一个 URL 多个 Key，轮询分流），下方展示各 URL 使用人数。 */
function AdminPointsPanel() {
  const [rows, setRows] = useState(() => {
    const d = cachedGet('pointsModels')
    return d && Array.isArray(d.models) ? d.models.map(normalizeModel).filter(Boolean) : []
  })
  const [usage, setUsage] = useState(() => {
    const d = cachedGet('pointsModels')
    return d && Array.isArray(d.usage) ? d.usage : []
  })
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState(null) // { idx: number|null, form: {model, pricePerM, urls: [{url, keys}]} }
  const [closing, setClosing] = useState(false)
  const [modalErr, setModalErr] = useState(null)
  const modalCardRef = useRef(null)
  const closeTimerRef = useRef(null)
  const openModal = (idx, form, e) => {
    const r = e?.currentTarget?.getBoundingClientRect?.()
    setClosing(false)
    setModalErr(null)
    setModal({ idx, form, origin: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, s: r.width } : null })
  }
  // Dock-open: 从触发按钮处放大进入（与新建项目弹窗一致）
  useLayoutEffect(() => {
    const card = modalCardRef.current
    if (!modal || !card) return
    const o = modal.origin
    card.style.setProperty('--bx', (o?.x ?? window.innerWidth / 2) + 'px')
    card.style.setProperty('--by', (o?.y ?? window.innerHeight / 2) + 'px')
    card.style.setProperty('--s0', Math.min(0.4, Math.max(0.06, (o?.s || 160) / 620)).toFixed(4))
  }, [modal])
  const closeModal = () => {
    if (!modal || closing) return
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setModal(null)
      setClosing(false)
    }, 170)
  }
  // 弹窗期间：Esc 关闭 + 锁定背景滚动
  useEffect(() => {
    if (!modal) return
    const onKey = (e) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    }
  }, [modal])
  const load = async () => {
    try {
      const d = await api.adminGetPointsModels()
      setRows((d.models || []).map(normalizeModel).filter(Boolean))
      setUsage(Array.isArray(d.usage) ? d.usage : [])
      cachedSet('pointsModels', d)
      setLoaded(true)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])
  const setField = (k, v) => setModal((m) => (m ? { ...m, form: { ...m.form, [k]: v } } : m))
  const setUrlField = (idx, k, v) => setModal((m) => (m ? { ...m, form: { ...m.form, urls: m.form.urls.map((u, i) => (i === idx ? { ...u, [k]: v } : u)) } } : m))
  const addUrl = () => setModal((m) => (m ? { ...m, form: { ...m.form, urls: [...m.form.urls, { url: '', keys: [] }] } } : m))
  const removeUrl = (idx) => setModal((m) => (m ? { ...m, form: { ...m.form, urls: m.form.urls.filter((_, i) => i !== idx) } } : m))
  const confirmModal = () => {
    const f = modal.form
    const model = (f.model || '').trim()
    if (!model) { setModalErr('模型名称不能为空'); return }
    const urls = (f.urls || [])
      .map((u) => ({ url: (u.url || '').trim(), keys: (u.keys || []).map((k) => String(k).trim()).filter(Boolean) }))
      .filter((u) => u.url || u.keys.length)
    if (!urls.length) { setModalErr('至少添加一个 Base URL'); return }
    if (urls.some((u) => !u.url)) { setModalErr('Base URL 不能为空'); return }
    if (urls.some((u) => !u.keys.length)) { setModalErr('每个接口至少需要一个 API Key'); return }
    if (rows.some((r, idx) => r.model === model && idx !== modal.idx)) { setModalErr(`模型「${model}」已存在`); return }
    setModalErr(null)
    setRows((rs) => {
      const next = { model, pricePerM: Math.max(0, Number(f.pricePerM) || 0), urls }
      if (modal.idx === null) return [...rs, next]
      return rs.map((r, idx) => (idx === modal.idx ? next : r))
    })
    setModal(null)
    setClosing(false)
  }
  const save = async () => {
    const clean = rows.map(cleanModel)
    if (clean.some((r) => !r.model)) { setErr('模型名称不能为空'); return }
    if (clean.some((r) => !r.urls.length)) { setErr('每个模型至少需要一个 Base URL'); return }
    if (clean.some((r) => r.urls.some((u) => !u.url))) { setErr('Base URL 不能为空'); return }
    if (clean.some((r) => r.urls.some((u) => !u.keys.length))) { setErr('每个接口至少需要一个 API Key'); return }
    const names = clean.map((r) => r.model)
    if (new Set(names).size !== names.length) { setErr('模型名称不能重复'); return }
    setSaving(true); setErr(null); setMsg(null)
    try {
      const d = await api.adminSavePointsModels(clean)
      setRows((d.models || []).map(normalizeModel).filter(Boolean))
      setUsage(Array.isArray(d.usage) ? d.usage : [])
      cachedSet('pointsModels', d)
      setMsg('已保存')
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const usageMap = new Map()
  for (const u of usage) usageMap.set(`${u.model}\0${u.url}`, u)
  const usageOf = (model, url) => usageMap.get(`${model}\0${url}`) || { users: 0, calls: 0 }
  return <div style={{ maxWidth: 980, margin: '0 auto' }}>
    <div className="card">
      <div className="opp-head" style={{ marginBottom: 6 }}><h3 style={{ margin: 0 }}>模型管理</h3></div>
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert info">{msg}</div>}
      {!loaded && rows.length === 0 ? <div className="empty"><span className="spin" /></div>
        : rows.length === 0 ? <div className="empty">还没有配置积分模型，先添加一个吧。</div>
        : <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', width: '24%' }}>模型 / 价格</th>
              <th style={{ padding: '6px 8px' }}>接口 URL（Key 数）</th>
              <th style={{ padding: '6px 8px', width: '14%' }}>使用人数</th>
              <th style={{ padding: '6px 8px', width: '14%' }}>调用次数</th>
              <th style={{ padding: '6px 8px', width: '14%' }}></th>
            </tr></thead>
            <tbody>{rows.map((r, i) => (
              <Fragment key={i}>
                {(r.urls.length ? r.urls : [{ url: '', keys: [] }]).map((u, ui) => (
                  <tr key={ui} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    {ui === 0 && <td rowSpan={Math.max(1, r.urls.length)} style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600 }}>{r.model}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.pricePerM} 积分 / 1M token</div>
                    </td>}
                    <td style={{ padding: '6px 8px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.url}>
                      {u.url}<span className="chip" style={{ marginLeft: 6 }}>{u.keys.length} 个 Key</span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{usageOf(r.model, u.url).users} 人</td>
                    <td style={{ padding: '6px 8px' }}>{usageOf(r.model, u.url).calls} 次</td>
                    {ui === 0 && <td rowSpan={Math.max(1, r.urls.length)} style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      <button className="btn" onClick={(e) => openModal(i, { ...r, urls: r.urls.map((x) => ({ url: x.url, keys: [...x.keys] })) }, e)}>编辑</button>{' '}
                      <button className="btn" style={{ color: 'var(--danger, #c0392b)' }} onClick={() => { setErr(null); setRows((rs) => rs.filter((_, idx) => idx !== i)) }}>删除</button>
                    </td>}
                  </tr>
                ))}
              </Fragment>
            ))}</tbody>
          </table>}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="btn" disabled={!loaded} onClick={(e) => openModal(null, { model: '', pricePerM: 100, urls: [{ url: '', keys: [] }] }, e)}>+ 添加模型</button>
        <button className="btn primary" onClick={save} disabled={saving || rows.length === 0}>{saving ? <span className="spin" /> : null}保存配置</button>
      </div>
    </div>
    {modal && <div className={'app-modal-anim' + (closing ? ' pm-overlay-out' : '')} style={{ position: 'fixed', inset: 0, background: 'rgba(10, 10, 9, 0.52)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={closeModal}>
      <div ref={modalCardRef} className={'app-modal-card-anim' + (closing ? ' pm-card-out' : '')} style={{ width: 'min(620px, 94vw)', maxHeight: '88vh', background: 'var(--surface)', borderRadius: 18, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 30px 80px rgba(0,0,0,0.42), 0 0 0 1px var(--border-soft)' }} onClick={(e) => e.stopPropagation()}>
        <div className="create-card-head" style={{ padding: '20px 22px 0', marginBottom: 0 }}>
          <div>
            <h3>{modal.idx === null ? '添加模型' : '编辑模型'}</h3>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>配置模型名称、价格与多个接口，保存后用户端价格表同步生效</div>
          </div>
          <button className="chip-del" title="关闭" onClick={closeModal} style={{ fontSize: 15, padding: '5px 8px' }}>✕</button>
        </div>
        <div style={{ padding: '18px 22px 22px', overflowY: 'auto' }}>
          <div className="pm-section-title" style={{ marginBottom: 8 }}>基本信息</div>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 170px' }}>
            <div className="field"><label>模型名称 <span className="req">*</span></label><input value={modal.form.model} onChange={(e) => setField('model', e.target.value)} placeholder="如 gpt-4o" autoFocus autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter') confirmModal() }} /></div>
            <div className="field"><label>价格（积分 / 1M token）</label><input type="number" min={0} step={1} value={modal.form.pricePerM} onChange={(e) => setField('pricePerM', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmModal() }} /></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <div className="pm-section-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="pm-section-title">接口与 Key</span>
                <span className="pm-count-chip">接口 {modal.form.urls.length}</span>
                <span className="pm-count-chip">Key {modal.form.urls.reduce((n, u) => n + (u.keys || []).filter((k) => String(k).trim()).length, 0)}</span>
              </div>
              <button className="btn" style={{ minHeight: 28, padding: '2px 12px' }} onClick={addUrl}>+ 添加接口</button>
            </div>
            <div className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>每行一个 Key，请求自动在多个接口与 Key 之间轮询分流</div>
            {modal.form.urls.length === 0 ? (
              <div className="pm-url-empty">
                还没有接口，点击「+ 添加接口」配置第一个 Base URL 与 API Key
              </div>
            ) : modal.form.urls.map((u, i) => (
              <div key={i} className="pm-url-block" style={{ ['--i']: i }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <label className="pm-f-label" style={{ margin: 0 }}>Base URL</label>
                  <button className="chip-del" title="删除接口" onClick={() => removeUrl(i)} style={{ fontSize: 15, padding: '4px 7px' }}>✕</button>
                </div>
                <input value={u.url} onChange={(e) => setUrlField(i, 'url', e.target.value)} placeholder="https://api.example.com/v1" autoComplete="off" />
                <label className="pm-f-label">API Key（每行一个）</label>
                <textarea rows={2} style={{ width: '100%', minHeight: 64, resize: 'vertical' }} value={(u.keys || []).join('\n')} onChange={(e) => setUrlField(i, 'keys', e.target.value.split('\n'))} placeholder={'sk-xxx\nsk-yyy'} autoComplete="off" />
              </div>
            ))}
          </div>
          {modalErr && <div className="field-error">{modalErr}</div>}
          <div className="create-card-foot" style={{ marginTop: 20 }}>
            <button className="btn" onClick={closeModal}>取消</button>
            <button className="btn primary" style={{ minWidth: 108 }} onClick={confirmModal}>确认</button>
          </div>
        </div>
      </div>
    </div>}
  </div>
}

export default AdminPointsPanel
