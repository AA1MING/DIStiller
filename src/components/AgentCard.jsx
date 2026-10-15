import { useState, useEffect, useRef } from 'react'
import { AGENT_MASCOT, CLICK_DURATIONS, mascotHtml } from '../styles/mascots.js'

function AgentCard({ t, idx, active, onSelect }) {
  const [intro, setIntro] = useState(true)
  const [clicked, setClicked] = useState(false)
  const clickTimer = useRef(null)
  const mascotRef = useRef(null)
  const key = AGENT_MASCOT[t.id] || 'generic'

  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 1250 + idx * 90)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => clearTimeout(clickTimer.current), [])

  const handleClick = () => {
    onSelect?.()
    setClicked(true)
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => setClicked(false), CLICK_DURATIONS[key] || 600)

    // Copilot：点头震头 + 眼镜掉落再回归（移植自 PromptWithSkill）
    if (key === 'copilot' && mascotRef.current) {
      const head = mascotRef.current.querySelector('.cp-head')
      const glasses = mascotRef.current.querySelector('.cp-glasses')
      if (head && glasses) {
        head.classList.add('cp-shaking')
        setTimeout(() => {
          glasses.classList.remove('cp-returning')
          glasses.classList.add('cp-falling')
        }, 200)
        setTimeout(() => head.classList.remove('cp-shaking'), 500)
        setTimeout(() => {
          glasses.classList.remove('cp-falling')
          glasses.classList.add('cp-returning')
        }, 1300)
        setTimeout(() => glasses.classList.remove('cp-returning'), 1900)
      }
    }
  }

  const cls = ['task-item', 'agent-card', active ? 'active' : '', intro ? 'intro' : '', clicked ? 'is-clicked' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls} onClick={handleClick}
      style={{ cursor: 'pointer', '--stagger': `${idx * 90}ms`, borderColor: active ? 'var(--accent)' : undefined, background: active ? 'var(--surface-3)' : undefined }}>
      <div className="agent-mascot" ref={mascotRef} dangerouslySetInnerHTML={{ __html: mascotHtml(key) }} />
      <div className="t">{t.name}</div>
      <div className="muted" style={{ marginTop: 4 }}>{t.desc}</div>
    </div>
  )
}


export default AgentCard
