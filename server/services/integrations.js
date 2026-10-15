import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { getProject, keptFeatureDigest, listProjects } from './projects.js'
import { buildGraph } from './wiki-graph.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const demandDistillerDir = path.resolve(__dirname, '../..')
const dependDir = path.resolve(demandDistillerDir, '../depend')
const reposDir = path.join(dependDir, 'repos')

function resolveFromEnv(name, fallback) {
  const raw = process.env[name]
  return raw ? path.resolve(raw) : fallback
}

const OPENWIKI_DIR = resolveFromEnv('OPENWIKI_DIR', path.join(reposDir, 'openwiki-main'))
const TOKENTRACKER_DIR = resolveFromEnv('TOKENTRACKER_DIR', path.join(reposDir, 'TokenTracker-main'))
const OPENWIKI_PORT = Number(process.env.OPENWIKI_PORT || 4321)
const TOKENTRACKER_PORT = Number(process.env.TOKENTRACKER_PORT || 7681)
const OPENWIKI_PROJECTS_DIR = path.join(demandDistillerDir, 'data', 'openwiki-projects')
const MAX_LOG_LINES = 600

const state = {
  openwiki: { visualize: null, task: null, setup: null, logs: [], wikiRoot: null, lastProject: null },
  tokentracker: { server: null, sync: null, setup: null, petBuild: null, pet: null, logs: [] },
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8)
}

function appendLog(service, stream, chunk) {
  const text = String(chunk || '')
  const lines = text.split(/\r?\n/)
  const slot = state[service]
  if (!slot) return
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (!line) continue
    slot.logs.push(`[${timestamp()}] [${stream}] ${line}`)
    if (slot.logs.length > MAX_LOG_LINES) slot.logs.splice(0, slot.logs.length - MAX_LOG_LINES)
  }
}

