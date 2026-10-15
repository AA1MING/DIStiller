import { db, dbContext, dataDir } from '../dao/db.js'
import { getAiSettings, chatText, chatJson, UNIFIED_SYSTEM_PROMPT } from './ai.js'
import { createProject } from './projects.js'
import { zipEntries } from './import.js'
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 实体项目 zip 存储目录：按用户隔离（u<id>/），无用户上下文时回退 shared/。 */
function currentReposDir() {
  const ctx = dbContext.getStore()
  const sub = ctx && ctx.userId ? 'u' + ctx.userId : 'shared'
  const dir = path.resolve(dataDir, 'repos', sub)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 实体项目托管：上传 zip 仅做存储（不分析），
 * 之后由「AI 阅读」先把代码逻辑整理成结构化 Markdown，再交给 icemark 提炼项目信息。
 */

const README_NAMES = ['readme.md', 'readme.txt', 'readme', 'README.md', 'README', '说明.md', '项目说明.md', 'description.md']
const TECH_FILES = ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile', 'pubspec.yaml', 'mix.exs', 'setup.py']
const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.vue', '.svelte', '.rb', '.php', '.swift', '.kt', '.cs']
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'vendor', '__pycache__', 'venv', '.venv', 'target', 'out']

function isText(name) {
  const n = name.toLowerCase()
  return !n.endsWith('.png') && !n.endsWith('.jpg') && !n.endsWith('.jpeg') && !n.endsWith('.gif') &&
    !n.endsWith('.webp') && !n.endsWith('.ico') && !n.endsWith('.woff') && !n.endsWith('.woff2') &&
    !n.endsWith('.ttf') && !n.endsWith('.eot') && !n.endsWith('.pdf') && !n.endsWith('.zip') &&
    !n.endsWith('.gz') && !n.endsWith('.wasm')
}

/** 内容级二进制检测：含 NUL 字节视为二进制（不按扩展名一刀切）。 */
function isBinaryData(data) {
  if (!data || data.length === 0) return true
  const n = Math.min(data.length, 4096)
  for (let i = 0; i < n; i++) if (data[i] === 0) return true
  return false
}

function shouldSkip(pathname) {
  return SKIP_DIRS.some((d) => pathname.split('/').includes(d))
}

/** 从 zip buffer 提取项目文本文件（内容级检测，跳过二进制/不支持压缩的条目）。 */
export function extractZipFiles(buf, limit = 120, maxFileBytes = 512 * 1024) {
  const all = zipEntries(buf)
  const files = []
  for (const e of all) {
    const name = e.name.replace(/\\/g, '/')
    if (!name || name.endsWith('/')) continue
    if (name.startsWith('__MACOSX')) continue
    if (shouldSkip(name)) continue
    if (e.unsupported) continue          // LZMA/bzip2 等不支持的压缩方法
    if (e.encrypted) continue            // 加密 zip 无法读取
    if (!e.data) continue                // 解压失败
    if (!isText(name)) continue
    if (isBinaryData(e.data)) continue   // 内容含 NUL 字节（图片/编译产物等）
    if (e.data.length > maxFileBytes) continue
    files.push({ name, data: e.data })
    if (files.length >= limit) break
  }
  return files
}

/** zip 内容诊断：解释为什么没有可用文本文件。 */
export function diagnoseZip(buf) {
  const all = zipEntries(buf)
  const total = all.length
  const unsupported = all.filter((e) => e.unsupported).length
  const encrypted = all.filter((e) => e.encrypted).length
  const binary = all.filter((e) => !e.unsupported && !e.encrypted && e.data && isBinaryData(e.data)).length
  const emptyOrDir = all.filter((e) => !e.unsupported && !e.encrypted && (!e.data || !e.name || e.name.endsWith('/'))).length
  const skippedDirs = all.filter((e) => !e.unsupported && !e.encrypted && e.data && SKIP_DIRS.some((d) => e.name.split('/').includes(d))).length
  return { total, unsupported, encrypted, binary, emptyOrDir, skippedDirs }
}

