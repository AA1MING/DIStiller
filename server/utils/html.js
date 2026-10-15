import { zipStore } from './docx.js'
import { Buffer } from 'node:buffer'

/**
 * HTML 文档转换：
 * - htmlToDocx：HTML（内联样式）→ docx（Word 正式版本）
 * - htmlToMarkdown：HTML → markdown（供 pdf/md 导出与版本库）
 * - textToBasicHtml：markdown 文本 → 基础 HTML（无 AI 时的模板回退）
 * 纯 Node 实现，不引入外部依赖。
 */

function escXml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 解析 style="..." 内联样式 → { fontSizePt, color, bold, italic, align, background, fontFamily }。 */
export function parseInlineStyle(style) {
  const out = {}
  for (const decl of String(style || '').split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const k = decl.slice(0, idx).trim().toLowerCase()
    const v = decl.slice(idx + 1).trim()
    if (k === 'font-size') {
      const m = v.match(/^([\d.]+)(px|pt)$/)
      if (m) out.fontSizePt = m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1])
    } else if (k === 'color' && /^#[0-9a-f]{6}$/i.test(v)) out.color = v
    else if (k === 'text-align' && ['left', 'center', 'right', 'justify'].includes(v)) out.align = v
    else if (k === 'background-color' && /^#[0-9a-f]{6}$/i.test(v)) out.background = v
    else if (k === 'font-weight' && (v === 'bold' || Number(v) >= 600)) out.bold = true
    else if (k === 'font-style' && v === 'italic') out.italic = true
    else if (k === 'font-family') out.fontFamily = v.replace(/['"]/g, '')
  }
  return out
}

/** 简易 HTML 解析：标签栈 → 节点树 [{ tag, attrs, children }]，文本为 { text }。
 * 支持 DOCTYPE/注释/处理指令跳过、style/script 内容跳过、相邻文本合并。 */
export function parseHtml(html) {
  const root = { tag: '#root', children: [] }
  const stack = [root]
  const tokenRe = /<(?:!DOCTYPE[^>]*>|--[\s\S]*?-->|\?[\s\S]*?\?>)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([\s\S]+?)(?=<|$)/g
  const pushText = (text) => {
    const trimmed = String(text)
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ').trim()
    if (!trimmed) return
    const kids = stack[stack.length - 1].children
    const last = kids[kids.length - 1]
    if (last && last.text != null) last.text += ' ' + trimmed
    else kids.push({ text: trimmed })
  }
  let skipTag = null
  let m
  while ((m = tokenRe.exec(String(html || ''))) !== null) {
    const token = m[0]
    if (token[0] !== '<') { pushText(m[5]); continue }
    if (token.startsWith('<!') || token.startsWith('<?')) continue
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const selfClose = m[4] === '/'
    if (skipTag) {
      if (closing && tag === skipTag) skipTag = null
      continue
    }
    if (tag === 'style' || tag === 'script') { if (!closing && !selfClose) skipTag = tag; continue }
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break }
      }
      continue
    }
    const attrsRaw = m[3] || ''
    const attrs = {}
    const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
    let am
    while ((am = attrRe.exec(attrsRaw)) !== null) attrs[am[1].toLowerCase()] = am[3] ?? am[4]
    const node = { tag, attrs, children: [] }
    stack[stack.length - 1].children.push(node)
    if (!selfClose && !['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tag)) stack.push(node)
  }
  return root.children
}

/** 收集节点内全部文本（用于 fallback）。 */
export function nodeText(node) {
  if (node.text != null) return node.text
  return (node.children || []).map(nodeText).join('')
}

/** HTML → markdown（结构保留：标题/列表/表格/段落）。 */
export function htmlToMarkdown(html) {
  const out = []
  const walk = (nodes, listDepth = 0) => {
    for (const n of nodes) {
      if (n.text != null) { out.push(n.text); continue }
      const tag = n.tag
      if (tag === 'head' || tag === 'title' || tag === 'style' || tag === 'script' || tag === 'meta') continue
      const text = nodeText(n).replace(/\s+/g, ' ').trim()
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') { out.push(''); out.push('#'.repeat(Number(tag[1])) + ' ' + text); out.push(''); continue }
      if (tag === 'p') { out.push(''); out.push(text); continue }
      if (tag === 'li') { out.push('  '.repeat(listDepth) + '- ' + text); continue }
      if (tag === 'ul' || tag === 'ol') { walk(n.children, listDepth + 1); continue }
      if (tag === 'table') {
        const rows = n.children.filter((c) => c.tag === 'tr')
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].children.filter((c) => c.tag === 'td' || c.tag === 'th').map(nodeText).map((t) => t.replace(/\|/g, '\\|'))
          out.push(`| ${cells.join(' | ')} |`)
          if (i === 0) out.push(`| ${cells.map(() => '---').join(' | ')} |`)
        }
        out.push('')
        continue
      }
      if (tag === 'blockquote') { out.push('> ' + text); continue }
      if (tag === 'pre' || tag === 'code') { out.push(''); out.push('```'); out.push(nodeText(n)); out.push('```'); out.push(''); continue }
      if (tag === 'br') { out.push('\n'); continue }
      if (tag === 'hr') { out.push(''); out.push('---'); out.push(''); continue }
      // div/span/strong/em/a/body 等：递归
      walk(n.children, listDepth)
    }
  }
  walk(parseHtml(stripFence(html)))
  return out.map((l, i) => (l === '' && out[i - 1] === '' ? null : l)).filter((l) => l !== null).join('\n').trim()
}