function shellCmd(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

function describeProcess(entry) {
  if (!entry) return { status: 'stopped', pid: null, exitCode: null, signal: null, error: null, startedAt: null }
  return {
    status: entry.status || 'stopped',
    pid: entry.pid || null,
    exitCode: entry.exitCode ?? null,
    signal: entry.signal || null,
    error: entry.error || null,
    startedAt: entry.startedAt || null,
  }
}

function running(entry) {
  return Boolean(entry && entry.status === 'running')
}

function setExit(entry, code, signal) {
  if (!entry) return
  entry.status = 'stopped'
  entry.exitCode = code
  entry.signal = signal || null
}

function spawnChild(service, entry, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    windowsHide: options.windowsHide !== false,
    detached: Boolean(options.detached),
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  entry.process = child
  entry.pid = child.pid
  entry.status = 'running'
  entry.startedAt = new Date().toISOString()
  entry.exitCode = null
  entry.signal = null
  entry.error = null
  appendLog(service, 'stdout', `$ ${command} ${args.join(' ')}\n`)
  child.stdout?.on('data', (d) => appendLog(service, 'stdout', d))
  child.stderr?.on('data', (d) => appendLog(service, 'stderr', d))
  child.on('error', (err) => {
    entry.status = 'error'
    entry.error = err.message
    appendLog(service, 'stderr', err.message)
  })
  child.on('exit', (code, signal) => {
    setExit(entry, code, signal)
    appendLog(service, signal ? 'stderr' : 'stdout', `[process exited] code=${code} signal=${signal || ''}`)
  })
  return child
}

function stopChild(entry) {
  const child = entry?.process
  if (!child || !running(entry)) return { ok: false, error: '服务未运行' }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function startPersistent(service, key, command, args, options = {}) {
  const slot = state[service]
  if (running(slot[key])) return { ok: false, error: '服务已在运行' }
  slot[key] = {}
  spawnChild(service, slot[key], command, args, options)
  return { ok: true, pid: slot[key].pid }
}

function runSteps(service, key, steps) {
  const slot = state[service]
  if (running(slot[key])) return { ok: false, error: '任务正在执行' }
  slot[key] = {}
  const entry = slot[key]
  entry.status = 'running'
  entry.startedAt = new Date().toISOString()

  function next(index) {
    if (index >= steps.length) {
      entry.status = 'done'
      entry.exitCode = 0
      appendLog(service, 'stdout', '[task completed]\n')
      return
    }
    const step = steps[index]
    appendLog(service, 'stdout', `\n[step ${index + 1}/${steps.length}] ${step.command} ${step.args.join(' ')}\n`)
    const child = spawnChild(service, entry, step.command, step.args, { cwd: step.cwd, windowsHide: true })
    child.on('exit', (code, signal) => {
      setExit(entry, code, signal)
      if (code === 0) {
        next(index + 1)
      } else {
        entry.status = 'error'
        appendLog(service, 'stderr', `[task failed] step=${index + 1} code=${code} signal=${signal || ''}\n`)
      }
    })
  }
  next(0)
  return { ok: true, pid: entry.pid || null }
}

function findCommand(name) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  const res = spawnSync(lookup, [name], { encoding: 'utf8', windowsHide: true })
  if (res.status !== 0) return null
  const lines = String(res.stdout || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (!lines.length) return null
  if (process.platform === 'win32') {
    return lines.find((x) => x.toLowerCase().endsWith('.cmd'))
      || lines.find((x) => x.toLowerCase().endsWith('.bat'))
      || lines.find((x) => x.toLowerCase().endsWith('.exe'))
      || lines[0]
  }
  return lines[0]
}

function detectDotnetSdk() {
  const res = spawnSync('dotnet', ['--list-sdks'], { encoding: 'utf8', windowsHide: true })
  return res.status === 0 && String(res.stdout || '').trim().length > 0
}

function findTokenTrackerExe() {
  if (process.platform !== 'win32') return null
  const root = path.join(TOKENTRACKER_DIR, 'TokenTrackerWin', 'bin')
  if (!existsSync(root)) return null
  const queue = [root]
  let visited = 0
  while (queue.length && visited < 4000) {
    const dir = queue.shift()
    visited += 1
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === 'TokenTracker.exe' && entry.isFile()) return path.join(dir, entry.name)
      if (entry.isDirectory()) queue.push(path.join(dir, entry.name))
    }
  }
  return null
}

function slugifyFeature(value, index) {
  const base = String(value || `feature-${index + 1}`).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return base || `feature-${index + 1}`
}

function buildStatus() {
  const ow = state.openwiki
  const tt = state.tokentracker
  const owVisual = describeProcess(ow.visualize)
  const ttServer = describeProcess(tt.server)
  const petExe = findTokenTrackerExe()
  return {
    openwiki: {
      dir: OPENWIKI_DIR,
      exists: existsSync(OPENWIKI_DIR),
      node: process.execPath,
      pnpm: Boolean(findCommand('pnpm') || findCommand('corepack')),
      nodeModules: existsSync(path.join(OPENWIKI_DIR, 'node_modules')),
      distCli: existsSync(path.join(OPENWIKI_DIR, 'dist', 'cli', 'cli.js')),
      visualize: { ...owVisual, port: OPENWIKI_PORT, url: `http://127.0.0.1:${OPENWIKI_PORT}` },
      task: describeProcess(ow.task),
      setup: describeProcess(ow.setup),
      wikiRoot: ow.wikiRoot || null,
      lastProject: ow.lastProject || null,
      logsTail: ow.logs.slice(-160),
    },
    tokentracker: {
      dir: TOKENTRACKER_DIR,
      exists: existsSync(TOKENTRACKER_DIR),
      node: process.execPath,
      npm: shellCmd('npm'),
      cliEntry: existsSync(path.join(TOKENTRACKER_DIR, 'bin', 'tracker.js')),
      rootNodeModules: existsSync(path.join(TOKENTRACKER_DIR, 'node_modules')),
      dashboardNodeModules: existsSync(path.join(TOKENTRACKER_DIR, 'dashboard', 'node_modules')),
      dashboardDist: existsSync(path.join(TOKENTRACKER_DIR, 'dashboard', 'dist', 'index.html')),
      dotnetSdk: detectDotnetSdk(),
      petExe,
      server: { ...ttServer, port: TOKENTRACKER_PORT, url: `http://127.0.0.1:${TOKENTRACKER_PORT}` },
      sync: describeProcess(tt.sync),
      setup: describeProcess(tt.setup),
      petBuild: describeProcess(tt.petBuild),
      pet: describeProcess(tt.pet),
      logsTail: tt.logs.slice(-160),
    },
  }
}

