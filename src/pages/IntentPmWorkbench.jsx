import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { Section } from '../utils/markdown.jsx'

function IntentPmWorkbench({ onOpen }) {
  const [data, setData] = useState(null)
  useEffect(() => { Promise.all([api.intentMap(), api.pmPortfolio()]).then(([intent, portfolio]) => setData({ intent, portfolio })) }, [])
  if (!data) return null
  const lanes = [['now', 'Now · 优先验证'], ['next', 'Next · 候选规划'], ['later', 'Later · 持续观察']]
  return <div className="grid">
    <div className="card">
      <h3 style={{ marginTop: 0 }}>意图地图（kura）</h3>
      <div className="list">{data.intent.intents.length === 0 ? <div className="empty">暂无意图</div> : data.intent.intents.map((it) => (
        <div className="task-item" key={it.key}>
          <div className="opp-head"><div className="t">{it.label}</div><span className="chip acc">{it.count} 个机会 · {Math.round(it.confidence * 100)}%</span></div>
          <div className="muted" style={{ marginTop: 6 }}>隐性意图：{it.implicitIntents[0] || '待澄清'}</div>
          {it.antiSignals.length > 0 && <div className="alert warn" style={{ marginTop: 8 }}>反信号：{it.antiSignals.slice(0, 2).join('；')}</div>}
          <div style={{ marginTop: 8 }}>{it.opportunities.map((o) => <span className="sim-chip" key={o.id}><button onClick={() => onOpen(o.id)}>{o.title} · {Math.round(o.score)}</button></span>)}</div>
        </div>
      ))}</div>
    </div>
    <div className="card">
      <h3 style={{ marginTop: 0 }}>PM 组合策略（icemark）</h3>
      <div className="alert info">{data.portfolio.strategy.focus}</div>
      <div className="muted">建议行动：{data.portfolio.strategy.nextAction} · {data.portfolio.strategy.portfolioHealth}</div>
      {lanes.map(([k, title]) => (
        <Section key={k} title={title}>{data.portfolio.lanes[k].length ? data.portfolio.lanes[k].map((o) => <div className="task-item" key={o.id} onClick={() => onOpen(o.id)} style={{ cursor: 'pointer' }}><div className="t">{o.title}<span className="chip" style={{ marginLeft: 8 }}>{Math.round(o.score)}</span></div></div>) : <div className="muted">暂无</div>}</Section>
      ))}
    </div>
  </div>
}


export default IntentPmWorkbench
