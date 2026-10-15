import { crc32 } from 'node:zlib'
import { Buffer } from 'node:buffer'

/**
 * Markdown → DOCX：手写标准 docx（zip 打包 + word/document.xml），零依赖。
 * 供成果文档导出使用，支持标题/段落/列表/表格/代码块/引用/分隔线。
 */

/** 行级 markdown 解析：输出 token 列表，docx 与 pdf 渲染共用。
 * 识别「目录」章节：标题为「目录」时，其后连续的列表项合并为 toc token。 */
export function parseMarkdown(markdown) {
  const tokens = []
  const lines = String(markdown || '').split(/\r?\n/)
  let inCode = false
  let codeBuf = []
  let pendingTable = null
  let tocBuf = null
  const flushTable = () => {
    if (pendingTable) { tokens.push({ type: 'table', header: pendingTable.header, rows: pendingTable.rows }); pendingTable = null }
  }
  const flushToc = () => {
    if (tocBuf) { tokens.push({ type: 'toc', title: tocBuf.title, items: tocBuf.items }); tocBuf = null }
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*```/.test(line)) {
      if (inCode) { tokens.push({ type: 'code', text: codeBuf.join('\n') }); codeBuf = []; inCode = false }
      else inCode = true
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    const t = line.trim()
    if (!t) continue
    const hm = t.match(/^(#{1,4})\s+(.*)$/)
    if (hm) {
      flushTable()
      const title = hm[2].replace(/^#+\s*/, '')
      if (title.replace(/\s+/g, '') === '目录') { tocBuf = { title, items: [] }; continue }
      flushToc()
      tokens.push({ type: 'h' + hm[1].length, text: title })
      continue
    }
    if (tocBuf && /^[-*] /.test(t)) { tocBuf.items.push(t.replace(/^[-*] /, '').trim()); continue }
    if (/^\|/.test(t) && /\|$/.test(t)) {
      const cells = t.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        if (pendingTable && pendingTable.rows.length && !pendingTable.header) { pendingTable.header = pendingTable.rows.shift() }
        continue
      }
      if (!pendingTable) pendingTable = { header: null, rows: [] }
      pendingTable.rows.push(cells)
      continue
    }
    flushTable()
    if (/^[-*] /.test(t)) { tokens.push({ type: 'li', text: t.replace(/^[-*] /, '') }); continue }
    if (/^\d+\. /.test(t)) { tokens.push({ type: 'li', text: t.replace(/^\d+\. /, '') }); continue }
    if (/^>/.test(t)) { tokens.push({ type: 'quote', text: t.replace(/^>\s?/, '') }); continue }
    if (/^(-{3,}|\*{3,})$/.test(t)) { tokens.push({ type: 'hr' }); continue }
    tokens.push({ type: 'p', text: t })
  }
  if (inCode && codeBuf.length) tokens.push({ type: 'code', text: codeBuf.join('\n') })
  flushTable()
  flushToc()
  return tokens
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 行内简单格式：**粗体** / `代码` → run 序列 XML。 */
function inlineRuns(text) {
  const parts = []
  let rest = String(text || '')
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m
  while ((m = re.exec(rest)) !== null) {
    if (m.index > last) parts.push({ text: rest.slice(last, m.index), bold: false, code: false })
    const seg = m[1]
    if (seg.startsWith('**')) parts.push({ text: seg.slice(2, -2), bold: true, code: false })
    else parts.push({ text: seg.slice(1, -1), bold: false, code: true })
    last = m.index + seg.length
  }
  if (last < rest.length) parts.push({ text: rest.slice(last), bold: false, code: false })
  if (!parts.length) parts.push({ text: '', bold: false, code: false })
  return parts.map((p) => {
    const rpr = (p.bold ? '<w:b/>' : '') + (p.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:shd w:val="clear" w:fill="EEF1F5"/>' : '')
    return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r>`
  }).join('')
}

function paraXml(runs, style = null, indent = null) {
  const ppr = []
  if (style) ppr.push(`<w:pStyle w:val="${style}"/>`)
  if (indent) ppr.push(`<w:ind w:left="${indent}"/>`)
  return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${runs}</w:p>`
}

function codeParagraph(text) {
  const lines = String(text || '').split('\n')
  const runs = lines.map((l, i) => `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/></w:rPr><w:t xml:space="preserve">${esc(l)}</w:t>${i < lines.length - 1 ? '<w:br/>' : ''}</w:r>`).join('')
  return `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${runs}</w:p>`
}

function tableXml(header, rows) {
  const all = [header, ...rows].filter(Boolean)
  if (!all.length) return ''
  const colCount = Math.max(...all.map((r) => r.length), 1)
  const width = Math.floor(8800 / colCount)
  const grid = `<w:tblGrid>${'<w:gridCol w:w="' + width + '"/>'.repeat(colCount)}</w:tblGrid>`
  const rowXml = (cells, isHeader) => {
    const tc = Array.from({ length: colCount }, (_, i) => {
      const text = cells[i] || ''
      const rpr = isHeader ? '<w:rPr><w:b/></w:rPr>' : ''
      const shd = isHeader ? '<w:shd w:val="clear" w:fill="DDE3EC"/>' : ''
      return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shd}</w:tcPr><w:p>${rpr ? `<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>` : inlineRuns(text)}</w:p></w:tc>`
    }).join('')
    return `<w:tr>${tc}</w:tr>`
  }
  return `<w:tbl><w:tblPr><w:tblW w:w="8800" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="9CA3AF"/><w:left w:val="single" w:sz="4" w:color="9CA3AF"/><w:bottom w:val="single" w:sz="4" w:color="9CA3AF"/><w:right w:val="single" w:sz="4" w:color="9CA3AF"/><w:insideH w:val="single" w:sz="4" w:color="9CA3AF"/><w:insideV w:val="single" w:sz="4" w:color="9CA3AF"/></w:tblBorders></w:tblPr>${grid}${rowXml(header, true)}${rows.map((r) => rowXml(r, false)).join('')}</w:tbl>`
}