export function getStatus() {
  return buildStatus()
}

export function getLogs(service, tail = 200) {
  const slot = state[service]
  if (!slot) return []
  const n = Math.max(1, Number(tail) || 200)
  return slot.logs.slice(-n)
}

export function setupOpenWiki() {
  if (!existsSync(OPENWIKI_DIR)) return { ok: false, error: `OpenWiki 目录不存在: ${OPENWIKI_DIR}` }
  const pnpm = findCommand('pnpm')
  const corepack = findCommand('corepack')
  const command = pnpm || corepack
  if (!command) return { ok: false, error: '未找到 pnpm / corepack，请先安装 pnpm' }
  const installArgs = pnpm ? ['install'] : ['pnpm', 'install']
  const buildArgs = pnpm ? ['build'] : ['pnpm', 'build']
  return runSteps('openwiki', 'setup', [
    { command, args: installArgs, cwd: OPENWIKI_DIR },
    { command, args: buildArgs, cwd: OPENWIKI_DIR },
  ])
}

function openWikiProjectDir(projectId) {
  const id = String(projectId).replace(/[^a-zA-Z0-9_-]/g, '_')
  const dir = path.resolve(OPENWIKI_PROJECTS_DIR, id)
  if (!dir.startsWith(OPENWIKI_PROJECTS_DIR + path.sep)) throw new Error('非法项目目录')
  return dir
}
/** 安全删除某项目的 OpenWiki 磁盘目录（与项目库删除保持同步）。 */
export async function deleteOpenWikiProject(projectId) {
  try {
    await rm(openWikiProjectDir(projectId), { recursive: true, force: true })
  } catch {}
}

export function startOpenWikiVisualizer() {
  if (!existsSync(OPENWIKI_DIR)) return { ok: false, error: `OpenWiki 目录不存在: ${OPENWIKI_DIR}` }
  const cli = path.join(OPENWIKI_DIR, 'dist', 'cli', 'cli.js')
  if (!existsSync(cli)) return { ok: false, error: 'OpenWiki 尚未构建，请先执行 setup' }
  if (running(state.openwiki.visualize)) stopChild(state.openwiki.visualize)
  const wikiRoot = state.openwiki.wikiRoot || path.join(OPENWIKI_DIR, 'openwiki')
  return startPersistent('openwiki', 'visualize', process.execPath, [cli, 'visualize', wikiRoot, '--port', String(OPENWIKI_PORT), '--no-open'], { cwd: OPENWIKI_DIR, windowsHide: true })
}

/** 把可视化服务切换到指定项目的 Wiki 根目录并（重新）启动。 */
export function startOpenWikiProjectVisualizer(projectId) {
  const repoDir = openWikiProjectDir(projectId)
  const wikiDir = path.join(repoDir, 'openwiki')
  if (!existsSync(wikiDir)) return { ok: false, error: '该项目尚未生成 Wiki，请先导入 OpenWiki 生成' }
  state.openwiki.wikiRoot = wikiDir
  return startOpenWikiVisualizer()
}

export function stopOpenWikiVisualizer() {
  return stopChild(state.openwiki.visualize)
}

