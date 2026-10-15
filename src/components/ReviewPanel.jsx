import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import AdminWorkCard from './AdminWorkCard.jsx'

function ReviewPanel() {
  const [stats, setStats] = useState(null)
  const [works, setWorks] = useState(null)
  const [filter, setFilter] = useState('pending')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const load = useCallback(async () => {
    setBusy(true); setErr(null)
    try {
      const [s, w] = await Promise.all([api.adminPointsStats(), api.adminListWorks(filter === 'all' ? '' : filter)])
      setStats(s); setWorks(w.works)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [filter])
  useEffect(() => { load() }, [load])
  const afterReview = (m) => { setMsg(m); load() }
  const filters = [
    ['pending', '待审核'],
    ['all', '全部'],
    ['approved', '已通过'],
    ['rejected', '已拒绝'],
  ]
  return <div style={{ maxWidth: 1000, margin: '0 auto' }}>
    <div className="stats">
      <div className="stat"><div className="v">{stats ? stats.total : '—'}</div><div className="k">全部作品</div></div>
      <div className="stat"><div className="v">{stats ? stats.pending : '—'}</div><div className="k">待审核</div></div>
      <div className="stat"><div className="v">{stats ? stats.approved : '—'}</div><div className="k">已通过</div></div>
      <div className="stat"><div className="v">{stats ? stats.rejected : '—'}</div><div className="k">已拒绝</div></div>
      <div className="stat"><div className="v">{stats ? stats.points_given : '—'}</div><div className="k">已发放积分</div></div>
    </div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="opp-head" style={{ marginBottom: 10 }}><h3 style={{ margin: 0 }}>作品审核</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {filters.map(([v, label]) => <button key={v} className={`btn ${filter === v ? 'primary' : ''}`} style={{ minHeight: 30, padding: '4px 12px' }} onClick={() => setFilter(v)}>{label}{v !== 'all' && stats ? `（${stats[v]}）` : ''}</button>)}
        </div>
      </div>
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert info">{msg}</div>}
      {busy && !works ? <div className="empty"><span className="spin" /></div>
        : works === null ? null
        : works.length === 0 ? <div className="empty">该分类下暂无作品。</div>
        : <div className="list">{works.map((w) => <AdminWorkCard key={w.id} w={w} onReviewed={afterReview} onError={setErr} />)}</div>}
   </div>
 </div>
}

// ===== 用户管理（管理员） =====

export default ReviewPanel
