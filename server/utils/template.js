import { inflateSync } from 'node:zlib'
import { zipEntries } from '../services/import.js'

/**
 * 成果模板解析：支持 txt / md / docx / pdf，输出 Markdown 化文本。
 * docx 解析保留标题层级（Heading/大纲级别 → #）、净化目录域代码、表格转 markdown 表格。
 * 纯 Node 实现，不引入外部依赖。
 */

function decodeEntities(xml) {
  return xml
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/** 提取段落内所有 <w:t> 文本，保留 <w:tab>（→\\t）与 <w:br>（→\\n）。 */
function paragraphText(xml) {
  const runs = []
  const re = /<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    if (m[0].startsWith('<w:tab')) runs.push('\t')
    else if (m[0].startsWith('<w:br')) runs.push('\n')
    else runs.push(m[1])
  }
  return decodeEntities(runs.join('')).trim()
}

/** 从段落 pPr 推断标题级别（Heading 样式或大纲级别），无则 0。 */
function headingLevel(pPrXml) {
  const style = pPrXml.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/i)?.[1] || ''
  const m = style.match(/Heading\s*(\d)|标题\s*(\d)/i)
  if (m) return Math.min(Number(m[1] || m[2]), 6)
  const ol = pPrXml.match(/<w:outlineLvl\b[^>]*w:val="(\d+)"/i)?.[1]
  if (ol != null) return Math.min(Number(ol) + 1, 6)
  return 0
}