export function runOpenWikiTask(payload = {}) {
  const cli = path.join(OPENWIKI_DIR, 'dist', 'cli', 'cli.js')
  if (!existsSync(cli)) return { ok: false, error: 'OpenWiki 尚未构建，请先执行 setup' }
  const command = payload.command === 'update' ? 'update' : 'init'
  const cwdRaw = String(payload.cwd || '').trim()
  const cwd = cwdRaw ? path.resolve(cwdRaw) : demandDistillerDir
  const args = [cli, `--${command}`, '--print']
  if (payload.mode === 'code' || payload.mode === 'personal') args.push('--mode', payload.mode)
  if (payload.language) args.push('--language', String(payload.language))
  if (payload.modelId) args.push('--modelId', String(payload.modelId))
  const message = String(payload.message || '').trim()
  if (message) args.push(message)
  return runSteps('openwiki', 'task', [{ command: process.execPath, args, cwd }])
}

async function prepareOpenWikiProject(repoDir, project) {
  await rm(repoDir, { recursive: true, force: true })
  await mkdir(repoDir, { recursive: true })
  const features = Array.isArray(project.features) ? project.features.filter((f) => f && f.status !== 'dropped') : []
  const packageJson = { name: `distiller-project-${project.id}`, private: true, version: '1.0.0', description: project.title || 'Distiller project' }
  await writeFile(path.join(repoDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n', 'utf8')
  let readme = `# ${project.title || 'Distiller 项目'}

`
  if (project.description) readme += `${project.description}

`
  if (project.theme) readme += `> 主题：${project.theme}

`
  readme += `## 功能点

`
  if (features.length) {
    for (const f of features) readme += `- [${f.priority || 'P1'}] ${f.title}${f.description ? ` - ${f.description}` : ''}
`
  } else {
    const digest = keptFeatureDigest(project.id)
    readme += digest ? `${digest}\n` : `?????\n`
  }
  await writeFile(path.join(repoDir, 'README.md'), readme, 'utf8')
  await mkdir(path.join(repoDir, 'openwiki'), { recursive: true })
  let instructions = `# OpenWiki 生成说明

请将本项目生成为结构化知识库。

`
  instructions += `项目中心：${project.title || '未命名项目'}
`
  instructions += `项目简介：${project.description || '暂无'}
`
  instructions += `主题：${project.theme || '暂无'}

`
  instructions += `功能点：

`
  for (let i = 0; i < features.length; i++) {
    const f = features[i]
    const slug = slugifyFeature(f.title, i)
    instructions += `- feature-${slug}: ${f.title}
`
    const title = String(f.title || '').replace(/"/g, "'")
    const desc = String(f.description || '').replace(/"/g, "'")
    const fm = `---
title: "${title}"
description: "${desc}"
type: Feature
---

# ${f.title}

${f.description || ''}
`
    await writeFile(path.join(repoDir, `feature-${slug}.md`), fm, 'utf8')
  }
  instructions += `
要求：
1. 根目录 openwiki/index.md 作为项目中心，概述项目并链接每个功能点。
2. 每个功能点生成独立页面，frontmatter 包含 title、description、type: Feature。
3. 形成项目中心 -> 功能点 的节点层级。
4. 使用中文输出。
`
  await writeFile(path.join(repoDir, 'openwiki', 'INSTRUCTIONS.md'), instructions, 'utf8')
}

export async function runOpenWikiProjectTask(payload = {}) {
  const cli = path.join(OPENWIKI_DIR, 'dist', 'cli', 'cli.js')
  if (!existsSync(cli)) return { ok: false, error: 'OpenWiki 尚未构建，请先执行 setup' }
  if (running(state.openwiki.task)) return { ok: false, error: '任务正在执行' }
  const projectId = Number(payload.projectId)
  if (!Number.isFinite(projectId)) return { ok: false, error: '请选择项目' }
  const project = getProject(projectId)
  if (!project) return { ok: false, error: '项目不存在' }
  let repoDir
  try {
    repoDir = openWikiProjectDir(projectId)
    await prepareOpenWikiProject(repoDir, project)
  } catch (e) {
    return { ok: false, error: `准备项目仓库失败: ${e.message}` }
  }
  const message = String(payload.message || '').trim()
  const args = [cli, '--init', '--print', '--mode', 'code', '--language', 'zh-CN']
  if (message) args.push(message)
  state.openwiki.wikiRoot = path.join(repoDir, 'openwiki')
  state.openwiki.lastProject = { id: project.id, title: project.title, featureCount: (project.features || []).length, generatedAt: new Date().toISOString() }
  return runSteps('openwiki', 'task', [{ command: process.execPath, args, cwd: repoDir }])
}

export function setupTokenTracker() {
  if (!existsSync(TOKENTRACKER_DIR)) return { ok: false, error: `TokenTracker 目录不存在: ${TOKENTRACKER_DIR}` }
  const npm = shellCmd('npm')
  return runSteps('tokentracker', 'setup', [
    { command: npm, args: ['install'], cwd: TOKENTRACKER_DIR },
    { command: npm, args: ['--prefix', 'dashboard', 'install'], cwd: TOKENTRACKER_DIR },
    { command: npm, args: ['run', 'dashboard:build'], cwd: TOKENTRACKER_DIR },
  ])
}

export function startTokenTracker() {
  if (!existsSync(TOKENTRACKER_DIR)) return { ok: false, error: `TokenTracker 目录不存在: ${TOKENTRACKER_DIR}` }
  const entry = path.join(TOKENTRACKER_DIR, 'bin', 'tracker.js')
  const distIndex = path.join(TOKENTRACKER_DIR, 'dashboard', 'dist', 'index.html')
  if (!existsSync(entry) || !existsSync(distIndex)) return { ok: false, error: 'TokenTracker 尚未安装或构建，请先执行 setup' }
  return startPersistent('tokentracker', 'server', process.execPath, [entry, 'serve', '--port', String(TOKENTRACKER_PORT), '--no-open', '--no-sync'], { cwd: TOKENTRACKER_DIR, windowsHide: true })
}

export function stopTokenTracker() {
  return stopChild(state.tokentracker.server)
}

export function runTokenTrackerSync() {
  const entry = path.join(TOKENTRACKER_DIR, 'bin', 'tracker.js')
  if (!existsSync(entry)) return { ok: false, error: 'TokenTracker CLI 不存在，请先执行 setup' }
  return runSteps('tokentracker', 'sync', [{ command: process.execPath, args: [entry, 'sync'], cwd: TOKENTRACKER_DIR }])
}

export function buildTokenTrackerPet() {
  if (process.platform !== 'win32') return { ok: false, error: '桌宠仅支持 Windows' }
  if (!detectDotnetSdk()) return { ok: false, error: '未检测到 .NET SDK，请先安装 .NET 8 SDK' }
  const csproj = path.join(TOKENTRACKER_DIR, 'TokenTrackerWin', 'TokenTrackerWin.csproj')
  if (!existsSync(csproj)) return { ok: false, error: `桌宠工程文件不存在: ${csproj}` }
  return runSteps('tokentracker', 'petBuild', [{ command: 'dotnet', args: ['build', csproj, '-c', 'Debug'], cwd: TOKENTRACKER_DIR }])
}

export function startTokenTrackerPet() {
  if (process.platform !== 'win32') return { ok: false, error: '桌宠仅支持 Windows' }
  const exe = findTokenTrackerExe()
  if (!exe) return { ok: false, error: '未找到 TokenTracker.exe，请先构建桌宠' }
  if (running(state.tokentracker.pet)) return { ok: false, error: '桌宠已在运行' }
  const slot = state.tokentracker
  slot.pet = {}
  spawnChild('tokentracker', slot.pet, exe, [], { cwd: path.dirname(exe), windowsHide: false, detached: true })
  return { ok: true, pid: slot.pet.pid }
}

export function stopTokenTrackerPet() {
  return stopChild(state.tokentracker.pet)
}

export function proxyIntegration(req, res, service) {
  const port = service === 'openwiki' ? OPENWIKI_PORT : TOKENTRACKER_PORT
  const key = service === 'openwiki' ? 'visualize' : 'server'
  const entry = state[service]?.[key]
  if (!running(entry)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
    res.end(`${service} integration service is not running`)
    return
  }
  const prefix = `/integrations/${service}`
  const url = new URL(req.url, 'http://localhost')
  let targetPath = url.pathname
  if (targetPath === prefix || targetPath === prefix + '/') targetPath = '/'
  else if (targetPath.startsWith(prefix + '/')) targetPath = targetPath.slice(prefix.length)
  if (url.search) targetPath += url.search
  const headers = { ...req.headers }
  delete headers.host
  delete headers.connection
  delete headers['content-length']
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port,
      path: targetPath,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const outHeaders = { ...proxyRes.headers }
      delete outHeaders['transfer-encoding']
      delete outHeaders.connection
      res.writeHead(proxyRes.statusCode || 502, outHeaders)
      proxyRes.pipe(res)
    }
  )
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
    }
    res.end(`${service} integration proxy error`)
  })
  req.pipe(proxyReq)
}

