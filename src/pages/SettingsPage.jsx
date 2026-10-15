import { useState, useEffect } from 'react'
import { api } from '../api.js'

const KEY_FIELDS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom_openai', label: '自定义 OpenAI 兼容' },
]
const MODEL_CANDIDATES = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openrouter: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat'],
  custom_openai: [],
}

function SettingsPage() {
  const [form, setForm] = useState(null)
  const [keyInput, setKeyInput] = useState('')
  const [modelOptions, setModelOptions] = useState([])
  const [detecting, setDetecting] = useState(false)
  const [usage, setUsage] = useState(null)
  const [daily, setDaily] = useState(null)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    api.getAiSettings().then((f) => setForm(f)).catch((e) => setErr(e.message))
    api.usageTrend().then(setUsage).catch(() => {})
    api.usageDaily(14).then(setDaily).catch(() => {})
  }, [])
  useEffect(() => {
    if (!msg && !err) return
    const t = setTimeout(() => { setMsg(null); setErr(null) }, err ? 5000 : 2500)
    return () => clearTimeout(t)
  }, [msg, err])
  const collectKeyPatch = () => { const k = (keyInput || '').trim(); const apiKeys = {}; if (k) apiKeys[form?.provider] = k; return apiKeys }
  const save = async () => {
    if (!form) return
    setMsg(null); setErr(null)
    try {
      const saved = await api.saveAiSettings({ provider: form.provider, baseUrl: form.baseUrl, model: form.model, enabled: form.enabled, pointsProvider: form.pointsProvider || '', apiKeys: collectKeyPatch() })
      setForm(saved); setKeyInput(''); setMsg('已保存')
    } catch (e) { setErr(e.message) }
  }
  const test = async () => {
    if (!form) return
    setMsg(null); setErr(null)
    try {
      const r = await api.testAi({ provider: form.provider, baseUrl: form.baseUrl, model: form.model, apiKeys: collectKeyPatch() })
      if (!r.ok) { setMsg(r.error); return }
      // 连接成功后自动检测模型列表，填充下拉候选
      setDetecting(true)
      try {
        const m = await api.listAiModels({ provider: form.provider, baseUrl: form.baseUrl, apiKeys: collectKeyPatch() })
        const models = (m.models || []).filter((x) => typeof x === 'string')
        setModelOptions(models)
        setMsg(models.length ? `连接成功，检测到 ${models.length} 个模型` : '连接成功')
      } catch {
        setMsg('连接成功')
      } finally {
        setDetecting(false)
      }
    } catch (e) { setErr(e.message) }
  }
  // 加载中不渲染占位框（避免闪现）；失败时显示错误
  if (!form) return err ? <div className="card"><div className="alert error">加载配置失败：{err}</div></div> : null
  const providerLabel = (KEY_FIELDS.find((f) => f.value === form.provider) || { label: form.provider }).label
  // 切换 Provider 时：Base URL/Model 自动填充默认值，API Key 输入框自动切到该模型（清空待输入内容）
  const applyProvider = (provider) => {
    const d = provider === 'points' ? {} : (form.defaults[provider] || {})
    setForm({ ...form, provider, baseUrl: d.baseUrl || form.baseUrl, model: d.model || form.model, pointsProvider: provider === 'points' ? 'points' : '' })
    setKeyInput('')
    setModelOptions([])
  }
  // 积分模式下拉候选：全部常用模型 + 当前已填值；检测后的候选：检测到的模型 + 当前已填值（允许自定义输入）
  const allModelCandidates = [...new Set([...(modelOptions || []), ...Object.values(MODEL_CANDIDATES).flat(), form.model].filter(Boolean))]
  const detectedCandidates = [...new Set([...(modelOptions || []), form.model].filter(Boolean))]
  // 积分模式候选：管理端配置的积分模型 + 当前已填值；未配置时回退到常用模型
  const pointsCandidates = [...new Set([...(form.pointsModels || []).map((m) => m.model), form.model].filter(Boolean))]
  return <>
    {(msg || err) && <div className={err ? 'alert error' : 'alert info'} style={{ position: 'fixed', top: 90, right: 36, zIndex: 100, margin: 0, maxWidth: 380, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>{err || msg}</div>}
    <div className="grid" style={{ alignItems: 'stretch' }}>
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}><h3 style={{ marginTop: 0 }}>模型配置</h3>
      <div className="form-grid">
        <div className="tri-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field"><label>Provider</label><select value={form.provider} onChange={(e) => applyProvider(e.target.value)}><option value="points">积分</option><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="openrouter">OpenRouter</option><option value="custom_openai">自定义 OpenAI 兼容</option></select></div>
          <div className="field"><label>Model</label>
            {form.provider === 'points' ? (
              <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} style={{ width: '100%' }}>
                {!form.model && <option value="">选择模型</option>}
                {(pointsCandidates.length ? pointsCandidates : allModelCandidates).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : modelOptions.length > 0 ? (
              <>
                <input list="model-detected-list" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="选择或输入模型" autoComplete="off" />
                <datalist id="model-detected-list">{detectedCandidates.map((m) => <option key={m} value={m} />)}</datalist>
              </>
            ) : (
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="测试连接后可从列表选择，或直接输入模型名" autoComplete="off" />
            )}
          </div>
        </div>
        {form.provider === 'points' && <div className="field full"><div className="muted" style={{ fontSize: 12 }}>积分模式：按右侧价格表计费</div></div>}
        <div className="field full"><label>Base URL</label><input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} disabled={form.provider === 'points'} placeholder={form.provider === 'points' ? '积分模式无需配置' : ''} /></div>
        <div className="field full"><label>API Key（{providerLabel}）</label><input type="text" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder={((form.apiKeys || {})[form.provider]) ? '已保存key' : 'sk-...'} autoComplete="off" disabled={form.provider === 'points'} /></div>
        <div className="field full"><label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} style={{ width: 16, height: 16 }} />启用 AI（关闭走本地启发式）</label></div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>每个模型独立保存 Key，切换 Provider 自动切换对应 Key</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 14 }}><button className="btn primary" onClick={save}>保存</button><button className="btn" onClick={test} disabled={detecting || form.provider === 'points'}>{detecting ? '检测中…' : '测试连接'}</button></div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card"><h3 style={{ marginTop: 0 }}>用量趋势</h3>
        {usage ? (
          <div><table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><thead><tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}><th style={{ padding: 6 }}>能力</th><th>调用次</th><th>输入token</th><th>输出token</th><th>均耗时ms</th></tr></thead>
            <tbody>{usage.totals.map((t) => <tr key={t.step} style={{ borderBottom: '1px solid var(--border-soft)' }}><td style={{ padding: 6 }}>{t.step}</td><td>{t.calls}</td><td>{t.input_tokens}</td><td>{t.output_tokens}</td><td>{t.avg_ms}</td></tr>)}</tbody></table></div>
        ) : <div className="muted">暂无用量数据</div>}
      </div>
      <div className="card" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', height: 189, overflow: 'hidden' }}><h3 style={{ marginTop: 0, flexShrink: 0 }}>价格表</h3>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}><th style={{ padding: 6 }}>模型</th><th style={{ padding: 6 }}>每 1M token</th><th style={{ padding: 6 }}>状态</th></tr></thead>
            <tbody>{(form.pointsModels || []).length ? form.pointsModels.map((m) => (
              <tr key={m.model} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                <td style={{ padding: 6 }}>{m.model}</td>
                <td style={{ padding: 6 }}>{m.pricePerM} 积分</td>
                <td style={{ padding: 6 }}>{form.provider === 'points' && form.model === m.model ? <span className="chip acc">启用中</span> : <span className="muted">—</span>}</td>
              </tr>
            )) : <tr><td colSpan={3} style={{ padding: 8, color: 'var(--text-dim)' }}>暂未配置积分模型（管理员在管理端设置后自动同步）</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div className="card" style={{ gridColumn: '1 / -1' }}><h3 style={{ marginTop: 0 }}>每日每功能用量（近 14 天）</h3>{daily ? (
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><thead><tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}><th style={{ padding: 6 }}>日期</th><th>能力</th><th>调用次</th><th>输入token</th><th>输出token</th><th>耗时(秒)</th><th>成功</th></tr></thead>
        <tbody>{daily.map((r, i) => <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}><td style={{ padding: 6 }}>{r.day}</td><td>{r.step}</td><td>{r.calls}</td><td>{r.input_tokens}</td><td>{r.output_tokens}</td><td>{r.seconds}</td><td>{r.ok_calls}/{r.calls}</td></tr>)}</tbody></table></div>
    ) : <div className="muted">暂无用量数据</div>}</div>
    </div>
  </>
}


export default SettingsPage
