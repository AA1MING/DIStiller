import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api.js'
import WikiVisualizer from '../components/wiki/WikiVisualizer.jsx'
import { cachedGet, cachedFetch, pageDataAt, PAGE_DATA_TTL } from '../utils/cache.js'

function WikiPage({ active = true, startTask, endTask }) {
  const [galaxy, setGalaxy] = useState(() => cachedGet('wikiGalaxy') || null) // { graph, projects }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const aliveRef = useRef(true)
  const autoStartedRef = useRef(false)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const loadGalaxy = useCallback((force) => {
    // 命中统一缓存：立即展示，避免进入页面时白屏/卡顿；缓存过期则静默后台刷新
    const cached = cachedGet('wikiGalaxy')
    if (cached && !force) {
      setGalaxy(cached)
      if (Date.now() - (pageDataAt.get('wikiGalaxy') || 0) < PAGE_DATA_TTL) return
    }
    cachedFetch('wikiGalaxy', () => api.wikiGalaxy(), { force })
      .then((r) => { if (aliveRef.current) setGalaxy(r || null) })
      .catch((e) => { if (aliveRef.current) setError(e.message || String(e)) })
  }, [])

  useEffect(() => { if (active) loadGalaxy() }, [active, loadGalaxy])

  const generateMissing = async () => {
    const missing = (galaxy?.projects || []).filter((p) => !p.generated)
    if (!missing.length) return
    setBusy(true); setError(null)
    try {
      for (let i = 0; i < missing.length; i++) {
        const p = missing[i]
        startTask?.(`生成 Wiki 中…（${i + 1}/${missing.length}）`)
        await api.generateProjectWiki(p.id)
      }
      loadGalaxy(true)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false); endTask?.()
    }
  }

  // 打开页面即自动为未生成 Wiki 的项目生成知识库，星系立即成形（无需手动点击）
  useEffect(() => {
    if (!active || !galaxy || autoStartedRef.current) return
    const missing = (galaxy.projects || []).filter((p) => !p.generated)
    if (missing.length > 0) {
      autoStartedRef.current = true
      generateMissing()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, galaxy])

  const projects = galaxy?.projects || []
  const generatedCount = projects.filter((p) => p.generated).length
  const missing = projects.filter((p) => !p.generated)

  return (
    <div style={{ width: '100%', flex: 1, display: active ? 'flex' : 'none', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <WikiVisualizer mode="galaxy" active={active} graph={galaxy || undefined} />
      {error && <div className="alert error wiki-error-overlay">{error}</div>}
      {galaxy && projects.length === 0 && !busy && (
        <div className="wiki-empty">
          <div className="card">
            <h3>Wiki 知识星系</h3>
            <p>暂无项目。请先在「项目管理」新建项目，或从「需求蒸馏」生成项目。</p>
          </div>
        </div>
      )}
      {generatedCount > 0 && missing.length > 0 && (
        <button
          className="wiki-fab"
          onClick={generateMissing}
          disabled={busy}
          title={`为 ${missing.length} 个未生成项目生成 Wiki`}
          aria-label={`为 ${missing.length} 个未生成项目生成 Wiki`}
        >
          {busy ? (
            <span className="spin" />
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          )}
          <span className="wiki-fab-count">{missing.length}</span>
        </button>
      )}
    </div>
  )
}

// ===== 积分激励（用户端） =====

export default WikiPage