// ===== 生成后的 Wiki 结构读取：项目中心节点 + 功能点分支节点 =====

/** 解析 markdown frontmatter（OKF v0.1 简化兼容），仅取 title / description / type。 */
function parseFrontmatter(text) {
  const s = String(text || '')
  if (!s.startsWith('---')) return {}
  const end = s.indexOf('\n---', 3)
  if (end < 0) return {}
  const fm = {}
  for (const raw of s.slice(3, end).split(/\r?\n/)) {
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (!m) continue
    fm[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
  }
  return fm
}

function headingOf(text) {
  const m = String(text || '').match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * 读取某项目经 OpenWiki 生成的知识库结构，返回 wiki 图数据：
 * { generated, generatedAt, center, features, links }；未生成时 { generated: false }。
 * 项目即中心节点，功能点即分支节点。
 */
export async function readOpenWikiGraph(projectId) {
  const repoDir = openWikiProjectDir(projectId)
  const wikiDir = path.join(repoDir, 'openwiki')
  if (!existsSync(wikiDir)) return { generated: false }
  const project = getProject(projectId)
  const features = []
  let center = null
  async function walk(dir, depth) {
    if (depth > 5) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '_plan.md' || entry.name === 'log.md') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      let text = ''
      try {
        text = await readFile(full, 'utf8')
      } catch {
        continue
      }
      const fm = parseFrontmatter(text)
      const rel = path.relative(wikiDir, full).replace(/\\/g, '/')
      const isIndex = depth === 0 && entry.name === 'index.md'
      const node = {
        id: rel.replace(/\.md$/, ''),
        file: rel,
        title: fm.title || (isIndex ? (project?.title || '项目中心') : headingOf(text) || path.basename(entry.name, '.md')),
        description: fm.description || '',
        type: fm.type || (isIndex ? 'Project' : 'Feature'),
        index: isIndex,
      }
      if (isIndex) center = node
      else features.push(node)
    }
  }
  await walk(wikiDir, 0)
  if (!center) {
    center = { id: 'index', file: 'index.md', title: project?.title || '项目中心', description: project?.description || '', type: 'Project', index: true }
  }
  let generatedAt = null
  try {
    const st = await stat(path.join(wikiDir, 'index.md'))
    generatedAt = st.mtime.toISOString()
  } catch {}
  const links = features.map((f) => ({ from: center.id, to: f.id }))
  return { generated: true, generatedAt, center, features, links }
}

