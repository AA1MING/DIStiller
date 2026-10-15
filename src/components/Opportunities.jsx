import { useMemo } from 'react'
import { api } from '../api.js'
import { scoreClass, scoreColor } from '../utils/constants.js'
import OpportunityDetail from './OpportunityDetail.jsx'

function Opportunities({ list, tags, tagFilter, setTagFilter, onOpen, onDelete, onTagDeleted, detail, onCloseDetail, onRefreshDetail }) {
  const stats = useMemo(() => ({
    total: list.length,
    avg: list.length ? Math.round(list.reduce((s, o) => s + (o.opportunity_score || 0), 0) / list.length) : 0,
    high: list.filter((o) => (o.opportunity_score || 0) >= 70).length,
  }), [list])
  const removeTag = async (e, t) => {
    e.stopPropagation()
    if (!confirm(`删除标签「${t.name}」？该标签会从所有机会上移除。`)) return
    await api.removeTagGlobal(t.id)
    onTagDeleted?.(t.id)
  }
  return <div>
    <div className="stats">
      <div className="stat"><div className="v">{stats.total}</div><div className="k">机会总数</div></div>
      <div className="stat"><div className="v" style={{ color: scoreColor(stats.avg) }}>{stats.avg}</div><div className="k">平均机会分</div></div>
      <div className="stat"><div className="v">{stats.high}</div><div className="k">高价值候选</div></div>
    </div>
    <div className="card" style={{ marginBottom: 14, padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted">按标签筛：</span>
        <span className={`chip ${!tagFilter ? 'acc' : ''} tag`} onClick={() => setTagFilter(null)}>全部</span>
        {tags.map((t) => <span className={`chip ${tagFilter === t.id ? 'acc' : ''} tag`} key={t.id} onClick={() => setTagFilter(t.id)} style={{ borderColor: t.color }}>{t.name}<button className="chip-del" onClick={(e) => removeTag(e, t)} title="删除标签">×</button></span>)}
      </div>
    </div>
    <div className="list">{list.length === 0 ? <div className="empty">暂无机会，先去对话或导入</div> : list.map((o) => (
      <div key={o.id}>
        <div className="opp-card" onClick={() => onOpen(o.id)} style={{ cursor: 'pointer' }}>
          <div className="opp-head">
            <div className="opp-title" style={{ flex: 1 }}>{o.title}</div>
            <div className={`score-badge ${scoreClass(o.opportunity_score || 0)}`}>{Math.round(o.opportunity_score || 0)}</div>
            <button className="btn danger" style={{ minHeight: 26, padding: '1px 6px' }} onClick={(e) => { e.stopPropagation(); if (confirm('删除该机会？此操作不可恢复。')) { api.remove(o.id).then(() => onDelete(o.id)) } }}>删除</button>
          </div>
          <div className="opp-summary">{o.summary || o.problemStatement}</div>
          <div className="opp-meta"><span className="chip">{o.evidence_count || 0} 条证据</span><span className="chip">AI: {o.ai_model || 'local'}</span></div>
        </div>
        {detail?.opportunity?.id === o.id && <OpportunityDetail detail={detail} onClose={onCloseDetail} onRefresh={onRefreshDetail} onOpen={onOpen} />}
      </div>
    ))}</div>
  </div>
}


export default Opportunities
