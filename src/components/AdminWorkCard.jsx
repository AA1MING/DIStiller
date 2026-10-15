import { useState } from 'react'
import { api } from '../api.js'
import { WORK_STATUS_LABEL, WORK_STATUS_COLOR } from '../utils/constants.js'
import { b64ToBlob, saveAttachmentBlob, openAttachmentBlob } from '../utils/file-utils.js'

function AdminWorkCard({ w, onReviewed, onError }) {
  const [points, setPoints] = useState(w.status === 'approved' ? (w.points_awarded || 0) : 10)
  const [note, setNote] = useState(w.admin_note || '')
  const [busy, setBusy] = useState(false)
  const review = async (status) => {
    setBusy(true)
    try {
      const r = await api.adminReviewWork(w.id, { status, points: status === 'approved' ? (Number(points) || 0) : 0, note: note.trim() })
      onReviewed(status === 'approved' ? `已通过「${w.title}」，发放 ${r.points_awarded} 积分` : `已拒绝「${w.title}」`)
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }
  const download = async () => {
    try {
      const a = await api.adminWorkAttachment(w.id)
      saveAttachmentBlob(b64ToBlob(a.data, a.type), a.name || w.attachment_name)
    } catch (e) { onError(e.message) }
  }
  const preview = async () => {
    try {
      const a = await api.adminWorkAttachment(w.id)
      openAttachmentBlob(b64ToBlob(a.data, a.type))
    } catch (e) { onError(e.message) }
  }
  const previewEvidence = async () => {
    try {
      const a = await api.adminWorkEvidence(w.id)
      if (!a.data) return
      openAttachmentBlob(b64ToBlob(a.data, a.type))
    } catch (e) { onError(e.message) }
  }
  const downloadEvidence = async () => {
    try {
      const a = await api.adminWorkEvidence(w.id)
      if (!a.data) return
      saveAttachmentBlob(b64ToBlob(a.data, a.type), a.name || w.evidence_name)
    } catch (e) { onError(e.message) }
  }
  const del = async () => {
    if (!window.confirm(`确定删除作品「${w.title}」？删除后不可恢复。`)) return
    setBusy(true)
    try {
      await api.adminDeleteWork(w.id)
      onReviewed(`已删除「${w.title}」`)
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }
  return <div className="opp-card" style={{ cursor: 'default' }}>
    <div className="opp-head">
      <div className="opp-title" style={{ flex: 1 }}>
        {w.title}
        <span className="chip" style={{ marginLeft: 8, color: WORK_STATUS_COLOR[w.status] || undefined, borderColor: WORK_STATUS_COLOR[w.status] || undefined }}>{WORK_STATUS_LABEL[w.status] || w.status}</span>
        {w.status === 'approved' && <span className="chip acc" style={{ marginLeft: 6 }}>+{w.points_awarded} 积分</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {w.attachment_name && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={preview}>预览</button>}
        {w.attachment_name && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={download}>下载附件</button>}
        {w.evidence_name && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={previewEvidence}>预览证据</button>}
        {w.evidence_name && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={downloadEvidence}>下载证据</button>}
        <button className="btn danger" style={{ minHeight: 28, padding: '2px 10px' }} onClick={del} disabled={busy}>删除</button>
      </div>
    </div>
    {w.description && <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{w.description}</div>}
    {w.award_info && <div className="chip acc" style={{ marginTop: 8 }}>获奖：{w.award_info}</div>}
    <div className="opp-meta">
      <span className="chip">#{w.id}</span>
      <span className="chip">提交人：{w.username}</span>
      <span className="chip">{w.created_at}</span>
      {w.evidence_name && <span className="chip">证据：{w.evidence_name}（{Math.max(1, Math.round(w.evidence_size / 1024))}KB）</span>}
      {w.attachment_name && <span className="chip">附件：{w.attachment_name}（{Math.max(1, Math.round(w.attachment_size / 1024))}KB）</span>}
      {w.reviewed_at && <span className="chip">审核时间：{w.reviewed_at}</span>}
    </div>
    {w.status === 'pending'
      ? <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field"><label>发放积分（通过时生效）</label><input type="number" min={0} max={100000} value={points} onChange={(e) => setPoints(e.target.value)} /></div>
          <div className="field"><label>审核备注</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选，会展示给提交人" /></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" style={{ minHeight: 34, padding: '5px 14px' }} onClick={() => review('approved')} disabled={busy}>{busy ? <span className="spin" /> : null}通过并发放</button>
            <button className="btn danger" style={{ minHeight: 34, padding: '5px 14px' }} onClick={() => review('rejected')} disabled={busy}>拒绝</button>
          </div>
        </div>
      : <div className="opp-meta">{w.admin_note && <span className="chip">备注：{w.admin_note}</span>}</div>}
  </div>
}


export default AdminWorkCard
