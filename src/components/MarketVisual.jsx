import { scoreColor } from '../utils/constants.js'
import { Section } from '../utils/markdown.jsx'
import Opportunities from './Opportunities.jsx'

function MarketVisual({ data }) {
  const d = data || {}
  const swot = d.swot || {}
  const score = Number(d.overallScore) || 0
  const swotBlocks = [
    ['优势 Strengths', swot.strengths, 'var(--green)'],
    ['劣势 Weaknesses', swot.weaknesses, 'var(--red)'],
    ['机会 Opportunities', swot.opportunities, 'var(--accent)'],
    ['威胁 Threats', swot.threats, 'var(--yellow)'],
  ]
  const forceColor = (v) => (v >= 70 ? 'var(--red)' : v >= 45 ? 'var(--yellow)' : 'var(--green)')
  return <div style={{ marginTop: 12 }}>
    <div className="stats" style={{ marginBottom: 14 }}>
      <div className="stat"><div className="v" style={{ color: scoreColor(score) }}>{score}</div><div className="k">综合机会评分</div></div>
      <div className="stat"><div className="v">{swot.strengths?.length || 0}</div><div className="k">优势</div></div>
      <div className="stat"><div className="v">{swot.opportunities?.length || 0}</div><div className="k">机会</div></div>
      <div className="stat"><div className="v">{swot.threats?.length || 0}</div><div className="k">威胁</div></div>
    </div>
    {d.summary && <div className="alert info" style={{ marginBottom: 14 }}>{d.summary}</div>}

    <Section title="SWOT 分析">
      <div className="two-col">{swotBlocks.map(([label, items, color]) => (
        <div className="task-item swot" key={label} style={{ '--swot-color': color, marginBottom: 10 }}>
          <div className="t" style={{ color }}>{label}</div>
          <ul className="dots" style={{ marginTop: 8 }}>{Array.isArray(items) && items.length
            ? items.map((it, i) => <li key={i}>{it}</li>)
            : <li style={{ color: 'var(--text-mute)' }}>待补充</li>}</ul>
        </div>
      ))}</div>
    </Section>

    <Section title="PESTEL 分析">
      <div className="two-col">{Array.isArray(d.pestel) && d.pestel.map((p) => (
        <div className="task-item" key={p.factor || p.factor || p} style={{ marginBottom: 10 }}>
          <div className="t">{p.factor}</div>
          <ul className="dots" style={{ marginTop: 8 }}>{Array.isArray(p.items) && p.items.length
            ? p.items.map((it, i) => <li key={i}>{it}</li>)
            : <li style={{ color: 'var(--text-mute)' }}>待补充</li>}</ul>
        </div>
      ))}</div>
    </Section>

    <Section title="波特五力（评分越高威胁越大）">
      {Array.isArray(d.fiveForces) && d.fiveForces.map((f) => {
        const v = Number(f.score) || 0
        return <div className="bar-row" key={f.name} style={{ gridTemplateColumns: '150px 1fr 42px' }}>
          <span className="label">{f.name}</span>
          <div className="bar-track"><div className={`bar-fill ${v >= 60 ? 'warn' : ''}`} style={{ width: `${Math.max(2, Math.min(100, v))}%`, background: forceColor(v) }} /></div>
          <span style={{ color: forceColor(v) }}>{v}</span>
          {f.description && <span className="muted" style={{ gridColumn: '1 / -1', marginTop: -4 }}>{f.description}</span>}
        </div>
      })}
    </Section>
  </div>
}


export default MarketVisual