/** 净化 Word 目录域代码：HYPERLINK/PAGEREF 指令 → 只剩章节名。 */
function cleanTocText(text) {
  return text
    .replace(/HYPERLINK\s+\\l\s+\\?_?Toc\d+["']?\s*/gi, '')
    .replace(/PAGEREF\s+\\?_?Toc\d+\s*\\h\s*["']?\d+["']?\s*/gi, '')
    .replace(/TOC\s+\\o\s*["'][^"']*["']\s*\\h\s*\\u\s*/gi, '')
    .trim()
}

function parseDocxParagraph(block, state) {
  const pPr = block.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/) || ['', '']
  const pPrXml = pPr[0]
  const text = paragraphText(block)
  // 目录域开始段（TOC 指令）跳过
  if (/TOC\s+\\o\s+["']/.test(text) && text.length < 60) return ''
  if (!text) return ''
  // 目录章节开始：其后带页码的行视为目录条目
  if (text === '目录') { state.inToc = true; return '目录' }
  // 样式/大纲级别标题优先
  const styleLevel = headingLevel(pPrXml)
  if (styleLevel > 0) { state.inToc = false; return `${'#'.repeat(styleLevel)} ${cleanTocText(text)}` }
  // 目录区：带页码（tab+数字）的编号行 → 缩进列表条目
  if (state.inToc && /^\d+(?:\.\d+)*\.?\s+\S/.test(text) && /\t\d+$/.test(text)) {
    const parts = text.split(/\t/)
    const name = parts[0].trim()
    const level = name.match(/^\d+(?:\.\d+)*/)[0].split('.').length
    if (level > 1) return '  '.repeat(level - 1) + '- ' + name
    return '- ' + name
  }
  // 正文章节编号 → 标题层级（1. → 1 级，1.1 → 2 级，2.1.1 → 3 级）
  const numLevel = headingLevelByNumber(text)
  if (numLevel > 0) { state.inToc = false; return `${'#'.repeat(numLevel)} ${text}` }
  // 含 HYPERLINK/PAGEREF 的目录条目段：净化后保留（让 AI 看到目录结构）
  if (/HYPERLINK|PAGEREF/.test(text)) {
    const cleaned = cleanTocText(text)
    return cleaned ? cleaned : ''
  }
  return text
}

/** 章节编号 → 标题层级：1. → 1，1.1 → 2，2.1.1 → 3。"1.Windows"（编号后无空格）不算。 */
function headingLevelByNumber(text) {
  const m = text.match(/^(\d+(?:\.\d+)*)\.?\s+\S/)
  if (!m) return 0
  return Math.min(m[1].split('.').length, 6)
}

function parseDocxTable(block) {
  const rows = []
  const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/g
  let m
  while ((m = trRe.exec(block)) !== null) {
    const cells = []
    const tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/g
    let c
    while ((c = tcRe.exec(m[0])) !== null) {
      const pRe = /<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g
      let pm
      let cellText = ''
      while ((pm = pRe.exec(c[0])) !== null) cellText += (cellText ? ' ' : '') + paragraphText(pm[0])
      cells.push(cellText.replace(/\|/g, '\\|'))
    }
    rows.push(cells)
  }
  if (!rows.length) return ''
  const maxCols = Math.max(...rows.map((r) => r.length), 1)
  const lines = rows.map((r) => `| ${Array.from({ length: maxCols }, (_, i) => r[i] || '').join(' | ')} |`)
  // 第一行后插入分隔行（视为表头）
  if (lines.length > 1) lines.splice(1, 0, `| ${Array.from({ length: maxCols }, () => '---').join(' | ')} |`)
  return lines.join('\n')
}

/** docx → Markdown 化文本：标题带 #、目录域净化、表格转 markdown 表格。 */
function parseDocx(buf) {
  const entries = zipEntries(buf)
  const doc = entries.find((e) => e.name === 'word/document.xml')
  if (!doc) throw new Error('docx 中未找到 word/document.xml，可能不是有效的 Word 文档')
  const xml = doc.data.toString('utf8')
  const out = []
  const state = { inToc: false }
  const blockRe = /<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g
  let m
  while ((m = blockRe.exec(xml)) !== null) {
    const line = m[0].startsWith('<w:p') ? parseDocxParagraph(m[0], state) : parseDocxTable(m[0])
    if (line) out.push(line)
  }
  // 标题/表格前后加空行分段
  const merged = []
  for (const line of out) {
    const isBlock = /^#{1,6} /.test(line) || line.includes('|') || /^- /.test(line)
    if (isBlock && merged.length && merged[merged.length - 1] !== '') merged.push('')
    merged.push(line)
    if (isBlock) merged.push('')
  }
  return merged.filter((l, i) => !(l === '' && merged[i + 1] === '')).join('\n').trim()
}

/** PDF 文本提取：解压流，抽取 (..) Tj / [..] TJ 文本操作符。扫描型 PDF 提取不到。 */
export function parsePdf(buf) {
  const text = buf.toString('latin1')
  const chunks = []
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g
  let m
  let count = 0
  while ((m = streamRe.exec(text)) !== null && count < 200) {
    count++
    const raw = m[1]
    let data = Buffer.from(raw, 'latin1')
    const headerStart = Math.max(0, m.index - 600)
    const header = text.slice(headerStart, m.index)
    if (/\/FlateDecode/.test(header)) {
      try { data = inflateSync(data) } catch { continue }
    }
    const decoded = data.toString('latin1')
    const ops = /\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|"|TJ|(?=\s*\[))/g
    let om
    while ((om = ops.exec(decoded)) !== null) {
      chunks.push(om[1].replace(/\\([()\\])/g, '$1'))
    }
  }
  const out = chunks.join(' ')
  if (out.trim().length < 4) throw new Error('未能从 PDF 中提取到文本（可能是扫描件/图片型 PDF），请改用 Word 或 txt 模板')
  return out.replace(/\s+/g, ' ').trim()
}

/** 主入口：按文件名解析模板文件内容（base64）。 */
export function parseTemplate({ filename = '', content }) {
  const name = String(filename || '').toLowerCase()
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'base64')
  if (name.endsWith('.docx')) return parseDocx(buf)
  if (name.endsWith('.pdf')) return parsePdf(buf)
  // txt / md / 其它文本
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return buf.toString('utf8') }
}

/**
 * 提取 docx 模板的格式信息（导出时复用，保证字体/字号与模板一致）。
 * 返回：stylesXml（模板样式表原文）、headingStyleIds（标题级别→样式ID）、
 * headingSizes（标题级别→字号pt）、normalSize、settingsXml、hasToc。
 */
export function extractDocxFormat(buf) {
  const entries = zipEntries(buf)
  const styles = entries.find((e) => e.name === 'word/styles.xml')
  const settings = entries.find((e) => e.name === 'word/settings.xml')
  if (!styles) return null
  const stylesXml = styles.data.toString('utf8')
  const headingStyleIds = {}
  const headingSizes = {}
  let normalSize = 10.5
  const styleRe = /<w:style\b[^>]*w:styleId="([^"]+)"[\s\S]*?<\/w:style>/g
  let m
  while ((m = styleRe.exec(stylesXml)) !== null) {
    const id = m[1]
    const name = m[0].match(/<w:name w:val="([^"]+)"/)?.[1] || ''
    const hm = name.match(/heading\s*(\d)|标题\s*(\d)/i)
    if (hm) {
      const lv = Number(hm[1] || hm[2])
      headingStyleIds[lv] = id
      const sz = m[0].match(/<w:sz w:val="(\d+)"/)?.[1]
      if (sz) headingSizes[lv] = Number(sz) / 2
    }
    if (/^normal$/i.test(name)) {
      const sz = m[0].match(/<w:sz w:val="(\d+)"/)?.[1]
      if (sz) normalSize = Number(sz) / 2
    }
  }
  return {
    stylesXml,
    settingsXml: settings ? settings.data.toString('utf8') : '',
    headingStyleIds,
    headingSizes,
    normalSize,
    hasToc: /toc\s*\d/i.test(stylesXml),
  }
}
