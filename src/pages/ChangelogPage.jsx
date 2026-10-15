import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'

function ChangelogPage() {
  const [list, setList] = useState(() => cachedGet('changelog') || [])
  useEffect(() => {
    const cached = cachedGet('changelog')
    if (cached) setList(cached)
    cachedFetch('changelog', () => api.listChangelog()).then(setList).catch(() => {})
  }, [])
  return <div className="card"><h3 style={{ marginTop: 0 }}>Changelog 草稿</h3>
    <div className="list">{list.length === 0 ? <div className="empty">暂无 changelog</div> : list.map((c) => (
      <div className="task-item" key={c.id}><div className="opp-head"><div className="t">{c.title}</div><button className="btn danger" style={{ minHeight: 26, padding: '1px 6px' }} onClick={async () => { if (confirm('删除该 changelog 草稿？')) { await api.removeChangelog(c.id); setList((l) => l.filter((x) => x.id !== c.id)) } }}>删除</button></div><div className="muted" style={{ marginTop: 6 }}>{c.body}</div><div className="opp-meta"><span className="chip">{c.status}</span><a className="chip acc" href={`/api/changelog/${c.id}/export`} target="_blank" rel="noreferrer">导出 Markdown</a></div></div>
    ))}</div>
  </div>
}

/** 提示词生成：选择项目 + Agent 模板 → 生成可直接粘贴使用的项目提示词。 */
/** 提示词生成页：选择目标 AI 编程 Agent 卡片（进入反向播放 / 悬停正向循环 / 点击专属特效）。 */

export default ChangelogPage
