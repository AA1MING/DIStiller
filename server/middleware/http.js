/** 通用 HTTP 工具：统一响应、请求体解析、请求级 AI 配置头解析。 */

export function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-AI-Config, Authorization' })
  res.end(JSON.stringify(data))
}

/** 解析客户端自带 AI 配置请求头（每人独立配置 API），返回字段白名单对象或 null。 */
export function readAiOverride(req) {
  try {
    const raw = req.headers['x-ai-config']
    if (!raw) return null
    const obj = JSON.parse(decodeURIComponent(raw))
    if (!obj || typeof obj !== 'object') return null
    const o = {}
    if (typeof obj.provider === 'string') o.provider = obj.provider
    if (typeof obj.baseUrl === 'string') o.baseUrl = obj.baseUrl
    if (typeof obj.model === 'string') o.model = obj.model
    if (typeof obj.embeddingModel === 'string') o.embeddingModel = obj.embeddingModel
    if (typeof obj.apiKey === 'string') o.apiKey = obj.apiKey
    if (obj.apiKeys && typeof obj.apiKeys === 'object') {
      const keys = {}
      for (const p of ['openai', 'deepseek', 'openrouter', 'custom_openai']) {
        if (typeof obj.apiKeys[p] === 'string') keys[p] = obj.apiKeys[p]
      }
      if (Object.keys(keys).length) o.apiKeys = keys
    }
    if (typeof obj.enabled === 'boolean') o.enabled = obj.enabled
    return o
  } catch { return null }
}

/** 请求体解析：JSON；大文件以 base64 传入（zip/docx/pdf），放宽到 500MB。 */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    let tooLarge = false
    // 超限不切断连接，改为返回明确错误
    req.on('data', (c) => {
      if (tooLarge) return
      data += c
      if (data.length > 500_000_000) { tooLarge = true; data = '' }
    })
    req.on('end', () => {
      if (tooLarge) { const e = new Error('请求体过大（超过 500MB），请压缩文件后重试'); e.status = 413; return reject(e) }
      if (!data) return resolve({})
      try { resolve(JSON.parse(data)) } catch { reject(new Error('JSON 解析失败')) }
    })
    req.on('error', reject)
  })
}
