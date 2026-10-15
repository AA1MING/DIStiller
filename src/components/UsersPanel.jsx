import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'

function UsersPanel({ meId }) {
  const [busyId, setBusyId] = useState(null)
  const [users, setUsers] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const load = useCallback(async () => {
    try { setUsers(await api.adminListUsers()) } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  const removeUser = async (u) => {
    if (!window.confirm('确定删除用户「' + u.username + '」？其全部作品与积分记录将一并删除，且不可恢复。')) return
    setErr(null)
    try {
      setBusyId(u.id)
      await api.adminDeleteUser(u.id)
      load()
    } catch (e) { setErr(e.message) } finally { setBusyId(null) }
  }
  const list = users?.users || []
  const filtered = q.trim() ? list.filter((u) => (u.username || '').includes(q.trim())) : list
  const totals = users ? {
    users: list.length,
    active: list.filter((u) => u.works > 0).length,
    works: list.reduce((s, u) => s + (u.works || 0), 0),
    points: list.reduce((s, u) => s + (u.points || 0), 0),
  } : null
  return <div style={{ maxWidth: 1000, margin: '0 auto' }}>
    <div className="stats">
      <div className="stat"><div className="v">{totals ? totals.users : '—'}</div><div className="k">注册用户</div></div>
      <div className="stat"><div className="v">{totals ? totals.active : '—'}</div><div className="k">参与作品用户</div></div>
      <div className="stat"><div className="v">{totals ? totals.works : '—'}</div><div className="k">作品总数</div></div>
      <div className="stat"><div className="v">{totals ? totals.points : '—'}</div><div className="k">已发放积分</div></div>
    </div>
    <div className="card">
      <div className="opp-head" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>用户列表</h3>
        <input style={{ maxWidth: 260 }} placeholder="搜索用户名…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <div className="alert error">{err}</div>}
      {!users ? <div className="empty"><span className="spin" /></div>
        : filtered.length === 0 ? <div className="empty">暂无匹配的用户。</div>
        : <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}><th style={{ padding: 7 }}>用户</th><th>角色</th><th>注册时间</th><th>提交作品</th><th>待审核</th><th>已通过</th><th>积分</th><th>操作</th></tr></thead>
              <tbody>{filtered.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: 7 }}>{u.username}{u.role === 'admin' && <span className="chip acc" style={{ marginLeft: 6 }}>管理员</span>}</td>
                  <td>{u.role === 'admin' ? '管理员' : '用户'}</td>
                  <td>{u.created_at}</td>
                  <td>{u.works}</td>
                  <td>{u.pending}</td>
                  <td>{u.approved}</td>
                  <td><b>{u.points}</b></td>
                   <td>{u.role === 'admin' || u.id === meId ? null : <button className="btn danger" style={{ minHeight: 26, padding: '2px 10px' }} disabled={busyId === u.id} onClick={() => removeUser(u)}>{busyId === u.id ? <span className="spin" /> : '删除'}</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>}
    </div>
  </div>
}

// ===== 模板市场管理（管理员：上架 / 作品导入 / 下架） =====

export default UsersPanel
