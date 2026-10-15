import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { handlers, PUBLIC_KEYS } from './controllers/routes.js'
import { send, readAiOverride } from './middleware/http.js'
import { dbContext, getUserDb } from './dao/db.js'
import { getUserByToken } from './services/auth.js'
import { aiRequestContext } from './services/ai.js'
import { handleTtFunctions } from './services/tt-functions.js'
import { proxyIntegration } from './services/integrations.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const distDir = path.resolve(__dirname, '../data/dist')

// 静态资源 Content-Type 映射：缺少映射时浏览器（尤其 Chrome）会把
// application/octet-stream 的 SVG/PNG 当作无法渲染的文件，导致页面图标全部裂图。
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (urlPath === '/') urlPath = '/index.html'
  let filePath = path.join(distDir, urlPath)
  if (!filePath.startsWith(distDir)) return false
  if (!existsSync(filePath)) { filePath = path.join(distDir, 'index.html') }
  if (!existsSync(filePath)) return false
  const mime = STATIC_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime })
  res.end(readFileSync(filePath))
  return true
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const pathname = url.pathname
  const method = req.method || 'GET'
  if (method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-AI-Config, Authorization' }); return res.end() }
  // 原版仪表盘数据接口（无登录要求，与本地 CLI 行为一致）
  if (pathname.startsWith('/functions/')) { await handleTtFunctions(req, res, url).catch((e) => send(res, 500, { error: e.message })); return }
  if (pathname === '/integrations/openwiki' || pathname.startsWith('/integrations/openwiki/')) { proxyIntegration(req, res, 'openwiki'); return }
  if (pathname === '/integrations/tokentracker' || pathname.startsWith('/integrations/tokentracker/')) { proxyIntegration(req, res, 'tokentracker'); return }
  // 请求级 AI 配置：handler 在 AsyncLocalStorage 上下文中运行，getAiSettings() 自动合并
  const aiOverride = readAiOverride(req)
  const segments = pathname.split('/').filter(Boolean)
  const key = `${method} /${segments.join('/')}`

  // 业务分发：与用户库上下文无关的纯路由逻辑
  const dispatch = async () => {
    if (handlers[key]) { try { await handlers[key](req, res) } catch (e) { send(res, e?.status || 500, { error: e.message }) }; return }
    if (pathname.startsWith('/api/')) {
      for (const [k, fn] of Object.entries(handlers)) {
        const [m, p] = k.split(' '); if (m !== method) continue
        const parts = p.split('/').filter(Boolean); if (parts.length !== segments.length) continue
        const params = {}; let match = true
        for (let i = 0; i < parts.length; i++) { if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segments[i]); else if (parts[i] !== segments[i]) { match = false; break } }
        if (match) { try { await fn(req, res, params) } catch (e) { send(res, e?.status || 500, { error: e.message }) }; return }
      }
      return send(res, 404, { error: '接口不存在' })
    }
    if (existsSync(distDir) && serveStatic(req, res)) return
    send(res, 404, { error: 'Not Found' })
  }

  if (pathname.startsWith('/api/')) {
    // 公开接口直接进入
    if (PUBLIC_KEYS.has(key)) return await aiRequestContext.run(aiOverride, dispatch)
    // 其余接口一律要求登录：token → 用户 → 该用户的独立数据库
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
    const user = getUserByToken(token)
    if (!user) return send(res, 401, { error: '未登录或登录已过期，请重新登录' })
    req.user = user
    const userDb = getUserDb(user.id)
    return await aiRequestContext.run(aiOverride, () => dbContext.run({ db: userDb, userId: user.id }, dispatch))
  }
  await dispatch()
})

server.listen(PORT, () => console.log(`[demand-distiller] API server listening on http://localhost:${PORT}`))
