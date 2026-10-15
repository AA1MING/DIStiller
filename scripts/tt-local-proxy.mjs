#!/usr/bin/env node
/**
 * TokenTracker 本机数据代理（tt-local-proxy）
 * ------------------------------------------------------------------
 * 在用户本机启动一个「只监听 127.0.0.1」的小服务，复用 server/services/tt-functions.js
 * 的 /functions/* 路由，直接读取本机 ~/.claude/projects 与 ~/.codex/sessions 的实时数据。
 *
 * 用途：云端部署的 Web 端在浏览器里优先请求 http://127.0.0.1:18788/functions/*，
 * 成功则展示本机实时 TokenTracker 数据；代理未启动时 Web 端自动回退到云端随包快照。
 *
 * 启动：
 *   node scripts/tt-local-proxy.mjs
 * 或双击 scripts/start-tt-proxy.bat
 * 或（已注册协议时）浏览器访问 tt-proxy://start，由 scripts/tt-proxy-handler.vbs 拉起
 *
 * 环境变量：
 *   TT_PROXY_PORT  监听端口，默认 18788（只绑定 127.0.0.1，不对外暴露）
 *   TT_DATA_HOME   数据目录（默认取系统用户目录下的 ~/.claude、~/.codex）
 */
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleTtFunctions } from '../server/services/tt-functions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.TT_PROXY_PORT || 18788)
const HOST = '127.0.0.1'

// 浏览器从云端 https 页面请求本机 http://127.0.0.1 时：
// - 127.0.0.1 属于"潜在可信来源"，不会被混合内容拦截；
// - 为兼容 Chrome 138+ 的本地网络访问（LNA/私有网络访问）预检，额外返回
//   Access-Control-Allow-Private-Network: true。
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-AI-Config, Authorization, x-tokentracker-local-auth',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '86400',
}

// 幂等启动：Web 端通过 tt-proxy:// 协议可能重复触发本代理。
// 启动前先探测端口，若已有代理在监听则直接退出（exit 0），避免端口冲突与重复实例。
function isAlreadyRunning(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host, timeout: 400 })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS })
  res.end(JSON.stringify(payload))
}

const server = http.createServer(async (req, res) => {
  let url
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`)
  } catch {
    return json(res, 400, { error: 'bad url' })
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    return res.end()
  }

  // 探活接口：Web 端用它判断本机代理是否在线（/api/health 与云端保持一致）
  if (url.pathname === '/' || url.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      service: 'tt-local-proxy',
      data_home: process.env.TT_DATA_HOME ? path.resolve(process.env.TT_DATA_HOME) : null,
      as_of: new Date().toISOString(),
    })
  }

  if (url.pathname.startsWith('/functions/')) {
    try {
      await handleTtFunctions(req, res, url)
    } catch (e) {
      json(res, 500, { error: e.message })
    }
    return
  }

  json(res, 404, { error: `unsupported: ${url.pathname}` })
})

isAlreadyRunning(PORT, HOST)
  .then((running) => {
    if (running) {
      console.log(`[tt-local-proxy] 代理已在 ${HOST}:${PORT} 运行，无需重复启动。`)
      process.exit(0)
      return
    }
    server.listen(PORT, HOST, () => {
      console.log('==========================================================')
      console.log('  TokenTracker 本机数据代理已启动')
      console.log(`  地址: http://${HOST}:${PORT}`)
      console.log(
        '  数据: ' +
          (process.env.TT_DATA_HOME
            ? path.resolve(process.env.TT_DATA_HOME)
            : '系统用户目录 (~/.claude/projects、~/.codex/sessions)'),
      )
      console.log('  云端 Web 端（浏览器）将自动读取本机实时数据')
      console.log('  关闭本窗口即停止代理')
      console.log('==========================================================')
    })
  })
  .catch((e) => {
    console.error(`[tt-local-proxy] 启动探测失败: ${e.message}`)
    process.exit(1)
  })

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // 已在运行：视为幂等成功，正常退出（Web 端重复触发时不会报错）
    console.log(`[tt-local-proxy] 端口 ${PORT} 已被占用，视为代理已在运行，退出。`)
    process.exit(0)
  } else {
    console.error(`[tt-local-proxy] 启动失败: ${err.message}`)
    process.exit(1)
  }
})