/** 保存 zip 到磁盘，返回存储路径。 */
function storeZip(buf, filename) {
  const safe = String(filename || 'repo.zip').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  const p = path.join(currentReposDir(), `${Date.now()}-${safe}`)
  writeFileSync(p, buf)
  return p
}

/** 上传实体项目 zip：仅存储，不做 AI 分析。 */
export async function importRepo({ filename = 'repo.zip', content }) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'base64')
  const all = zipEntries(buf)
  if (!all.length) throw new Error('未识别到 ZIP 格式：请确认上传的是 .zip 压缩包（.rar / .7z 不支持）')
  const files = extractZipFiles(buf)
  if (!files.length) {
    const d = diagnoseZip(buf)
    throw new Error(`压缩包中有 ${d.total} 个条目，但没有可读取的文本文件：${d.unsupported} 个为不支持的压缩方法（请用系统自带「压缩到 zip 文件」重新打包，勿用 7-Zip/WinRAR 高压缩率）${d.encrypted ? `、${d.encrypted} 个为加密文件（请取消加密后重新打包）` : ''}、${d.binary} 个二进制文件、${d.emptyOrDir} 个目录/空文件${d.skippedDirs ? `、${d.skippedDirs} 个位于 node_modules 等忽略目录` : ''}`)
  }
  const repoPath = storeZip(buf, filename)
  const project = createProject({
    title: filename.replace(/\.zip$/i, '').replace(/[_-]+/g, ' ').trim() || '实体项目',
    description: `已托管项目压缩包（${filename}），共解析到 ${files.length} 个文本文件。点击「AI 阅读」后整理代码逻辑并提炼项目信息。`,
    theme: null,
    features: [],
    source: 'repo',
  })
  db.prepare("UPDATE projects SET repo_path = ?, repo_status = 'stored' WHERE id = ?").run(repoPath, project.id)
  return { ...getProjectWithMeta(project.id), stored: true, fileCount: files.length }
}

/** 删除实体项目：清理磁盘 zip 文件。 */
export function deleteRepoProject(projectId) {
  const p = db.prepare('SELECT repo_path FROM projects WHERE id = ?').get(Number(projectId))
  if (p?.repo_path && existsSync(p.repo_path)) { try { unlinkSync(p.repo_path) } catch { /* 忽略 */ } }
}

function pickReadme(files) {
  const lower = (n) => n.toLowerCase()
  const cand = files.filter((f) => README_NAMES.includes(f.name) || README_NAMES.includes(lower(f.name.split('/').pop())))
  return cand[0] || null
}

function pickTechFiles(files) {
  return files.filter((f) => TECH_FILES.includes(f.name.split('/').pop())).slice(0, 3)
}

function pickSourceSamples(files, n = 10) {
  const code = files.filter((f) => CODE_EXT.some((ext) => f.name.toLowerCase().endsWith(ext)))
  return code.slice(0, n)
}

function listTree(files) {
  const dirs = new Set()
  for (const n of files.map((f) => f.name)) {
    const parts = n.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  return [...dirs].slice(0, 40)
}

function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return buf.toString('latin1') }
}

function buildReadingMaterial(files) {
  const parts = []
  const readme = pickReadme(files)
  if (readme) parts.push(`【README】\n${decode(readme.data).slice(0, 6000)}`)
  const tree = listTree(files)
  if (tree.length) parts.push(`【目录结构】\n${tree.join('\n')}`)
  const tech = pickTechFiles(files)
  if (tech.length) parts.push(`【技术/依赖清单】\n${tech.map((t) => `${t.name}:\n${decode(t.data).slice(0, 1500)}`).join('\n\n')}`)
  const samples = pickSourceSamples(files)
  if (samples.length) parts.push(`【关键源码抽样】\n${samples.map((s) => `--- ${s.name} ---\n${decode(s.data).slice(0, 1500)}`).join('\n\n')}`)
  return { material: parts.filter(Boolean).join('\n\n---\n\n'), fileCount: files.length, sampleNames: [...new Set([readme?.name, ...tech.map((t) => t.name), ...samples.map((s) => s.name)].filter(Boolean))] }
}

