import { inflateRawSync } from 'node:zlib'
import { Buffer } from 'node:buffer'

/**
 * 导入蒸馏的前端文件解析：支持 txt / md / json / csv / docx，
 * 并识别主流 AI 对话导出（ChatGPT / Claude / DeepSeek / 通用 messages 结构）。
 */

function decodeEntities(xml) {
  return xml
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/** 在文件尾部定位 EOCD（PK\x05\x06），支持尾部带注释的 zip。 */
function findEocd(buf) {
  const tail = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= tail; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i
  }
  return -1
}

/** 优先用 central directory 解析（兼容 data descriptor：local 头大小写 0 的情况）。
 * 不支持的压缩方法标记 unsupported，加密条目标记 encrypted。 */
function centralEntries(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) return []
  const total = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  // zip64 或异常值：退回 local header 扫描
  if (total === 0 || total >= 0xfffe || cdOffset >= 0xfffffff0 || cdOffset >= buf.length) return []
  let pos = cdOffset
  const entries = []
  for (let n = 0; n < total; n++) {
    if (pos + 46 > buf.length || buf[pos] !== 0x50 || buf[pos + 1] !== 0x4b || buf[pos + 2] !== 0x01 || buf[pos + 3] !== 0x02) break
    const flags = buf.readUInt16LE(pos + 8)
    const method = buf.readUInt16LE(pos + 10)
    const compSize = buf.readUInt32LE(pos + 20)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8')
    const encrypted = (flags & 1) === 1
    let data = null
    let unsupported = false
    if (!encrypted && name && compSize > 0) {
      // 用 local header 的真实 nameLen/extraLen 定位数据（descriptor 模式下大小以 central 为准）
      let dataStart = -1
      if (localOffset + 30 <= buf.length && buf[localOffset] === 0x50 && buf[localOffset + 1] === 0x4b && buf[localOffset + 2] === 0x03 && buf[localOffset + 3] === 0x04) {
        const lNameLen = buf.readUInt16LE(localOffset + 26)
        const lExtraLen = buf.readUInt16LE(localOffset + 28)
        dataStart = localOffset + 30 + lNameLen + lExtraLen
      }
      if (dataStart >= 0 && dataStart + compSize <= buf.length) {
        if (method === 0) data = buf.subarray(dataStart, dataStart + compSize)
        else if (method === 8) { try { data = inflateRawSync(buf.subarray(dataStart, dataStart + compSize)) } catch { data = null } }
        else unsupported = true
      }
    }
    entries.push({ name, data, method, unsupported, encrypted })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 后备方案：扫描 local file header（central directory 缺失/zip64 时兜底）。 */
function scanLocalHeaders(buf) {
  const entries = []
  let i = 0
  const end = buf.length - 22
  while (i < end) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x03 || buf[i + 3] !== 0x04) { i++; continue }
    const flags = buf.readUInt16LE(i + 6)
    const method = buf.readUInt16LE(i + 8)
    const compSize = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extraLen = buf.readUInt16LE(i + 28)
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8')
    const encrypted = (flags & 1) === 1
    // data descriptor 模式（大小写 0）无法用 local 头定位，跳过（等 central 解析）
    const dataStart = i + 30 + nameLen + extraLen + (encrypted ? 12 : 0)
    if (name && !encrypted && compSize > 0 && dataStart + compSize <= buf.length) {
      let data = null
      let unsupported = false
      if (method === 0) data = buf.subarray(dataStart, dataStart + compSize)
      else if (method === 8) { try { data = inflateRawSync(buf.subarray(dataStart, dataStart + compSize)) } catch { data = null } }
      else unsupported = true
      entries.push({ name, data, method, unsupported, encrypted: false })
    }
    i = dataStart + compSize
  }
  return entries
}

/** ZIP 读取：优先 central directory（兼容 data descriptor / 注释），失败退回 local 扫描。 */
export function zipEntries(buf) {
  const fromCentral = centralEntries(buf)
  if (fromCentral.length) return fromCentral
  return scanLocalHeaders(buf)
}

/** docx → 纯文本（取 word/document.xml，保留段落换行）。 */
function parseDocx(buf) {
  const entries = zipEntries(buf)
  const doc = entries.find((e) => e.name === 'word/document.xml')
  if (!doc) throw new Error('docx 中未找到 word/document.xml，可能不是有效的 Word 文档')
  let xml = doc.data.toString('utf8')
  // 段落/表格/换行 → \n
  xml = xml.replace(/<\/w:p>|<\/w:tr>|<\/w:tc>/g, '\n')
  // 去掉所有标签
  xml = xml.replace(/<[^>]+>/g, '')
  // 去掉空行、压缩多空行为单行
  return decodeEntities(xml).split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
}

function textFromMessageContent(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((p) => {
      if (typeof p === 'string') return p
      if (p && typeof p === 'object') return p.text || p.content || ''
      return ''
    }).filter(Boolean).join('\n')
  }
  if (typeof content === 'object') return content.text || content.content || ''
  return ''
}

/** 宽松地识别各家 AI 对话导出，抽成 "角色：内容" 转录文本。 */
function extractConversation(json) {
  const lines = []
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    // 常见结构：{ role, content } 或 { role, message:{ role, content } }
    const role = node.role
    if (role && (node.content != null || node.message)) {
      const msg = node.message && typeof node.message === 'object' ? node.message : node
      const content = msg.content != null ? textFromMessageContent(msg.content) : textFromMessageContent(node.content)
      const label = role === 'user' ? '用户' : role === 'assistant' || role === 'system' ? 'AI' : role
      if (content.trim()) lines.push(`${label}：${content.trim()}`)
    }
    // ChatGPT 导出用 mapping 嵌套
    if (node.mapping && typeof node.mapping === 'object') Object.values(node.mapping).forEach(walk)
    // Claude jsonl 风格：type: user/assistant + message
    if (node.message) walk(node.message)
    // 通用：取 content/text/title/summary 字段
    for (const key of ['messages', 'conversations', 'data', 'items', 'chats']) {
      if (node[key] != null) walk(node[key])
    }
  }
  walk(json)
  return lines.filter(Boolean).join('\n')
}

/** 主入口：根据文件名/类型解析出蒸馏用文本。 */
export function parseImport({ filename = '', content, format }) {
  const name = String(filename || '').toLowerCase()
  const text = typeof content === 'string' ? content : Buffer.from(content || '').toString('utf8')
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(text, 'utf8')

  if (name.endsWith('.docx') || format === 'docx') return parseDocx(bytes)
  if (name.endsWith('.json') || name.endsWith('.jsonl') || format === 'json') {
    // 尝试解析 JSON（支持 jsonl 多行）
    let parsed = null
    const trimmed = text.trim()
    try { parsed = JSON.parse(trimmed) } catch {
      // 可能是 jsonl：逐行尝试
      const objs = trimmed.split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      if (objs.length) parsed = objs.length === 1 ? objs[0] : objs
    }
    if (parsed) {
      const conv = extractConversation(parsed)
      if (conv.trim()) return conv
      // 非对话 JSON：退回拼接有意义的文本字段
      const summary = JSON.stringify(parsed).replace(/[{}\[\]",]/g, ' ').replace(/\s+/g, ' ').trim()
      if (summary.length > 5) return summary
    }
    return trimmed
  }
  return text
}

/** 剪断：限制最大输入长度（避免超长粘贴）。 */
export function clampText(t, max = 60000) {
  return String(t || '').slice(0, max)
}