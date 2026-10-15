import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const ZERO_PRICING = Object.freeze({ input: 0, output: 0, cache_read: 0, cache_write: 0 })

function resolveFromEnv(name, fallback) {
  const raw = process.env[name]
  return raw ? path.resolve(raw) : fallback
}

const tokenTrackerDir = resolveFromEnv('TOKENTRACKER_DIR', path.resolve(__dirname, '../../../depend/repos/TokenTracker-main'))

let matcher = null
let curated = { exact: {}, alias: {}, fuzzy: [] }
let litellm = {}
const negativeCache = new Set()

function loadJson(relPath) {
  try {
    const raw = fs.readFileSync(path.join(tokenTrackerDir, relPath), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // Pricing data is optional. When absent, all costs fall back to zero.
  }
  return null
}

function loadPricing() {
  negativeCache.clear()
  litellm = {}
  curated = { exact: {}, alias: {}, fuzzy: [] }
  try {
    const loaded = require(path.join(tokenTrackerDir, 'src/lib/pricing/matcher.js'))
    matcher = loaded && typeof loaded.lookupPricing === 'function' ? loaded : null
  } catch {
    matcher = null
  }
  const curatedRaw = loadJson('src/lib/pricing/curated-overrides.json')
  if (curatedRaw) {
    curated = {
      exact: curatedRaw.exact && typeof curatedRaw.exact === 'object' ? curatedRaw.exact : {},
      alias: curatedRaw.alias && typeof curatedRaw.alias === 'object' ? curatedRaw.alias : {},
      fuzzy: Array.isArray(curatedRaw.fuzzy) ? curatedRaw.fuzzy : [],
    }
  }
  if (matcher) {
    const seedRaw = loadJson('src/lib/pricing/seed-snapshot.json')
    if (seedRaw) {
      try {
        litellm = matcher.buildLitellmPerMillionMap ? matcher.buildLitellmPerMillionMap(seedRaw) : {}
      } catch {
        litellm = {}
      }
    }
  }
}

loadPricing()

/**
 * TokenTracker ??? token ??????? src/lib/context-health.js??
 * CJK??/???/???????? 1 token??????? 4 ?? 1 token?
 */
export function estimateTokens(text) {
  const value = String(text || '')
  let cjk = 0
  for (const char of value) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(char)) cjk += 1
  }
  return Math.ceil(cjk + (value.length - cjk) / 4)
}

export function reloadTokenPricing() {
  loadPricing()
}

export function getTokenPricingSource() {
  return tokenTrackerDir
}

export function getModelPricing(model, opts = {}) {
  if (!model) return ZERO_PRICING
  let lookupSource = null
  if (typeof opts === 'string') {
    lookupSource = opts.toLowerCase()
  } else if (opts && typeof opts.source === 'string') {
    lookupSource = opts.source.toLowerCase()
  }
  if (!matcher) return ZERO_PRICING
  const cacheKey = lookupSource ? `${lookupSource}\0${model}` : String(model)
  if (negativeCache.has(cacheKey)) return ZERO_PRICING
  try {
    const result = matcher.lookupPricing(model, { curated, litellm, source: lookupSource })
    if (result && result.hit && result.value) return result.value
  } catch {
    // Fall through to zero pricing.
  }
  negativeCache.add(cacheKey)
  return ZERO_PRICING
}

const PI_SUBSCRIPTION_SOURCES = new Set(['pi-github-copilot', 'pi-copilot'])

/**
 * TokenTracker ?????????? src/lib/pricing/index.js??
 * ????? snake_case???? camelCase?
 */
export function computeRowCost(row) {
  const source = String(row?.source || row?.modelSource || '').toLowerCase()
  if (PI_SUBSCRIPTION_SOURCES.has(source)) return 0
  const pricing = getModelPricing(row?.model, { source })
  const reasoningIncludedInOutput = source === 'codex' || source === 'every-code'
  const reasoningOutput = Number(row?.reasoning_output_tokens || row?.reasoningOutputTokens || 0)
  const reasoningCost = reasoningIncludedInOutput ? 0 : reasoningOutput * (pricing.output || 0)
  return (
    (Number(row?.input_tokens || row?.inputTokens || 0) * (pricing.input || 0) +
      Number(row?.output_tokens || row?.outputTokens || 0) * (pricing.output || 0) +
      Number(row?.cached_input_tokens || row?.cachedInputTokens || 0) * (pricing.cache_read || 0) +
      Number(row?.cache_creation_input_tokens || row?.cacheCreationInputTokens || 0) * (pricing.cache_write || 0) +
      reasoningCost) / 1_000_000
  )
}