/** 用原版 buildGraph 构建某项目的完整知识图谱（可视化器数据源）。 */
export async function buildOpenWikiProjectGraph(projectId) {
  const repoDir = openWikiProjectDir(projectId)
  const wikiDir = path.join(repoDir, 'openwiki')
  if (!existsSync(wikiDir)) return { ok: false, error: '该项目尚未生成 Wiki，请先在 Wiki 知识图页点击「生成 Wiki 知识库」' }
  try {
    return { ok: true, graph: await buildGraph(wikiDir) }
  } catch (e) {
    return { ok: false, error: `图谱构建失败: ${e.message}` }
  }
}

// 星系图：每个项目一个星团（项目为中心节点，功能点为分支），项目间以独立颜色区分。
// 配色与原版可视化器 PALETTE 一致，保证深色背景下明亮清晰。
const GALAXY_PALETTE = ['#4FA8F0', '#B6DE3E', '#D96FA6', '#A97FE0', '#D98A6B', '#3FBFA0', '#E0A63E', '#6E8FF0']

function hexA(hex, alpha) {
  const c = (hex || '').replace('#', '')
  if (c.length !== 6) return hex
  const channel = (i) => parseInt(c.slice(i, i + 2), 16)
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`
}

/**
 * 自动读取所有已生成 Wiki 的项目，合并为一个星系图。
 * 返回 { ok, graph, projects }；graph 与单项目 buildGraph 同构（节点含 color 字段），
 * projects 为每个项目的 { id, title, generated, pages } 统计。
 */
export async function buildWikiGalaxy() {
  const projects = listProjects()
  const nodes = []
  const edges = []
  const projectMeta = []
  const types = new Set()
  let paletteIndex = 0

  for (const project of projects) {
    const repoDir = openWikiProjectDir(project.id)
    const wikiDir = path.join(repoDir, 'openwiki')
    if (!existsSync(wikiDir)) {
      projectMeta.push({ id: project.id, title: project.title, generated: false, pages: 0 })
      continue
    }
    let g
    try {
      g = await buildGraph(wikiDir)
    } catch {
      projectMeta.push({ id: project.id, title: project.title, generated: false, pages: 0 })
      continue
    }
    if (!Array.isArray(g.nodes) || g.nodes.length === 0) {
      projectMeta.push({ id: project.id, title: project.title, generated: true, pages: 0 })
      continue
    }

    // 每个项目分配一个星系色；中心节点（index/overview/home 或首节点）用实色，功能节点用半透明同色
    const pColor = GALAXY_PALETTE[paletteIndex % GALAXY_PALETTE.length]
    paletteIndex += 1
    const centerIdx = g.nodes.findIndex((n) => n.id === 'index' || /(^|\/)(index|overview|home)$/i.test(n.id))
    const center = centerIdx >= 0 ? g.nodes[centerIdx] : g.nodes[0]
    const prefix = `p${project.id}:`

    for (const n of g.nodes) {
      const isCenter = n === center
      nodes.push({
        id: prefix + n.id,
        title: isCenter ? project.title || n.title : n.title,
        type: isCenter ? 'Project' : n.type,
        description: isCenter ? project.description || n.description : n.description,
        tags: isCenter ? ['项目', ...(n.tags || [])] : n.tags,
        body: n.body,
        size: n.size,
        links: (n.links || []).map((l) => prefix + l),
        backlinks: (n.backlinks || []).map((b) => prefix + b),
        color: isCenter ? pColor : hexA(pColor, 0.72),
        project: project.title,
      })
      types.add(isCenter ? 'Project' : n.type)
    }
    for (const e of g.edges || []) {
      edges.push({ source: prefix + e.source, target: prefix + e.target })
    }
    projectMeta.push({ id: project.id, title: project.title, generated: true, pages: g.nodes.length })
  }

  return {
    ok: true,
    graph: {
      root: 'Wiki 星系',
      generatedAt: new Date().toISOString(),
      types: [...types].sort(),
      nodes,
      edges,
    },
    projects: projectMeta,
  }
}
