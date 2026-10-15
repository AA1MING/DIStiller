import { useState } from 'react'
import { api } from '../api.js'

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    const u = username.trim()
    if (!u || !password) { setError('请填写用户名和密码'); return }
    if (mode === 'register') {
      if (password.length < 6) { setError('密码至少 6 位'); return }
      if (password !== confirm) { setError('两次输入的密码不一致'); return }
    }
    setBusy(true); setError(null)
    try {
      const r = mode === 'register' ? await api.authRegister(u, password) : await api.authLogin(u, password)
      api.saveAuth(r.user, r.token)
      onAuthed?.(r.user)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="auth-screen">
      <div className="auth-glow" />
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-word"><span className="brand-dis">DIS</span>tiller</span>
          <span className="auth-sub">需求分析蒸馏器</span>
        </div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(null) }}>登录</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(null) }}>注册</button>
        </div>
        <div className="form-grid">
          <div className="field full"><label>用户名</label><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="2-32 位字母 / 数字 / 下划线 / 中文" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') submit() }} /></div>
          <div className="field full"><label>密码</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? '至少 6 位' : '输入密码'} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} /></div>
          {mode === 'register' && <div className="field full"><label>确认密码</label><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入密码" onKeyDown={(e) => { if (e.key === 'Enter') submit() }} /></div>}
        </div>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary auth-submit" onClick={submit} disabled={busy}>{busy ? <span className="spin" /> : null}{mode === 'register' ? '注册并进入' : '登录'}</button>
      </div>
    </div>
  )
}


export default AuthScreen
