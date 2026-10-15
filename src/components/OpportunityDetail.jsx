import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { scoreClass } from '../utils/constants.js'
import { Section } from '../utils/markdown.jsx'
import SubModal from './SubModal.jsx'
import Bars from './Bars.jsx'

function OpportunityDetail({ detail, onClose, onRefresh, onOpen }) {
  const [brief, setBrief] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const o = detail?.opportunity
  const [localDetail, setLocalDetail] = useState(detail)
  useEffect(() => setLocalDetail(detail), [detail])
  useEffect(() => { setBrief(null) }, [o?.id])
  if (!localDetail || !localDetail.opportunity) return null
  const opp = localDetail.opportunity
  const assets = opp.generatedAssets || {}
  const intent = assets.intentAnalysis

  const loadBrief = async () => setBrief(await api.getPmBrief(opp.id))
  const reevaluate = async () => { setBusy(true); try { const d = await api.reevaluate(opp.id); setLocalDetail(d); onRefresh?.(d) } finally { setBusy(false) } }
  const addTag = async () => { if (!tagInput.trim()) return; const tags = await api.addTag(opp.id, tagInput.trim()); setLocalDetail({ ...localDetail, tags }); setTagInput('') }
  const removeTag = async (tagId) => { await api.removeTag(opp.id, tagId); setLocalDetail({ ...localDetail, tags: (localDetail.tags || []).filter((t) => t.id !== tagId) }) }

  return <div className="card" style={{ marginTop: 20 }}>
    <div className="detail-hero">
      <div><h2 className="detail-title">{opp.title}</h2>
        <div className="opp-meta"><span className="chip">AI: {opp.ai_model || 'local'}</span><span className="chip">{opp.evidence_count} 条证据</span><span className="chip muted">{opp.created_at}</span></div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className={`score-badge ${scoreClass(opp.opportunity_score || 0)}`}>{Math.round(opp.opportunity_score || 0)}</div>
        <button className="btn" onClick={reevaluate} disabled={busy}>{busy ? <span className="spin" /> : null}重新评估</button>
        <button className="btn" onClick={loadBrief}>PM Agent</button>
        <button className="btn danger" onClick={onClose}>关闭</button>
      </div>
    </div>

    <Section title="意图理解">
      <div className="two-col">
        <div className="task-item"><div className="t">显性诉求</div><div className="muted" style={{ marginTop: 8 }}>{intent?.explicitNeed || opp.summary}</div></div>
        <div className="task-item"><div className="t">隐性意图</div><div className="muted" style={{ marginTop: 8 }}>{intent?.implicitIntent || (opp.underlyingNeeds || []).join('；')}</div></div>
      </div>
      {intent?.jobsToBeDone?.length > 0 && <ul className="dots">{intent.jobsToBeDone.map((j, i) => <li key={i}>{j}</li>)}</ul>}
      {intent?.antiSignals?.length > 0 && <div className="alert warn">反信号：{intent.antiSignals.join('；')}</div>}
    </Section>

    <Section title="评分雷达"><Bars o={opp} /></Section>
    <Section title="证据链">{localDetail.evidence?.length ? localDetail.evidence.map((e) => <div className="evidence-item" key={e.id}><div className="evidence-quote">“{e.quote}”</div><div className="evidence-meta"><span className="chip acc">{e.source_type}</span>{e.source_name && <span className="chip">{e.source_name}</span>}<span className="chip">置信度 {Math.round((e.confidence || 0) * 100)}%</span>{e.relevance_reason && <span className="chip">{e.relevance_reason}</span>}</div></div>) : <div className="muted">暂无证据</div>}</Section>

    <Section title="MVP / PRD / 开发任务">
      <pre className="draft">{assets.prdDraft || '未生成 PRD'}</pre>
      {(assets.developmentTasks || []).map((t, i) => <div className="task-item" key={i}><div className="t">{t.title}<span className="chip" style={{ marginLeft: 8 }}>{t.priority}</span><span className="chip">{t.type}</span></div><div className="muted">{t.description}</div></div>)}
    </Section>
    <Section title="验证实验">{localDetail.experiments?.length ? localDetail.experiments.map((e) => <div className="exp-item" key={e.id}><div className="t">{e.hypothesis}</div><div className="muted">{e.experiment} · {e.success_metric} · {e.time_box}</div></div>) : <div className="muted">暂无</div>}</Section>

    <Section title="标签">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(localDetail.tags || []).map((t) => <span className="chip tag" key={t.id} style={{ borderColor: t.color }} onClick={() => removeTag(t.id)} title="点击移除">{t.name} 移除</span>)}
        <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTag() }} placeholder="新增标签" style={{ width: 160 }} />
        <button className="btn" onClick={addTag}>加标签</button>
      </div>
    </Section>

    <Section title="活动时间线">{localDetail.activity?.length ? localDetail.activity.map((a) => <div className="activity-line" key={a.id}><span className="chip acc">{a.type}</span><span className="muted">{a.created_at}</span><span>{a.detail}</span></div>) : <div className="muted">暂无活动</div>}</Section>

    <Section title="相似机会（kura 聚类）">{localDetail.similar?.length ? <div>{localDetail.similar.map((s) => <span className="sim-chip" key={s.id}><button onClick={() => onOpen(s.id)}>{s.title} · {Math.round(s.similarity * 100)}%</button></span>)}</div> : <div className="muted">无明显相似</div>}</Section>

    {brief && <SubModal title="Icemark PM Agent Brief" onClose={() => setBrief(null)}>
      <Section title="One Pager"><div className="task-item"><div className="muted">价值主张：{brief.onePager.valueProposition}</div><div className="muted">成功指标：{brief.onePager.successMetric}</div></div></Section>
      <Section title="原型 Prompt"><pre className="draft">{brief.prototypePrompt}</pre></Section>
      <Section title="风险登记"><ul className="dots">{brief.riskRegister.map((r, i) => <li key={i}>{r.risk} → {r.mitigation}</li>)}</ul></Section>
    </SubModal>}
  </div>
}

/** Wiki 知识图页：星系模式——自动读取所有已生成 Wiki 的项目，合并渲染星系图；支持搜索定位节点。 */
// Wiki 星系数据缓存：进入/离开 wiki 页不再重新请求；页面保持挂载、视觉器实例保活，
// 仅在首次进入或缓存过期时拉取一次（过期后静默刷新，不阻塞显示）


export default OpportunityDetail
