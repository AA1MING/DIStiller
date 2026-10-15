import { createHash } from 'node:crypto'
import { db } from '../dao/db.js'

const STOPWORDS = new Set([
  '的', '了', '是', '和', '与', '在', '对', '把', '被', '有', '没', '不',
  '要', '能', '会', '很', '都', '也', '就', '这', '那', '我', '你', '他',
  '她', '它', '们', '一', '个', '中', '上', '下', '为', '等', '及', '或',
  '而', '并', '于', '从', '到', '让', '给', '将', '之', '其', '所', '若',
])

export function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').trim()
}

export function hashText(text) {
  return createHash('sha256').update(normalizeText(text)).digest('hex')
}

export function tokenize(text) {
  const tokens = new Set()
  const lower = String(text || '').toLowerCase()
  for (const m of lower.matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)) tokens.add(m[0])
  const cjk = lower.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < cjk.length - 1; i++) {
    const bigram = cjk.slice(i, i + 2)
    if (!STOPWORDS.has(bigram)) tokens.add(bigram)
  }
  return tokens
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

export function similarOpportunities(oppId, limit = 5) {
  const target = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId)
  if (!target) return []
  const targetTokens = tokenize(`${target.title} ${target.summary || ''} ${target.problem_statement || ''}`)
  const others = db.prepare('SELECT id, title, opportunity_score FROM opportunities WHERE id != ?').all(oppId)
  return others
    .map((o) => ({
      id: o.id,
      title: o.title,
      opportunity_score: o.opportunity_score,
      similarity: jaccard(targetTokens, tokenize(`${o.title}`)),
    }))
    .filter((s) => s.similarity > 0.12)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}