/** 剥掉 AI 输出可能的 markdown 代码围栏（```html ... ```）。 */
export function stripFence(html) {
  return String(html || '').replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
}

/** 收集目录条目（li 文本 + 嵌套层级）。 */
function collectTocItems(nodes, depth = 1, items = []) {
  for (const n of nodes) {
    if (n.tag === 'li') {
      const text = nodeText(n).replace(/\s+/g, ' ').trim()
      if (text) items.push({ text, level: depth })
      if (n.children) collectTocItems(n.children, depth + 1, items)
    } else if (n.tag === 'ul' || n.tag === 'ol') {
      collectTocItems(n.children, depth + 1, items)
    }
  }
  return items
}

/** 在目录标题之后寻找目录列表：跨空容器（div/nav/section/p 等）查找第一个 ul/ol，
 * 遇到下一个标题/有文本的段落/表格则停止，避免误把正文列表当目录。
 * fromIdx 从原数组起始索引查找，保证 splice 替换作用于原数组。 */
function findTocList(nodes, fromIdx = 0, depth = 0) {
  if (depth > 4) return null
  for (let i = fromIdx; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.tag === 'h1' || n.tag === 'h2' || n.tag === 'h3' || n.tag === 'h4' || n.tag === 'table') return null
    if ((n.tag === 'p' || n.tag === 'li') && nodeText(n).trim()) return null
    if (n.tag === 'ul' || n.tag === 'ol') return { nodes, i }
    if (n.children && n.children.length) {
      const r = findTocList(n.children, 0, depth + 1)
      if (r) return r
    }
  }
  return null
}

/** 递归标记目录章节：标题（去空格后为「目录」）后的 ul/ol 列表替换为 { tag: 'toc', items } 节点。 */
export function markToc(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if ((n.tag === 'h1' || n.tag === 'h2' || n.tag === 'h3' || n.tag === 'h4') && nodeText(n).trim().replace(/\s+/g, '') === '目录') {
      const r = findTocList(nodes, i + 1)
      if (r) {
        const items = collectTocItems([r.nodes[r.i]])
        r.nodes.splice(r.i, 1, { tag: 'toc', items })
      }
    }
    if (n.children) markToc(n.children)
  }
  return nodes
}

/** Word 原生目录域 + 静态目录兜底：不更新域的工具也能看到章节列表（可点击跳转）；
 * Word 打开后自动更新为带页码目录（updateFields）。 */
