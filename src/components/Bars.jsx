
function Bars({ o }) {
  const rows = [['demandStrength', '需求强度'], ['painIntensity', '痛点烈度'], ['evidenceQuality', '证据质量'], ['businessValue', '商业价值'], ['feasibility', '可行性'], ['differentiation', '差异化'], ['duplicateRisk', '重复风险'], ['marketRisk', '市场风险']]
  return rows.map(([key, label]) => {
    const v = Number(o?.[key] || 0)
    const warn = key === 'duplicateRisk' || key === 'marketRisk'
    return <div className="bar-row" key={key}>
      <span className="label">{label}</span>
      <div className="bar-track"><div className={`bar-fill ${warn && v >= 60 ? 'warn' : ''}`} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} /></div>
      <span>{v}</span>
    </div>
  })
}


export default Bars
