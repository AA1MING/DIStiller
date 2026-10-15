import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'

function LeaderboardPage() {
  const [data, setData] = useState(() => cachedGet('leaderboard') || null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    const cached = cachedGet('leaderboard')
    if (cached) setData(cached)
    cachedFetch('leaderboard', () => api.pointsLeaderboard()).then(setData).catch((e) => setErr(e.message))
  }, [])
  const rows = data ? data.leaderboard : null
  const my = data ? data.my : null
  return <div style={{ maxWidth: 900, margin: '0 auto' }}>
    <div className="stats">
      <div className="stat"><div className="v">{my ? '#' + my.rank : '—'}</div><div className="k">我的排名</div></div>
      <div className="stat"><div className="v">{my ? my.points : '—'}</div><div className="k">我的创作积分</div></div>
      <div className="stat"><div className="v">{my ? my.works : '—'}</div><div className="k">通过作品</div></div>
      <div className="stat"><div className="v">{rows ? rows.length : '—'}</div><div className="k">上榜用户</div></div>
    </div>
    <div className="card">
      <h3 style={{ marginTop: 0 }}>创作积分榜（前 20 名）</h3>
      <div className="muted" style={{ marginTop: 4, marginBottom: 10 }}>仅统计创作激励积分：作品通过管理端审核后发放的积分。</div>
      {err && <div className="alert error">{err}</div>}
      {!data ? <div className="empty"><span className="spin" /></div>
        : !rows || rows.length === 0 ? <div className="empty">暂无已通过的作品，快去提交作品赢积分吧。</div>
        : <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}><th style={{ padding: 7 }}>排名</th><th>用户</th><th>通过作品</th><th>创作积分</th></tr></thead>
            <tbody>{rows.map((u, i) => (
              <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border-soft)', background: my && u.user_id === my.user_id ? 'var(--accent-soft)' : undefined }}>
                <td style={{ padding: 7 }}><b>{i + 1}</b>{my && u.user_id === my.user_id && <span className="chip acc" style={{ marginLeft: 6 }}>我</span>}</td>
                <td>{u.username}</td>
                <td>{u.works}</td>
                <td><b>{u.points}</b></td>
              </tr>
            ))}</tbody>
          </table>}
    </div>
  </div>
}

// ===== 管理端（审核作品、发放积分） =====

export default LeaderboardPage
