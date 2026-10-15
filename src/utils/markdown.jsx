/** 轻量 markdown 渲染工具：聊天气泡与卡片内展示用，避免 AI 回复中的 ** # 等原样显示。 */

export function Section({ title, children }) {
  return <div><div className="section-title">{title}</div>{children}</div>
}

/** 残留 markdown 标记清理：跨行/不成对的 ** ` 等不再显示的标记直接剥离。 */
export function stripMd(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/~~/g, '')
    .replace(/^#{1,6}\s+/gm, '')
}

/** 行内 markdown：**粗体** / `代码` / *斜体* */
export function mdInline(text) {
  const parts = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let last = 0
  let m
  while ((m = re.exec(String(text || ''))) !== null) {
    if (m.index > last) parts.push(stripMd(text.slice(last, m.index)))
    const seg = m[1]
    if (seg.startsWith('**')) parts.push(<strong key={parts.length}>{seg.slice(2, -2)}</strong>)
    else if (seg.startsWith('`')) parts.push(<code key={parts.length}>{seg.slice(1, -1)}</code>)
    else parts.push(<em key={parts.length}>{seg.slice(1, -1)}</em>)
    last = m.index + seg.length
  }
  if (last < text.length) parts.push(stripMd(text.slice(last)))
  return parts.length ? parts : text
}

/** 轻量 markdown 渲染（聊天气泡用，避免 AI 回复中的 ** # 等原样显示）。 */
export function Md({ text }) {
  // 兜底：剥离 [mode:xxx] 模式标记（存量消息或模型复述时）
  const cleaned = String(text || '').replace(/^\s*\[mode:\w+\]\s*/gm, '')
  const lines = cleaned.split(/\r?\n/)
  const out = []
  let i = 0
  let inCode = false
  let codeBuf = []
  let listBuf = []
  const flushList = () => {
    if (listBuf.length) {
      out.push(<ul key={'ul' + out.length}>{listBuf.map((li, j) => <li key={j}>{mdInline(li)}</li>)}</ul>)
      listBuf = []
    }
  }
  while (i < lines.length) {
    const t = lines[i].trim()
    if (/^```/.test(t)) {
      flushList()
      if (inCode) { out.push(<pre key={'c' + out.length}>{codeBuf.join('\n')}</pre>); codeBuf = []; inCode = false }
      else inCode = true
      i++
      continue
    }
    if (inCode) { codeBuf.push(lines[i]); i++; continue }
    if (!t) { flushList(); i++; continue }
    const hm = t.match(/^(#{1,6})\s*(.*)$/)
    if (hm) {
      const body = hm[2].trim()
      if (body) {
        flushList()
        const lv = hm[1].length
        const rendered = mdInline(body)
        out.push(lv === 1 ? <h4 key={'h' + out.length}>{rendered}</h4> : lv === 2 ? <h5 key={'h' + out.length}>{rendered}</h5> : <h6 key={'h' + out.length}>{rendered}</h6>)
      }
      i++
      continue
    }
    if (/^[-*] /.test(t) || /^\d+\. /.test(t)) { listBuf.push(t.replace(/^[-*] |^\d+\. /, '')); i++; continue }
    if (/^>/.test(t)) { flushList(); out.push(<blockquote key={'b' + out.length}>{mdInline(t.replace(/^>\s?/, ''))}</blockquote>); i++; continue }
    flushList()
    out.push(<p key={'p' + out.length}>{mdInline(t)}</p>)
    i++
  }
  if (inCode && codeBuf.length) out.push(<pre key={'c' + out.length}>{codeBuf.join('\n')}</pre>)
  flushList()
  return <div className="md-body">{out}</div>
}
