/**
 * OpenWiki 知识图谱构建：移植自 openwiki-main/src/visualize/graph.ts（原版逻辑，
 * 输出格式与原版一致：{ root, generatedAt, types, nodes, edges }）。
 * 节点含 id/title/type/description/tags/body/size/links/backlinks，
 * 边为页面间的有向 markdown 链接。
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

// 生成脚手架文件不算真实 wiki 内容
const EXCLUDED_FILES = new Set(['INSTRUCTIONS.md', 'log.md', '_plan.md'])

// 匹配相对 markdown 链接目标（foo.md，可带 #锚点）
const MARKDOWN_LINK = /\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g

/** 去掉单双引号包裹。 */
function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, '')
}

/**
 * 拆分 YAML frontmatter 与正文；只解析 OpenWiki 生成的子集
 * （标量、行内 [a, b] 数组、破折号列表）。
 */
export function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: raw }
  const block = raw.slice(3, end).trim()
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1)
  const meta = {}
  let pendingListKey
  for (const line of block.split('\n')) {
    const listItem = line.match(/^\s*-\s+(.*)$/)
    if (listItem && pendingListKey) {
      meta[pendingListKey].push(stripQuotes(listItem[1].trim()))
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, rawValue] = kv
    const value = rawValue.trim()
    if (value === '') {
      pendingListKey = key
      meta[key] = []
    } else if (value.startsWith('[') && value.endsWith(']')) {
      pendingListKey = undefined
      meta[key] = value.slice(1, -1).split(',').map((item) => stripQuotes(item.trim())).filter(Boolean)
    } else {
      pendingListKey = undefined
      meta[key] = stripQuotes(value)
    }
  }
  return { meta, body }
}

/** 正文第一个 H1，无则 undefined。 */
export function firstHeading(body) {
  return body.match(/^#\s+(.+)$/m)?.[1].trim()
}

/** 绝对路径 → 稳定节点 id（相对 wiki 根目录，去掉 .md）。 */
export function toId(wikiRoot, fullPath) {
  return path.relative(wikiRoot, fullPath).replace(/\\/g, '/').replace(/\.md$/, '')
}

/** index 页标题：所在目录名首字母大写（根目录为 Home）。 */
function sectionTitle(file, wikiRoot) {
  const dir = path.dirname(file)
  const name = path.resolve(dir) === wikiRoot ? 'Home' : path.basename(dir)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** 正文里的所有相对 markdown 链接目标。 */
function markdownLinks(body) {
  return [...body.matchAll(MARKDOWN_LINK)].map((match) => match[1])
}

/** 递归收集目录下的 markdown 文件（跳过脚手架文件，不跟随符号链接）。 */
async function collectMarkdown(dir, wikiRoot, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.resolve(dir, entry.name)
    if (full !== wikiRoot && !full.startsWith(wikiRoot + path.sep)) continue
    if (entry.isDirectory()) {
      await collectMarkdown(full, wikiRoot, out)
    } else if (entry.isFile() && entry.name.endsWith('.md') && !EXCLUDED_FILES.has(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** 读取一个 markdown 文件为未链接的图谱节点。 */
async function readNode(file, wikiRoot) {
  const { meta: raw, body } = splitFrontmatter(await readFile(file, 'utf8'))
  const scalar = (value) => (typeof value === 'string' ? value : undefined)
  const meta = {
    type: scalar(raw.type),
    title: scalar(raw.title),
    description: scalar(raw.description),
    tags: Array.isArray(raw.tags) ? raw.tags : undefined,
  }
  const isIndex = path.basename(file) === 'index.md'
  // index 页是通用的 "# Files" 标题，优先用目录名
  const title = meta.title ?? (isIndex ? sectionTitle(file, wikiRoot) : firstHeading(body)) ?? path.basename(file, '.md')
  return {
    id: toId(wikiRoot, file),
    title,
    type: meta.type ?? (isIndex ? 'Section' : 'Reference'),
    description: meta.description ?? '',
    tags: meta.tags ?? [],
    body,
    size: body.length,
    links: [],
    backlinks: [],
  }
}

/** 把各节点的 markdown 链接解析为有向边，并写回节点的 links/backlinks。 */
function linkNodes(nodes, wikiRoot) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges = []
  const seen = new Set()
  for (const node of nodes) {
    const fileDir = path.dirname(path.join(wikiRoot, `${node.id}.md`))
    for (const link of markdownLinks(node.body)) {
      const target = toId(wikiRoot, path.resolve(fileDir, link))
      const targetNode = byId.get(target)
      const key = `${node.id}\n${target}`
      if (!targetNode || target === node.id || seen.has(key)) continue
      seen.add(key)
      edges.push({ source: node.id, target })
      node.links.push(target)
      targetNode.backlinks.push(node.id)
    }
  }
  return edges
}

/** 从 wiki 目录构建完整节点/边图（与原版 buildGraph 输出一致）。 */
export async function buildGraph(wikiRoot) {
  const files = (await collectMarkdown(wikiRoot, wikiRoot)).sort()
  const nodes = await Promise.all(files.map((file) => readNode(file, wikiRoot)))
  const edges = linkNodes(nodes, wikiRoot)
  return {
    root: path.basename(wikiRoot),
    generatedAt: new Date().toISOString(),
    types: [...new Set(nodes.map((node) => node.type))].sort(),
    nodes,
    edges,
  }
}
