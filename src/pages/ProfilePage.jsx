import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { cachedGet, cachedSet, cachedFetch } from '../utils/cache.js'

const RECHARGE_METHODS = [
  { id: 'alipay', label: '支付宝' },
  { id: 'wechat', label: '微信支付' },
]
const RECHARGE_METHOD_LABEL = Object.fromEntries(RECHARGE_METHODS.map((m) => [m.id, m.label]))

function ProfilePage({ user, onUserChange }) {
  const [profile, setProfile] = useState(null)
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [bio, setBio] = useState('')
  const [points, setPoints] = useState(() => cachedGet('points') || null)
  const [amount, setAmount] = useState('100')
  const [method, setMethod] = useState('alipay')
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showPwdModal, setShowPwdModal] = useState(false)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    api.getProfile().then((p) => {
      setProfile(p)
      setNickname(p.nickname || '')
      setEmail(p.email || '')
      setBio(p.bio || '')
    }).catch((e) => setErr(e.message))
    cachedFetch('points', () => api.pointsMe()).then(setPoints).catch(() => {})
  }, [])

  const saveProfile = async () => {
    setBusy('profile'); setErr(null); setMsg(null)
    try {
      const p = await api.updateProfile({ nickname: nickname.trim(), email: email.trim(), bio: bio.trim() })
      setProfile(p)
      onUserChange?.(p)
      setMsg('资料已保存')
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  const savePassword = async () => {
    if (!oldPwd) { setErr('请填写原密码'); return }
    if (!newPwd || newPwd.length < 6) { setErr('新密码至少 6 位'); return }
    if (newPwd !== confirmPwd) { setErr('两次输入的新密码不一致'); return }
    setBusy('pwd'); setErr(null); setMsg(null)
    try {
      await api.changePassword({ oldPassword: oldPwd, newPassword: newPwd })
      setOldPwd(''); setNewPwd(''); setConfirmPwd('')
      setShowPwdModal(false)
      setMsg('密码已修改，其它设备登录将自动失效')
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  const doRecharge = async () => {
    const amt = Math.round(Number(amount))
    if (!Number.isFinite(amt) || amt < 1 || amt > 1000000) { setErr('充值积分需为 1-1000000 之间的整数'); return }
    const ml = RECHARGE_METHOD_LABEL[method] || method
    if (!window.confirm(`模拟支付：使用${ml}充值 ${amt} 积分？`)) return
    setBusy('recharge'); setErr(null); setMsg(null)
    try {
      const r = await api.rechargePoints({ amount: amt, method })
      const me = await api.pointsMe()
      setPoints(me); cachedSet('points', me)
      setMsg(`充值成功：+${r.amount} 积分，当前余额 ${r.balance} 积分`)
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  const displayName = (profile && profile.nickname) || user?.nickname || user?.username || '—'

  return <div style={{ maxWidth: 860, margin: '0 auto' }}>
    <div className="stats">
      <div className="stat"><div className="v">{points ? points.balance : '—'}</div><div className="k">当前积分</div></div>
      <div className="stat"><div className="v">{displayName}</div><div className="k">昵称</div></div>
      <div className="stat"><div className="v">{user?.role === 'admin' ? '管理员' : '普通用户'}</div><div className="k">账号角色</div></div>
    </div>

    <div className="card">
      <h3 style={{ marginTop: 0 }}>基本资料</h3>
      <div className="form-grid">
        <div className="field"><label>昵称</label><input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="留空则显示用户名" maxLength={32} /></div>
        <div className="field"><label>邮箱</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="选填" maxLength={120} /></div>
        <div className="field full"><label>个人简介</label><textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="简单介绍自己（选填，最多 500 字）" maxLength={500} /></div>
      </div>
      {err && <div className="alert error">{err}</div>}
      {msg && <div className="alert info">{msg}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={saveProfile} disabled={busy !== null}>{busy === 'profile' ? <span className="spin" /> : null}保存资料</button>
        <button className="btn" onClick={() => { setShowPwdModal(true); setErr(null); setMsg(null) }}>修改密码</button>
      </div>
    </div>

    <div className="card">
      <h3 style={{ marginTop: 0 }}>积分充值</h3>
      <div className="muted" style={{ marginBottom: 12 }}>充值后积分立即可用于模板市场兑换；当前为模拟支付，确认后即时到账。</div>
      <div className="form-grid">
        <div className="field"><label>充值积分</label><input type="number" min={1} max={1000000} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field full"><label>支付方式</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {RECHARGE_METHODS.map((m) => (
              <button key={m.id} type="button" className={method === m.id ? 'avatar-option active' : 'avatar-option'} onClick={() => setMethod(m.id)}>{m.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}><button className="btn primary" onClick={doRecharge} disabled={busy !== null}>{busy === 'recharge' ? <span className="spin" /> : null}确认充值</button></div>
    </div>

    {showPwdModal && <div className="app-modal-anim" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => { setShowPwdModal(false); setErr(null) }}>
      <div className="app-modal-card-anim" style={{ width: 'min(440px, 94vw)', background: 'var(--surface)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }} onClick={(e) => e.stopPropagation()}>
        <div className="opp-head" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
          <h4 style={{ margin: 0 }}>修改密码</h4>
          <button className="btn" style={{ minHeight: 28, padding: '2px 14px', flexShrink: 0 }} onClick={() => { setShowPwdModal(false); setErr(null) }}>关闭</button>
        </div>
        <div style={{ padding: 16 }}>
          <div className="form-grid">
            <div className="field full"><label>原密码</label><input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} /></div>
            <div className="field full"><label>新密码</label><input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="至少 6 位" /></div>
            <div className="field full"><label>确认新密码</label><input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} /></div>
          </div>
          {err && <div className="alert error">{err}</div>}
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={savePassword} disabled={busy !== null}>{busy === 'pwd' ? <span className="spin" /> : null}确认修改</button>
          </div>
        </div>
      </div>
    </div>}

  </div>
}


export default ProfilePage