function tocFieldXml(items = [], headingTexts = []) {
  const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/^[-—–·•\d.\s]+/, '')
  const anchorOf = (text) => {
    const t = norm(text)
    if (!t) return null
    const idx = headingTexts.findIndex((h) => norm(h) === t)
    if (idx >= 0) return idx + 1
    const idx2 = headingTexts.findIndex((h) => norm(h).endsWith(t) || t.endsWith(norm(h)))
    return idx2 >= 0 ? idx2 + 1 : null
  }
  const staticEntries = items.length
    ? items.map((it) => {
      const bkN = anchorOf(it.text)
      const runs = bkN
        ? `<w:hyperlink w:anchor="toc_${bkN}" w:history="1"><w:r><w:t xml:space="preserve">${escXml(it.text)}</w:t></w:r></w:hyperlink>`
        : `<w:r><w:t xml:space="preserve">${escXml(it.text)}</w:t></w:r>`
      return `<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:ind w:left="${Math.max(0, (it.level - 1) * 360)}"/></w:pPr>${runs}</w:p>`
    }).join('')
    : '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>（在 Word 中打开后将自动生成目录）</w:t></w:r></w:p>'
  return `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>${staticEntries}<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
}

/** HTML → docx Buffer。样式来自内联 style（字体/字号/颜色/对齐/加粗）。 */
export function htmlToDocx(html, title = '文档') {
  const nodes = markToc(parseHtml(stripFence(html)))
  const body = []

  // 预收集正文章节标题文本（顺序与渲染一致），供目录静态条目建立书签超链接
  const headingTexts = []
  const collectHeadings = (ns) => {
    for (const n of ns) {
      if (n.tag === 'toc') continue
      if (n.tag === 'h1' || n.tag === 'h2' || n.tag === 'h3' || n.tag === 'h4') headingTexts.push(nodeText(n).replace(/\s+/g, ''))
      if (n.children) collectHeadings(n.children)
    }
  }
  collectHeadings(nodes)
  let bkSeq = 0

  const szHalf = (pt) => Math.round((pt || 12) * 2)
  const jcMap = { center: 'center', right: 'right', justify: 'both', left: 'left' }

  const runXml = (text, s) => {
    const rpr = []
    if (s.fontSizePt) rpr.push(`<w:sz w:val="${szHalf(s.fontSizePt)}"/><w:szCs w:val="${szHalf(s.fontSizePt)}"/>`)
    if (s.color) rpr.push(`<w:color w:val="${s.color.slice(1).toUpperCase()}"/>`)
    if (s.bold) rpr.push('<w:b/>')
    if (s.italic) rpr.push('<w:i/>')
    if (s.fontFamily) rpr.push(`<w:rFonts w:ascii="${escXml(s.fontFamily)}" w:hAnsi="${escXml(s.fontFamily)}" w:eastAsia="${escXml(s.fontFamily)}"/>`)
    return `<w:r>${rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`
  }

  const paraXml = (runs, s = {}, style = null, indent = null) => {
    const ppr = []
    if (style) ppr.push(`<w:pStyle w:val="${style}"/>`)
    if (s.align && jcMap[s.align]) ppr.push(`<w:jc w:val="${jcMap[s.align]}"/>`)
    if (indent) ppr.push(`<w:ind w:left="${indent}"/>`)
    if (s.background) ppr.push(`<w:shd w:val="clear" w:fill="${s.background.slice(1).toUpperCase()}"/>`)
    return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${runs}</w:p>`
  }

  const hStyle = { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3', 4: 'Heading4' }
  const hBase = { 1: 22, 2: 17, 3: 14, 4: 12 }

  const renderInline = (children, parentStyle = {}) => {
    let runs = ''
    for (const c of children) {
      if (c.text != null) { runs += runXml(c.text, parentStyle); continue }
      const s = { ...parentStyle, ...parseInlineStyle(c.attrs.style) }
      if (c.tag === 'strong' || c.tag === 'b') s.bold = true
      if (c.tag === 'em' || c.tag === 'i') s.italic = true
      if (c.tag === 'br') runs += '<w:r><w:br/></w:r>'
      else runs += renderInline(c.children || [], s)
    }
    return runs
  }

  const renderBlock = (nodes, listDepth = 0) => {
    for (const n of nodes) {
      if (n.text != null) { if (n.text.trim()) body.push(paraXml(runXml(n.text.trim(), {}))); continue }
      const tag = n.tag
      if (tag === 'head' || tag === 'title' || tag === 'style' || tag === 'script' || tag === 'meta') continue
      if (tag === 'toc') { body.push(tocFieldXml(n.items || [], headingTexts)); continue }
      const s = parseInlineStyle(n.attrs?.style || '')
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
        const lv = Number(tag[1])
        const bkN = 'toc_' + (++bkSeq)
        // 书签：Word 更新目录域 & 静态目录超链接的跳转锚点
        const runs = `<w:bookmarkStart w:id="${bkSeq}" w:name="${bkN}"/>${renderInline(n.children, { fontSizePt: s.fontSizePt || hBase[lv], bold: true })}<w:bookmarkEnd w:id="${bkSeq}"/>`
        body.push(paraXml(runs, s, hStyle[lv]))
        continue
      }
      if (tag === 'p') { body.push(paraXml(renderInline(n.children, { fontSizePt: s.fontSizePt }), s)); continue }
      if (tag === 'li') { body.push(paraXml(renderInline(n.children, { fontSizePt: s.fontSizePt }), s, null, 360 + listDepth * 360)); continue }
      if (tag === 'ul' || tag === 'ol') { renderBlock(n.children, listDepth + 1); continue }
      if (tag === 'table') {
        const rows = n.children.filter((c) => c.tag === 'tr')
        const allRows = rows.map((r) => r.children.filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => ({ text: nodeText(c), s: parseInlineStyle(c.attrs.style), th: c.tag === 'th' })))
        if (allRows.length) {
          const colCount = Math.max(...allRows.map((r) => r.length), 1)
          const width = Math.floor(8800 / colCount)
          const grid = `<w:tblGrid>${'<w:gridCol w:w="' + width + '"/>'.repeat(colCount)}</w:tblGrid>`
          const rowXml = (cells) => {
            const tc = Array.from({ length: colCount }, (_, i) => {
              const c = cells[i] || { text: '', s: {}, th: false }
              const cs = { ...c.s, bold: c.th || c.s.bold }
              const shd = c.th ? '<w:shd w:val="clear" w:fill="DDE3EC"/>' : c.s.background ? `<w:shd w:val="clear" w:fill="${c.s.background.slice(1).toUpperCase()}"/>` : ''
              return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shd}</w:tcPr><w:p>${runXml(c.text, { fontSizePt: cs.fontSizePt || 10.5, bold: cs.bold })}</w:p></w:tc>`
            }).join('')
            return `<w:tr>${tc}</w:tr>`
          }
          body.push(`<w:tbl><w:tblPr><w:tblW w:w="8800" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="9CA3AF"/><w:left w:val="single" w:sz="4" w:color="9CA3AF"/><w:bottom w:val="single" w:sz="4" w:color="9CA3AF"/><w:right w:val="single" w:sz="4" w:color="9CA3AF"/><w:insideH w:val="single" w:sz="4" w:color="9CA3AF"/><w:insideV w:val="single" w:sz="4" w:color="9CA3AF"/></w:tblBorders></w:tblPr>${grid}${allRows.map(rowXml).join('')}</w:tbl>`)
          body.push(paraXml(''))
        }
        continue
      }
      if (tag === 'blockquote') { body.push(paraXml(renderInline(n.children, { italic: true }), { ...s, align: 'left' }, 'Quote', 480)); continue }
      if (tag === 'pre') {
        const lines = nodeText(n).split('\n')
        body.push(`<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${lines.map((l, i) => `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/></w:rPr><w:t xml:space="preserve">${escXml(l)}</w:t>${i < lines.length - 1 ? '<w:br/>' : ''}</w:r>`).join('')}</w:p>`)
        continue
      }
      if (tag === 'hr') { body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="C4CBD6"/></w:pBdr></w:pPr></w:p>'); continue }
      if (tag === 'br') { body.push(paraXml('<w:r><w:br/></w:r>')); continue }
      // div/section/span/body 等容器：递归
      renderBlock(n.children || [], listDepth)
    }
  }
  renderBlock(nodes)

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="21"/></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:autoRedefine/><w:pPr><w:keepNext/><w:spacing w:before="40" w:after="40"/><w:outlineLvl w:val="9"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="TOC1"/><w:next w:val="Normal"/><w:autoRedefine/><w:pPr><w:ind w:left="240"/><w:outlineLvl w:val="9"/></w:pPr><w:rPr><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="TOC1"/><w:next w:val="Normal"/><w:autoRedefine/><w:pPr><w:ind w:left="480"/><w:outlineLvl w:val="9"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="480"/></w:pPr><w:rPr><w:i/><w:color w:val="64748B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="CodeBlock"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="80" w:after="80"/><w:shd w:val="clear" w:fill="EEF1F5"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>`

  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(stylesXml, 'utf8') },
    { name: 'word/settings.xml', data: Buffer.from(settingsXml, 'utf8') },
  ])
}

/** markdown 文本 → 基础 HTML（无 AI 时的模板/回退）。 */
export function textToBasicHtml(text, title = '文档') {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = String(text || '').split('\n')
  const body = []
  let inCode = false
  let listOpen = false
  for (const raw of lines) {
    const t = raw.trim()
    if (/^\s*```/.test(t)) {
      if (inCode) { body.push('</pre>'); inCode = false }
      else { body.push('<pre>'); inCode = true }
      continue
    }
    if (inCode) { body.push(esc(raw)); continue }
    if (!t) continue
    const hm = t.match(/^(#{1,4})\s+(.*)$/)
    if (hm) { body.push(`${'<h' + hm[1].length + '>'}${esc(hm[2])}</h${hm[1].length}>`); continue }
    if (/^[-*] /.test(t)) { if (!listOpen) { body.push('<ul>'); listOpen = true } body.push(`<li>${esc(t.replace(/^[-*] /, ''))}</li>`); continue }
    if (/^\d+\. /.test(t)) { body.push(`<p style="text-indent:1em">${esc(t)}</p>`); continue }
    if (/^\|/.test(t)) { body.push(`<p>${esc(t.replace(/\|/g, ' | '))}</p>`); continue }
    body.push(`<p>${esc(t)}</p>`)
  }
  if (inCode) body.push('</pre>')
  if (listOpen) body.push('</ul>')
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:'宋体',serif;font-size:14px;line-height:1.7;max-width:820px;margin:0 auto;padding:24px">${body.join('\n')}</body></html>`
}