/** Word 原生目录域（打开文档自动更新页码）：TOC \o "1-3" \h \z \u。 */
function tocFieldXml() {
  return `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>（在 Word 中打开后将自动生成目录）</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
}

export function markdownToDocx(markdown, title = '文档', templateFormat = null) {
  const tokens = parseMarkdown(markdown)
  // 模板标题样式映射（模板 docx 的 heading styleId），缺省用 HeadingN
  const styleId = templateFormat?.headingStyleIds || {}
  const hStyle = (lv) => styleId[lv] || `Heading${lv}`
  const body = []
  for (const t of tokens) {
    switch (t.type) {
      case 'h1': body.push(paraXml(inlineRuns(t.text), hStyle(1))); break
      case 'h2': body.push(paraXml(inlineRuns(t.text), hStyle(2))); break
      case 'h3': body.push(paraXml(inlineRuns(t.text), hStyle(3))); break
      case 'h4': body.push(paraXml(inlineRuns(t.text), hStyle(4))); break
      case 'p': body.push(paraXml(inlineRuns(t.text), 'Normal')); break
      case 'li': body.push(paraXml(inlineRuns(`• ${t.text}`), 'Normal', 360)); break
      case 'quote': body.push(paraXml(inlineRuns(t.text), 'Quote')); break
      case 'code': body.push(codeParagraph(t.text)); break
      case 'hr': body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="C4CBD6"/></w:pBdr></w:pPr></w:p>'); break
      case 'table': body.push(tableXml(t.header, t.rows)); body.push(paraXml('', 'Normal')); break
      case 'toc':
        // 模板有目录样式时输出 Word 原生目录域；否则列出静态目录项
        if (templateFormat?.hasToc) {
          body.push(paraXml(inlineRuns(t.title), hStyle(1)))
          body.push(tocFieldXml())
        } else {
          body.push(paraXml(inlineRuns(t.title), hStyle(1)))
          for (const it of t.items) body.push(paraXml(inlineRuns(it), 'Normal', 360))
        }
        break
    }
  }
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
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="480"/></w:pPr><w:rPr><w:i/><w:color w:val="64748B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="CodeBlock"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="80" w:after="80"/><w:ind w:left="120" w:right="120"/><w:shd w:val="clear" w:fill="EEF1F5"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>`

  const stylesFinal = templateFormat?.stylesXml || stylesXml
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

  // settings：打开文档时自动更新域（目录页码）
  let settingsXml = ''
  if (templateFormat?.settingsXml && /<w:settings\b/.test(templateFormat.settingsXml)) {
    settingsXml = templateFormat.settingsXml.replace(/(<w:settings\b[^>]*>)/, '$1<w:updateFields w:val="true"/>')
  } else {
    settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>`
  }

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(stylesFinal, 'utf8') },
    { name: 'word/settings.xml', data: Buffer.from(settingsXml, 'utf8') },
  ]
  return zipStore(files)
}

/** 极简 zip 打包（store 无压缩），供 docx 使用。 */
export function zipStore(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const f of files) {
    const nb = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data) >>> 0
    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4)
    lfh.writeUInt16LE(0, 6)
    lfh.writeUInt16LE(0, 8)
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(f.data.length, 18)
    lfh.writeUInt32LE(f.data.length, 22)
    lfh.writeUInt16LE(nb.length, 26)
    lfh.writeUInt16LE(0, 28)
    localParts.push(lfh, nb, f.data)
    const ce = Buffer.alloc(46)
    ce.writeUInt32LE(0x02014b50, 0)
    ce.writeUInt16LE(20, 4)
    ce.writeUInt16LE(20, 6)
    ce.writeUInt16LE(0, 8)
    ce.writeUInt16LE(0, 10)
    ce.writeUInt32LE(crc, 16)
    ce.writeUInt32LE(f.data.length, 20)
    ce.writeUInt32LE(f.data.length, 24)
    ce.writeUInt16LE(nb.length, 28)
    ce.writeUInt16LE(0, 30)
    ce.writeUInt16LE(0, 32)
    ce.writeUInt16LE(0, 34)
    ce.writeUInt32LE(offset, 42)
    centralParts.push(ce, nb)
    offset += 30 + nb.length + f.data.length
  }
  const cdStart = localParts.reduce((s, b) => s + b.length, 0)
  const cdSize = centralParts.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, ...centralParts, eocd])
}
