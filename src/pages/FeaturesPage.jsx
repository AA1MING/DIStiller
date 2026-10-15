import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'
import { Section } from '../utils/markdown.jsx'

function FeaturesPage() {
  const [list, setList] = useState(() => cachedGet('features') || [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [genTitle, setGenTitle] = useState('')
  const [onlyFav, setOnlyFav] = useState(false)

  const load = useCallback(async () => { try { setList(await cachedFetch('features', () => api.listFeatures(), { force: true })) } catch (e) { setErr(e.message) } }, [])
  useEffect(() => {
    const cached = cachedGet('features')
    if (cached) setList(cached)
    cachedFetch('features', () => api.listFeatures()).then(setList).catch((e) => setErr(e.message))
  }, [load])

  const toggleFav = async (f) => { try { await api.setFeatureFavorite(f.id, !f.favorite); load() } catch (e) { setErr(e.message) } }
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const delFeature = async (f) => {
    if (!window.confirm(`确定删除功能点「${f.title}」？删除后不可恢复。`)) return
    setErr(null)
    try { await api.deleteFeature(f.id); load() } catch (e) { setErr(e.message) }
  }

  const genProject = async () => {
    if (!selected.size) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const p = await api.generateProject({ title: genTitle.trim() || '整合项目', featureIds: [...selected] })
      setMsg(`已生成项目「${p.title}」（${p.featureCount} 个功能点），可在「项目」页查看与进一步分析`)
      setSelected(new Set()); setGenTitle(''); load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  // 按对话项目（来源会话）分组；无会话关联的归「其他来源」
  const groups = useMemo(() => {
    const g = {}
    for (const f of list) {
      if (onlyFav && !f.favorite) continue
      const key = f.session_title || '其他来源'
      ;(g[key] = g[key] || []).push(f)
    }
    return Object.entries(g)
  }, [list, onlyFav])

  return <div style={{ maxWidth: 860, margin: '0 auto' }}>
    <div className="card">
      <div className="opp-head"><h3 style={{ margin: 0 }}>功能点库</h3><span className="pill">{list.length} 个 · 保留 {list.filter((f) => f.status === 'kept').length}{onlyFav ? ` · 收藏 ${list.filter((f) => f.favorite).length}` : ''}</span></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button className={`btn ${!onlyFav ? 'primary' : ''}`} style={{ minHeight: 30, padding: '4px 12px' }} onClick={() => setOnlyFav(false)}>全部</button>
        <button className={`btn ${onlyFav ? 'primary' : ''}`} style={{ minHeight: 30, padding: '4px 12px' }} onClick={() => setOnlyFav(true)}>★ 仅看收藏（{list.filter((f) => f.favorite).length}）</button>
      </div>
      {selected.size > 0 && <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="field"><label>整合项目标题</label><input value={genTitle} onChange={(e) => setGenTitle(e.target.value)} placeholder="如：校园二手交易平台" /></div>
        <div className="field" style={{ justifyContent: 'flex-end', display: 'flex', alignItems: 'flex-end' }}><button className="btn primary" onClick={genProject} disabled={busy}>{busy ? <span className="spin" /> : null}整合生成项目（{selected.size}）</button></div>
      </div>}
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert info">{msg}</div>}
    </div>
    {groups.length === 0
      ? <div className="card" style={{ marginTop: 14 }}><div className="empty">暂无功能点。先去「需求蒸馏」选择对话项目或导入素材生成功能点。</div></div>
      : groups.map(([session, items]) => (
        <div key={session} style={{ marginTop: 14 }}>
          <Section title={session}>
            <div className="opp-meta" style={{ marginBottom: 8 }}><span className="chip acc">{items.length} 个功能点</span>{items[0]?.session_title && <span className="chip">对话项目</span>}</div>
            <div className="list feature-list">{items.map((f, idx) => (
              <div className="opp-card" key={f.id} style={{ opacity: f.status === 'kept' ? 1 : 0.45, '--i': idx, '--o': f.status === 'kept' ? 1 : 0.45, cursor: 'default' }}>
                <div className="opp-head">
                  <div className="opp-title" style={{ flex: 1 }}>
                    <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSel(f.id)} style={{ width: 16, height: 16, marginRight: 8, verticalAlign: -2 }} />
                    {f.title}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => toggleFav(f)}>{f.favorite ? '★ 已收藏' : '☆ 收藏'}</button>
                    <button className="chip-del" style={{ fontSize: 15, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 8, marginLeft: 2 }} onClick={() => delFeature(f)} title="删除功能点">X</button>
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 6, minHeight: "3em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.5 }}>{f.description || ""}</div>
                <div className="opp-meta">
                  <span className="chip">{f.created_at}</span>
                  {f.source_name && <span className="chip">{f.source_name}</span>}
                </div>
              </div>
            ))}</div>
          </Section>
        </div>
      ))}
  </div>
}


export default FeaturesPage