/** 第一步：AI 整理代码逻辑（[mode:codeanalysis]）。无 AI 时退回文件清单文本。 */
async function organizeCodeLogic(material) {
  const ai = getAiSettings()
  if (!(ai.enabled && ai.apiKey && ai.baseUrl && ai.model)) return null
  const userMsg = `[mode:codeanalysis]\n请系统梳理以下实体项目的代码逻辑，输出结构化 Markdown：\n\n${material.slice(0, 60000)}`
  try {
    return await chatText(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
  } catch { return null }
}

function parseJsonContent(content) {
  let text = String(content || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

/** 第二步：icemark 阅读整理后的代码逻辑，提炼项目信息。 */
async function icemarkReadProject(codeLogic) {
  const ai = getAiSettings()
  const userMsg = `[mode:icemark]\n你是 icemark 产品经理 Agent。以下是 AI 已整理的实体项目代码逻辑，请基于它提炼项目信息并只输出 JSON（不要额外文字）：\n\n${String(codeLogic || '').slice(0, 30000)}\n\n输出 JSON：\n{\n  "title": "项目名称",\n  "summary": "项目简介（2-3句）",\n  "techStack": ["技术栈"],\n  "features": [{"title":"功能点","description":"说明","priority":"P0|P1|P2"}],\n  "architecture": "架构/模块说明"\n}`
  const content = await chatJson(ai, [{ role: 'system', content: UNIFIED_SYSTEM_PROMPT }, { role: 'user', content: userMsg }], { step: 'icemark' })
  return parseJsonContent(content)
}

/** 无 AI 时的本地提炼回退。 */
function localReadProject(files) {
  const names = files.map((f) => f.name)
  const topName = names.find((n) => /^[^/]+\/[^/]+$/.test(n))?.split('/')[0] || names[0]?.split('/')[0] || '导入项目'
  const readme = pickReadme(files)
  const readmeText = readme ? decode(readme.data).slice(0, 300) : ''
  const tech = pickTechFiles(files).map((t) => t.name.split('/').pop()).join('、')
  const title = readmeText.match(/^#\s*(.+)/)?.[1]?.trim() || topName
  return {
    title: title.slice(0, 60),
    summary: readmeText.replace(/^#\s*.+\n?/, '').trim().slice(0, 200) || `导入的实体项目，共 ${files.length} 个文本文件。`,
    techStack: tech ? tech.split('、') : [],
    features: names.slice(0, 8).map((n) => ({ title: n.split('/').pop(), description: n, priority: 'P1' })),
    architecture: `目录包含 ${files.length} 个文件，详见文件清单。配置 AI 后可生成更完整的架构分析。`,
  }
}

/** AI 阅读实体项目：整理代码逻辑 → icemark 提炼 → 落库。 */
export async function readProject(projectId) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(projectId))
  if (!row) throw new Error('项目不存在')
  if (!row.repo_path || !existsSync(row.repo_path)) throw new Error('项目 zip 文件缺失，请重新导入')
  db.prepare("UPDATE projects SET repo_status = 'reading' WHERE id = ?").run(row.id)
  try {
    const buf = readFileSync(row.repo_path)
    const all = zipEntries(buf)
    if (!all.length) throw new Error('存储的 zip 无法识别，请重新导入')
    const files = extractZipFiles(buf)
    if (!files.length) {
      const d = diagnoseZip(buf)
      throw new Error(`zip 中无可读取的文本文件（${d.total} 条目：${d.unsupported} 压缩方法不支持${d.encrypted ? `、${d.encrypted} 加密` : ''}、${d.binary} 二进制、${d.emptyOrDir} 目录/空文件），请重新打包后导入`)
    }
    const { material, fileCount, sampleNames } = buildReadingMaterial(files)

    // 第一步：AI 整理代码逻辑（失败不影响整体，退回 icemark 直接读原始素材）
    const codeLogic = await organizeCodeLogic(material)

    // 第二步：icemark 阅读（AI 整理结果或原始素材）
    const ai = getAiSettings()
    let parsed = null
    if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
      try { parsed = await icemarkReadProject(codeLogic || material) } catch { parsed = null }
    }
    const info = parsed || localReadProject(files)

    // 同步功能点（先清掉本项目旧的，再按新信息写入）
    const oldFeatIds = db.prepare('SELECT feature_id FROM project_features WHERE project_id = ?').all(row.id).map((r) => r.feature_id)
    db.prepare('DELETE FROM project_features WHERE project_id = ?').run(row.id)
    for (const fid of oldFeatIds) db.prepare('DELETE FROM features WHERE id = ?').run(fid)
    const featStmt = db.prepare('INSERT INTO features (opportunity_id, title, description, priority, status, source_type, source_name) VALUES (NULL,?,?,?,?,?,?)')
    const joinStmt = db.prepare('INSERT OR IGNORE INTO project_features (project_id, feature_id) VALUES (?,?)')
    for (const f of (info.features || [])) {
      if (!f?.title) continue
      const fInfo = featStmt.run(String(f.title).slice(0, 200), String(f.description || '').slice(0, 1000), f.priority || 'P1', 'kept', 'repo', row.title)
      joinStmt.run(row.id, Number(fInfo.lastInsertRowid))
    }

    const desc = `${info.summary || ''}\n\n【架构】${info.architecture || ''}\n【读取文件】${sampleNames.join('、')}`
    db.prepare("UPDATE projects SET title = ?, theme = ?, description = ?, code_logic = ?, repo_status = 'read' WHERE id = ?")
      .run(String(info.title || row.title).slice(0, 100), (info.techStack || []).join('、') || row.theme, desc, codeLogic || null, row.id)
    return { ...getProjectWithMeta(row.id), fileCount, readFiles: sampleNames, codeLogicLength: (codeLogic || '').length }
  } catch (e) {
    db.prepare("UPDATE projects SET repo_status = 'failed' WHERE id = ?").run(row.id)
    throw e
  }
}

function getProjectWithMeta(id) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  return {
    ...p, auto: !!p.auto,
    features: db.prepare(`SELECT f.*, o.title AS opportunity_title FROM project_features pf
              JOIN features f ON f.id = pf.feature_id
              LEFT JOIN opportunities o ON o.id = f.opportunity_id
              WHERE pf.project_id = ? ORDER BY f.priority, f.id`).all(id),
  }
}

/**
 * 生成成果文档时调用：实时解压实体项目 zip 读取代码逻辑。
 * 优先使用已缓存的 code_logic；未阅读时现场提取文件并（可选）用 AI 整理后缓存。
 * 返回 { text, source }：source 为 cached / ai / zip / none。
 */
export async function extractCodeLogic(project) {
  if (!project) return { text: '', source: 'none' }
  if (project.code_logic) return { text: String(project.code_logic).slice(0, 30000), source: 'cached' }
  if (!project.repo_path || !existsSync(project.repo_path)) return { text: '', source: 'none' }
  const buf = readFileSync(project.repo_path)
  const files = extractZipFiles(buf)
  if (!files.length) return { text: '', source: 'none' }
  const { material } = buildReadingMaterial(files)
  let text = material
  let source = 'zip'
  const ai = getAiSettings()
  if (ai.enabled && ai.apiKey && ai.baseUrl && ai.model) {
    const organized = await organizeCodeLogic(material)
    if (organized) { text = organized; source = 'ai' }
    db.prepare('UPDATE projects SET code_logic = ?, repo_status = ? WHERE id = ?')
      .run(organized || null, organized ? 'read' : project.repo_status || 'stored', project.id)
  }
  return { text: String(text).slice(0, 30000), source }
}
