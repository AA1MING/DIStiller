/**
 * Demand-Distiller 一键启动器（scripts/dev.mjs）
 *
 * 背景：Windows 常把 8787 等端口划入系统保留段（Hyper-V / winnat 动态保留端口），
 * 后端直接监听会报 `EACCES: permission denied 0.0.0.0:8787`，导致项目无法启动。
 *
 * 本脚本：
 *   1. 读取 `netsh` 的 TCP 排除端口段，并检测端口是否已被占用；
 *   2. 优先使用默认端口（后端 8787、前端 4173），不可用则自动挑选安全端口；
 *   3. 通过环境变量 PORT / API_PORT / VITE_PORT 注入给 `npm run dev`（concurrently）；
 *   4. 等待后端 /api/health 与前端就绪后自动打开浏览器。
 *
 * 用法：node scripts/dev.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { createWriteStream, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DEFAULT_API_PORT = 8787
const DEFAULT_WEB_PORT = 4173
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ===== 日志输出：统一写入 log/ 目录（保留最近 30 次运行的 out/err 日志） =====
const LOG_DIR = path.join(ROOT, 'log')
mkdirSync(LOG_DIR, { recursive: true })

function logTs() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const RUN_TS = logTs()
const OUT_LOG = path.join(LOG_DIR, `dev-${RUN_TS}.out.log`)
const ERR_LOG = path.join(LOG_DIR, `dev-${RUN_TS}.err.log`)
const outStream = createWriteStream(OUT_LOG, { flags: 'a' })
const errStream = createWriteStream(ERR_LOG, { flags: 'a' })
outStream.on('error', () => {})
errStream.on('error', () => {})

function writeTo(stream, text) {
  try { stream.write(text) } catch { /* 日志写入失败不影响服务 */ }
}

// 控制台输出同时镜像到日志文件
const origLog = console.log
const origError = console.error
console.log = (...args) => { origLog(...args); writeTo(outStream, format(...args) + '\n') }
console.error = (...args) => { origError(...args); writeTo(errStream, format(...args) + '\n') }

async function closeLogs() {
  const done = (st) => new Promise((r) => st.end(() => r()))
  await Promise.allSettled([done(outStream), done(errStream)])
}

/** 清理旧日志：只保留最近 30 次运行的 out/err 日志文件。 */
function pruneLogs() {
  try {
    const files = readdirSync(LOG_DIR).filter((f) => /^dev-.*\.(out|err)\.log$/.test(f)).sort()
    const excess = files.length - 60
    for (let i = 0; i < excess; i++) {
      try { unlinkSync(path.join(LOG_DIR, files[i])) } catch {}
    }
  } catch {}
}
pruneLogs()

/** 读取 Windows 系统保留端口段（netsh 输出，含 Hyper-V / winnat 动态保留段）。 */
function readExcludedRanges() {
  try {
    const out = execFileSync('netsh', ['interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    const ranges = []
    for (const line of out.split(/\r?\n/)) {
      const nums = line.match(/\d+/g)
      if (!nums || nums.length === 0) continue
      const a = Number(nums[0])
      const b = Number(nums.length >= 2 ? nums[1] : nums[0])
      ranges.push([Math.min(a, b), Math.max(a, b)])
    }
    return ranges
  } catch {
    return []
  }
}

function isExcluded(port, ranges) {
  return ranges.some(([a, b]) => port >= a && port <= b)
}

/** 探测端口是否已被占用（连得上 = 占用）。 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port })
    sock.setTimeout(250)
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('timeout', () => { sock.destroy(); resolve(false) })
    sock.once('error', () => resolve(false))
  })
}

async function pickPort(preferred, ranges, used) {
  const tryPort = async (p) => {
    if (used.has(p)) return null
    if (isExcluded(p, ranges)) return null
    if (await isPortInUse(p)) { used.add(p); return null }
    used.add(p)
    return p
  }
  const first = await tryPort(preferred)
  if (first) return first
  // 从保留段之后的安全区间向上扫描（8862-8861 为当前保留段边界外）
  for (let p = 8862; p <= 9999; p++) {
    const r = await tryPort(p)
    if (r) return r
  }
  throw new Error('未找到可用端口：请先关闭占用端口的程序后重试')
}

async function waitForReady(url, timeoutMs, label) {
  const start = Date.now()
  let lastErr = ''
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return true
      lastErr = `HTTP ${res.status}`
    } catch (e) {
      lastErr = e.message
    }
    await sleep(400)
  }
  console.error(`[dev] ${label} 启动超时（${url}）：${lastErr}`)
  return false
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? { file: 'cmd', args: ['/c', 'start', '', url] }
    : process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : { file: 'xdg-open', args: [url] }
  try {
    const child = spawn(cmd.file, cmd.args, { stdio: 'ignore', detached: true, windowsHide: true })
    child.unref()
  } catch { /* 打不开浏览器不影响启动 */ }
}

async function main() {
  console.log('')
  console.log('==================================================')
  console.log('  Demand-Distiller 开发服务器')
  console.log('==================================================')
  console.log('')
  console.log(`[dev] 日志目录: ${LOG_DIR}`)
  console.log(`[dev]   标准输出: ${OUT_LOG}`)
  console.log(`[dev]   错误输出: ${ERR_LOG}`)
  console.log('')

  const ranges = readExcludedRanges()
  const used = new Set()
  const apiPort = await pickPort(DEFAULT_API_PORT, ranges, used)
  const webPort = await pickPort(DEFAULT_WEB_PORT, ranges, used)

  console.log(`[dev] 后端 API 端口: ${apiPort}${apiPort !== DEFAULT_API_PORT ? '（默认 8787 被系统保留，已自动切换）' : ''}`)
  console.log(`[dev] 前端 Vite 端口: ${webPort}`)
  console.log('')

  const env = {
    ...process.env,
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    VITE_PORT: String(webPort),
  }

  const isWin = process.platform === 'win32'
  // Windows 下 npm 是 .cmd 批处理，必须经 cmd.exe 启动（shell:false 直接 spawn 会 EINVAL）
  const child = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'npm run dev'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
    : spawn('npm', ['run', 'dev'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })

  // 子进程（前端 + 后端）输出：回显到控制台，同时写入 log/ 目录
  if (child.stdout) child.stdout.on('data', (d) => { process.stdout.write(d); writeTo(outStream, d) })
  if (child.stderr) child.stderr.on('data', (d) => { process.stderr.write(d); writeTo(errStream, d) })

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    if (!child.killed) child.kill('SIGTERM')
    setTimeout(() => { closeLogs().then(() => process.exit(0)) }, 1500).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGBREAK', shutdown)
  process.on('SIGTERM', shutdown)

  const apiOk = await waitForReady(`http://localhost:${apiPort}/api/health`, 60000, '后端 API')
  const webOk = await waitForReady(`http://localhost:${webPort}/`, 60000, '前端 Vite')

  if (apiOk && webOk) {
    const url = `http://localhost:${webPort}/`
    console.log('')
    console.log(`[dev] 启动完成！`)
    console.log(`[dev]   前端: ${url}`)
    console.log(`[dev]   后端: http://localhost:${apiPort}`)
    console.log(`[dev] 正在打开浏览器...`)
    openBrowser(url)
  } else {
    console.error('[dev] 服务未完全就绪，请查看上方日志。')
  }

  const code = await new Promise((resolve) => {
    child.on('exit', (c, sig) => resolve(c ?? (sig ? 1 : 0)))
  })
  await closeLogs()
  process.exit(code)
}

main().catch(async (e) => {
  console.error('[dev] 启动失败：', e.message)
  await closeLogs()
  process.exit(1)
})