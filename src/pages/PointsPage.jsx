import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedFetch } from '../utils/cache.js'
import { WORK_STATUS_LABEL, WORK_STATUS_COLOR } from '../utils/constants.js'
import { fileToBase64, b64ToBlob, saveAttachmentBlob, openAttachmentBlob } from '../utils/file-utils.js'
import { Section } from '../utils/markdown.jsx'

function PointsPage() {
  const [data, setData] = useState(() => cachedGet('points') || null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [awardInfo, setAwardInfo] = useState('')
  const [attach, setAttach] = useState(null)
  const [evidence, setEvidence] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    try { setData(await cachedFetch('points', () => api.pointsMe(), { force: true })) } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => {
    const cached = cachedGet('points')
    if (cached) setData(cached)
    cachedFetch('points', () => api.pointsMe()).then(setData).catch((e) => setErr(e.message))
  }, [load])

  const pickFile = async (e, key) => {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { setErr(key === 'evidence' ? '获奖证据不能超过 5MB' : '附件不能超过 5MB'); return }
    try {
      const file = { name: f.name, type: f.type || 'application/octet-stream', data: await fileToBase64(f) }
      if (key === 'evidence') setEvidence(file); else setAttach(file)
    } catch { setErr('读取文件失败，请重试') }
  }
  const submit = async () => {
    if (!title.trim()) { setErr('请填写作品名称'); return }
    if (!description.trim()) { setErr('请填写作品说明'); return }
    if (!awardInfo.trim()) { setErr('请填写获奖信息（如奖项名称与等级）'); return }
    if (!evidence) { setErr('请上传获奖证据（如获奖证书图片或截图）'); return }
    setBusy(true); setErr(null); setMsg(null)
    try {
      await api.submitWork({ title: title.trim(), description: description.trim(), awardInfo: awardInfo.trim(), attachment: attach, evidence })
      setTitle(''); setDescription(''); setAwardInfo(''); setAttach(null); setEvidence(null)
      setMsg('作品已提交，等待管理员审核')
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const remove = async (id) => {
    if (!window.confirm('确定删除该作品？仅待审核作品可删除。')) return
    setErr(null)
    try { await api.deleteWork(id); load() } catch (e) { setErr(e.message) }
  }
  const download = async (w) => {
    try {
      const a = await api.workAttachment(w.id)
      saveAttachmentBlob(b64ToBlob(a.data, a.type), a.name || w.attachment_name)
    } catch (e) { setErr(e.message) }
  }
  const preview = async (w) => {
    try {
      const a = await api.workAttachment(w.id)
      openAttachmentBlob(b64ToBlob(a.data, a.type))
    } catch (e) { setErr(e.message) }
  }
  const previewEvidence = async (w) => {
    try {
      const a = await api.workEvidence(w.id)
      if (!a.data) return
      openAttachmentBlob(b64ToBlob(a.data, a.type))
    } catch (e) { setErr(e.message) }
  }
  const downloadEvidence = async (w) => {
    try {
      const a = await api.workEvidence(w.id)
      if (!a.data) return
      saveAttachmentBlob(b64ToBlob(a.data, a.type), a.name || w.evidence_name)
    } catch (e) { setErr(e.message) }
  }

  const works = data?.works || []
  return <div style={{ maxWidth: 900, margin: '0 auto' }}>
    <div className="stats">
      <div className="stat"><div className="v">{data ? data.earned : '—'}</div><div className="k">所获积分</div></div>
      <div className="stat"><div className="v">{data ? works.length : '—'}</div><div className="k">提交作品</div></div>
      <div className="stat"><div className="v">{data ? works.filter((w) => w.status === 'pending').length : '—'}</div><div className="k">待审核</div></div>
      <div className="stat"><div className="v">{data ? works.filter((w) => w.status === 'approved').length : '—'}</div><div className="k">已通过</div></div>
    </div>
    <div className="card">
      <h3 style={{ marginTop: 0 }}>提交获奖作品赢积分</h3>
      <div className="form-grid">
        <div className="field full"><label>作品名称</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：校园二手交易平台 PRD" /></div>
        <div className="field full"><label>作品说明</label><textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="简单说明作品内容、完成情况与亮点（必填）" /></div>
        <div className="field full"><label>获奖信息（必填）</label><input value={awardInfo} onChange={(e) => setAwardInfo(e.target.value)} placeholder="如：全国大学生创新大赛 一等奖" /></div>
        <div className="field"><label>获奖证据（必填）</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label className="btn file-btn">
              {evidence ? '重新选择文件' : '选择文件'}
              <input type="file" style={{ display: 'none' }} onChange={(e) => pickFile(e, 'evidence')} />
            </label>
            {evidence && <span className="chip acc">已选择：{evidence.name}</span>}
            {evidence && <button type="button" className="chip-del" onClick={() => setEvidence(null)} title="移除证据">✕</button>}
          </div>
        </div>
        <div className="field"><label>作品附件（可选）</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label className="btn file-btn">
              {attach ? '重新选择文件' : '选择文件'}
              <input type="file" style={{ display: 'none' }} onChange={(e) => pickFile(e, 'attach')} />
            </label>
            {attach && <span className="chip acc">已选择：{attach.name}</span>}
            {attach && <button type="button" className="chip-del" onClick={() => setAttach(null)} title="移除附件">✕</button>}
          </div>
        </div>
      </div>
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert info">{msg}</div>}
      <div style={{ marginTop: 14 }}><button className="btn primary" style={{ minWidth: 108, fontSize: 16, padding: '7px 14px', lineHeight: 1.6, border: '1px solid transparent' }} onClick={submit} disabled={busy}>{busy ? <span className="spin" /> : null}提交作品</button></div>
    </div>
    <Section title="我的提交">
      {!data ? <div className="card"><div className="empty">加载中…</div></div>
        : works.length === 0 ? <div className="card"><div className="empty">还没有提交过作品，提交第一份作品赚取积分吧。</div></div>
        : <div className="list">{works.map((w) => (
          <div className="opp-card" key={w.id} style={{ cursor: 'default' }}>
            <div className="opp-head">
              <div className="opp-title" style={{ flex: 1 }}>
                {w.title}
                <span className="chip" style={{ marginLeft: 8, color: WORK_STATUS_COLOR[w.status] || undefined, borderColor: WORK_STATUS_COLOR[w.status] || undefined }}>{WORK_STATUS_LABEL[w.status] || w.status}</span>
                {w.status === 'approved' && <span className="chip acc" style={{ marginLeft: 6 }}>+{w.points_awarded} 积分</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {w.attachment_name && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => preview(w)}>预览</button>}
                {w.attachment_name && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => download(w)}>下载附件</button>}
                {w.evidence_name && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => previewEvidence(w)}>预览证据</button>}
                {w.evidence_name && <button className="btn" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => downloadEvidence(w)}>下载证据</button>}
                {w.status === 'pending' && <button className="btn danger" style={{ minHeight: 28, padding: '2px 10px' }} onClick={() => remove(w.id)}>删除</button>}
              </div>
            </div>
            {w.description && <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{w.description}</div>}
            <div className="opp-meta">
              <span className="chip">{w.created_at}</span>
              {w.award_info && <span className="chip">获奖：{w.award_info}</span>}
              {w.attachment_name && <span className="chip">附件：{w.attachment_name}（{Math.max(1, Math.round(w.attachment_size / 1024))}KB）</span>}
              {w.evidence_name && <span className="chip">证据：{w.evidence_name}（{Math.max(1, Math.round(w.evidence_size / 1024))}KB）</span>}
              {w.admin_note && <span className="chip">管理员备注：{w.admin_note}</span>}
            </div>
          </div>
        ))}</div>}
    </Section>
  </div>
}

// ===== 创作积分榜（用户端独立功能） =====

export default PointsPage
