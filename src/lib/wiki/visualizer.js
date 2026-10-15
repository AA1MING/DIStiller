/**
 * OpenWiki 可视化器客户端：移植自 openwiki-main/src/visualize/client.ts + client-lib.ts。
 * 原版交互与渲染逻辑保持不变（力导向图、悬浮高亮、点击阅读、类型图例、索引、markdown 渲染），
 * 仅做四处修整以融入本项目：
 *   1. DOM 查询收窄到宿主容器（root），不再用全局 document.querySelector；
 *   2. 图谱数据改从本项目 API 拉取（/api/projects/:id/wiki-graph）；
 *   3. 实时刷新由 SSE 改为轮询（拓扑变化才重渲染，效果与原版一致）；
 *   4. 星图固定为黑夜主题（data-theme 恒为 dark）：无论宿主应用深浅色，星系图始终夜星空。
 * 依赖库（force-graph / marked / DOMPurify / mermaid）仍按原版从 jsdelivr CDN 加载（index.html 已注入）。
 */

// ===== client-lib 部分（原版逻辑，未改动） =====
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char)
}


// 节点调色板（沿用 client-lib.ts 原版 LangChain PALETTE，彩色发光星星与原版一致）
const PALETTE = ['#4FA8F0', '#B6DE3E', '#D96FA6', '#A97FE0', '#D98A6B', '#3FBFA0', '#E0A63E', '#6E8FF0']

function colorsForTypes(types, palette = PALETTE) {
  const colors = {}
  types.forEach((type, i) => { colors[type] = palette[i % palette.length] })
  return colors
}

function hexA(hex, alpha) {
  const c = (hex || '').replace('#', '')
  if (c.length !== 6) return hex
  const channel = (i) => parseInt(c.slice(i, i + 2), 16)
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`
}

// 星系轨道环半径比例（drawRings 与 buildOrbit 共用，保证运行轨迹与绘制的环完全一致）
const RING_RATIOS = [0.4255, 0.5745, 0.7234, 0.8723, 1.0]
// 各轨道环倾角（度）：全部为 0，轨道为相互平行的同心圆
const RING_TILTS = [0, 0, 0, 0, 0]
// 每条功能点子环最多容纳的功能点数（环内角度均匀分配，环半径按数量放大）
const PER_FEAT_RING = 10


// ===== 实例缓存：进入/离开 wiki 页时保留已建好的星系图（画布/轨道/背景不重建），
// 仅挂起（暂停渲染与轮询），再次进入直接恢复 —— 避免反复加载与初始化卡顿 =====
const vizCache = new Map() // key -> { root, ctrl, destroyed }
const vizCacheKey = (galaxy, projectId) => (galaxy ? "galaxy" : `project:${projectId}`)


// Selected-state brightening: keep the node hue, mix toward white by amt,
// so the selected star does not become pure white.
function brighten(hex, amt = 0.45) {
  const c = (hex || '').replace('#', '')
  if (c.length !== 6) return hex
  const ch = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16)
    return Math.round(v + (255 - v) * amt)
  }
  return `rgb(${ch(0)}, ${ch(2)}, ${ch(4)})`
}

function nodeRadius(size, isParent, isAnchor) {
  return (isParent ? 9 : 3.5) + Math.min(7, (size || 0) / 480) + (isAnchor ? 4 : 0)
}

  // 功能点子环索引：同一父星的功能点按顺序分到多条子环，每条子环至多 PER_FEAT_RING 个，
  // 避免大量功能点挤在同一条环上造成重叠。
  function featureSubRing(k) {
    return Math.min(3, Math.floor(k / PER_FEAT_RING))
  }
  // 功能点子环半径：父星半径 + 环内最大星径 + 间距 + 环序增量 —— 布局时提前修整轨道，
  // 让同环星在轨道上彼此错开；运行时不再做碰撞推开，即使重合也直接穿过。
  function featureSubR(parentR, ringMaxChildR, ring, ringCount) {
    return Math.max(20, parentR + ringMaxChildR + 10 + ring * 14)
  }

function matchesFilter(node, query, type) {
  const haystack = `${node.title} ${node.id} ${(node.tags ?? []).join(' ')}`
  const matchesQuery = !query || haystack.toLowerCase().includes(query)
  const matchesType = !type || node.type === type
  return matchesQuery && matchesType
}

function signature(graph) {
  const nodes = graph.nodes.map((node) => node.id).sort().join('|')
  const edges = graph.edges.map((edge) => `${edge.source}>${edge.target}`).sort().join('|')
  return `${nodes}::${edges}`
}

function stripFrontmatter(body) {
  if (!body.startsWith('---')) return body
  const end = body.indexOf('\n---', 3)
  return end === -1 ? body : body.slice(body.indexOf('\n', end + 1) + 1)
}

function normalize(baseDir, rel) {
  const parts = (baseDir ? baseDir.split('/') : []).concat(rel.split('/'))
  const out = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

// cubic-bezier(0.16, 1, 0.3, 1) 采样（与主题扩散动画同款 easing，牛顿迭代求 x）
function cubicBezier(t, x1, y1, x2, y2) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (u) => ((ax * u + bx) * u + cx) * u
  const sampleY = (u) => ((ay * u + by) * u + cy) * u
  let u = t
  for (let i = 0; i < 8; i++) {
    const err = sampleX(u) - t
    if (Math.abs(err) < 1e-5) break
    const d = (3 * ax * u + 2 * bx) * u + cx
    if (Math.abs(d) < 1e-6) break
    u -= err / d
  }
  return sampleY(Math.min(1, Math.max(0, u)))
}

// ===== client 部分（原版逻辑，作用域与数据源已适配） =====

/**
 * 初始化可视化器并挂载到 root（root 内含原版 DOM 骨架：
 * #graph / #toast）。
 * 返回 { cleanup, locateNode }：locateNode(query) 搜索定位节点（居中缩放 + 高亮）。
 * 数据源：projectId 模式加载单个项目图谱；galaxy 模式自动加载所有项目星系图。
 */
export function initWikiVisualizer(root, { projectId, galaxy = false, initialData = null, onReady } = {}) {
  const key = vizCacheKey(Boolean(galaxy), projectId)
  // 命中缓存（同一 DOM 根节点）→ 直接恢复已有实例，不重新加载、不重新模拟
  const cached = vizCache.get(key)
  if (cached && !cached.destroyed && cached.root === root) {
    const c = cached.ctrl
    if (typeof c._setOnReady === "function") c._setOnReady(onReady || null)
    c.resume()
    if (c.isReady() && onReady) queueMicrotask(() => onReady())
    return c
  }
  const isGalaxy = Boolean(galaxy)
  const $ = (sel) => root.querySelector(sel)
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim()
  const labelColor = () => cssVar('--node-label')
  // 星图固定黑夜主题：无论宿主深浅色，星系图始终为夜星空（白昼星图已移除）
  const isLightTheme = () => false
  const edgeColor = () => cssVar('--edge')
  const graphBg = () => cssVar('--graph-bg')

  let graph = { root: '', generatedAt: '', types: [], nodes: [], edges: [] }
  let colorForType = {}
  let G = null
  let current = null
  let anchorId = null
  let lastSig = ''
  let orbit = null
  let bgStars = null
  let resizeObserver = null
  let fitTimer = null
  let fitCommitTimer = null
  let fitSeq = 0
  let lastW = 0
  let lastH = 0
  let fitSizeRef = null
  let freezeAt = null
  let themeWave = null
  let frameWave = null
  let disposed = false
  let suspended = false
  let ready = false
  let onReadyCb = onReady || null
  const filterQ = ''
  const filterType = ''
  const nodeById = new Map()
  const highlightNodes = new Set()
  const highlightLinks = new Set()
  let searchLockId = null
  let searchLockAt = 0
  let lastPointer = 0
  let searchDebounce = null
  // 子星系聚焦：点击父星/子星后放大到该父星+其子星，聚焦期间隐藏外圆环、相机跟随父星
  let focusParentId = null
  let focusAt = 0
  // 用户拖拽/滚轮时间戳：搜索锁定跟随期间暂停跟随；cleanup 也需移除监听
  const markPointer = () => { lastPointer = performance.now() }

  const byId = (id) => graph.nodes.find((n) => n.id === id)
  const isAnchor = (n) => n.id === anchorId
  // 父星（Project 索引节点）更大、子星更小，点击区随半径缩放
  const isParentNode = (n) => (n.type || '').toLowerCase() === 'project' || /:(index|overview|home)$/i.test(n.id || '')
  const passesFilter = (n) => matchesFilter(n, filterQ, filterType)


  // --- 图例与索引 ---
  function assignColors() { colorForType = colorsForTypes(graph.types) }

  // 连边样式：恢复原版 openwiki 视觉——普通关联线亮蓝 70% 透明度、宽 0.7，
  // 高亮时实色加粗；所有关联线都带流动粒子（原版 2 颗/线，高亮 4 颗）
  function linkStyleColor(l) {
    if (highlightLinks.has(l)) return '#7FC8FF'
    return hexA('#7FC8FF', 0.7)
  }
  function linkStyleWidth(l) {
    return highlightLinks.has(l) ? 2 : 0.7
  }
  function initGraph() {
    if (disposed) return
    const container = $('#graph')
    if (!container) return
    G = ForceGraph()(container)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeRelSize(4)
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject(paintNode)
      .nodePointerAreaPaint((n, color, ctx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(n.x ?? 0, n.y ?? 0, n.r + 3, 0, 2 * Math.PI)
        ctx.fill()
      })
      .linkColor((l) => linkStyleColor(l))
      // 星系模式不绘制父星↔子星关联线（星轨为轨道视觉，不参与连线）
      .linkVisibility(() => !isGalaxy)
      .linkWidth((l) => linkStyleWidth(l))
      .linkCurvature(0.12)
      .linkDirectionalParticles((l) => (isGalaxy ? 0 : (highlightLinks.has(l) ? 4 : 2)))
      .linkDirectionalParticleWidth((l) => (isGalaxy ? 0 : (highlightLinks.has(l) ? 2.6 : 1.7)))
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleColor(() => '#7FC8FF')
      .onNodeClick((n) => selectNode(n.id))
      .onNodeHover(hoverHighlight)
      .onBackgroundClick((e) => {
        // 星系模式：点击中心恒星 → 打开 Wiki 功能介绍；其余空白处关闭阅读面板
        if (isGalaxy && orbit && e) {
          const pt = pointerWorld(e)
          if (pt && Math.hypot(pt.x - orbit.center.x, pt.y - orbit.center.y) <= Math.max(26 / Math.max(G.zoom(), 0.1), 16)) {
            openWikiIntro()
            return
          }
        }
        clearSelection()
      })

    const applyOrbitScale = (outerRx, ratio) => {
      orbit.outerRx = outerRx
      for (const p of orbit.projects) {
        p.rx = p.ry = outerRx * RING_RATIOS[p.ringIdx]
      }
      if (bgStars && Number.isFinite(ratio)) {
        const c = orbit.center
        for (const st of bgStars.stars) {
          st.x = c.x + (st.x - c.x) * ratio
          st.y = c.y + (st.y - c.y) * ratio
        }
        for (const g of bgStars.glows) {
          g.x = c.x + (g.x - c.x) * ratio
          g.y = c.y + (g.y - c.y) * ratio
          g.r *= ratio
        }
      }
    }
    const fitNow = () => {
      if (!G || suspended) return
      const w = container.clientWidth
      const h = container.clientHeight
      if (!(w > 0 && h > 0)) return
      const sizeChanged = Math.abs(w - lastW) > 1 || Math.abs(h - lastH) > 1
      if (!sizeChanged && lastW > 0) return
      // 过渡期间画布已用 CSS transform 整体跟随容器（fitSize，星系保持居中并同步缩放），
      // 提交时把像素尺寸落到最终值，并按同一比例放大世界缩放 —— 画面连续、无跳变
      const sx = lastW > 0 ? w / lastW : 1
      container.style.transform = 'none'
      G.width(w).height(h)
      if (lastW > 0 && Number.isFinite(sx) && sx > 0 && Math.abs(sx - 1) > 0.003) {
        G.zoom(Math.max(0.05, G.zoom() * sx))
      }
      lastW = w
      lastH = h
    }
    // 侧边栏收起/展开或窗口尺寸连续变化时，ResizeObserver 会逐帧触发。
    // 过渡期间用 CSS transform 把 #graph（画布+轨道+标签）整体缩放跟随容器：
    // 星星/轨道/背景统一缩放且始终居中，与侧边栏 340ms 过渡同步平滑；
    // 画布像素不重建，防抖后再做一次最终像素重算 + 等比 zoom 补偿，保持清晰。
    const fitSize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (G && w > 0 && h > 0 && lastW > 0) {
        const sx = w / lastW
        const sy = h / lastH
        if (Number.isFinite(sx) && Number.isFinite(sy) && (Math.abs(sx - 1) > 0.003 || Math.abs(sy - 1) > 0.003)) {
          container.style.transformOrigin = 'left top'
          container.style.transform = `scale(${sx}, ${sy})`
        }
      }
      if (fitTimer) clearTimeout(fitTimer)
      fitTimer = setTimeout(() => {
        fitTimer = null
        fitNow()
      }, 180)
    }
    fitSizeRef = fitSize
    fitNow()
    resizeObserver = new ResizeObserver(fitSize)
    resizeObserver.observe(container)
    // 搜索锁定跟随期间，用户拖拽/滚轮时暂停跟随（markPointer 定义在外层，cleanup 共用）
    container.addEventListener('pointerdown', markPointer)
    container.addEventListener('wheel', markPointer)
    container.addEventListener('pointermove', (e) => { if (e.buttons) lastPointer = performance.now() })
    G.d3Force('charge').strength(-140)
    // 星系模式：持续渲染（轨道动画），力导向仅在初始布局阶段生效
    if (isGalaxy) {
      G.autoPauseRedraw(false)
      G.d3AlphaMin(0.001)
      G.onRenderFramePre(galaxyFrame)
    }
  }


  // ===== 星系模式：画布内轨道环（与节点同图层）+ 双轨旋转 =====

  // ===== 星系模式：画布内轨道环（与节点同图层）+ 双轨旋转 =====
  // 项目星沿所属星系环绕中心缓慢旋转；功能点星绕其项目星旋转。
  // 拖拽/选中中的节点暂停轨道，松手/取消选中后从当前位置平滑续转。

  function resetOrbit() {
    orbit = null
    freezeAt = null
    for (const o of nodeById.values()) {
      o.__holdPrev = false
      o.__holdReturn = null
    }
  }

  // 初始散落：把星星按随机角度/距离钉在画布各处（世界坐标），保持「分散星空」
  // 的观感；freezeAt 到达后 buildOrbit 记录这些散落位置，再启动缓缓聚集成星系。
  // 星系外环半径：随星星数量增长（更多星星 → 更大星系范围），并按当前缩放归一。
  function galaxyOuterRx(w, h, z, nodeCount) {
    const gs = 1 + Math.min(0.85, 0.09 * Math.sqrt(Math.max(1, nodeCount)))
    return Math.min(960, Math.max(260, (Math.min(w, h * 1.45) * 0.34 * gs) / z))
  }

  function scatterStars() {
    if (!G) return
    const w = $('#graph').clientWidth || 1600
    const h = $('#graph').clientHeight || 1000
    const z = Math.max(G.zoom(), 0.1)
    const R = (Math.max(w, h) * 0.62) / z
    const rand = mulberry32((Math.random() * 0xffffffff) >>> 0)
    for (const n of G.graphData().nodes) {
      // 注意：graphData() 后 force 尚未初始化坐标（首个 tick 才赋值），
      // 这里直接赋值即可被 d3-force 采纳，并靠 fx/fy 钉住保持分散。
      const r = R * (0.45 + 0.55 * rand())
      const a = rand() * Math.PI * 2
      n.x = r * Math.cos(a)
      n.y = r * Math.sin(a)
      n.vx = 0
      n.vy = 0
      n.fx = n.x
      n.fy = n.y
    }
  }

  // 初始原位（星系模式）：项目星直接落在所属轨道环上、功能点绕父星成圆，
  // 分配方式与 buildOrbit 完全一致（同 id 哈希 → 同环/同父星），buildOrbit
  // 记录的 baseAngle 即当前位置，星系与星环从第一帧就成型并开始旋转。
  function placeStarsOnOrbits() {
    if (!G) return
    const nodes = G.graphData().nodes
    const projects = nodes.filter((n) => n.type === 'Project')
    if (!projects.length) return
    const w = $('#graph').clientWidth || 1600
    const h = $('#graph').clientHeight || 1000
    const z = Math.max(G.zoom(), 0.1)
    const outerRx = galaxyOuterRx(w, h, z, nodes.length)
    // 星系中心固定为画布原点（force-graph 默认把世界原点放在视口正中）
    const cx = 0
    const cy = 0
    // 项目星按 id 哈希分环，环内按哈希排序后均匀分配角度，同心圆观感更整齐
    const ringOrder = projects.map((n) => {
      const h = String(n.id).split('').reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7)
      return { n, ringIdx: h % RING_RATIOS.length, h }
    })
    const byRing = new Map()
    for (const it of ringOrder) {
      if (!byRing.has(it.ringIdx)) byRing.set(it.ringIdx, [])
      byRing.get(it.ringIdx).push(it)
    }
    for (const [ringIdx, list] of byRing) {
      const rx = outerRx * RING_RATIOS[ringIdx]
      list.sort((a, b) => a.h - b.h)
      list.forEach((it, j) => {
        const angle = (2 * Math.PI * j) / list.length + ((it.h % 1000) / 1000) * 0.1
        it.n.x = cx + rx * Math.cos(angle)
        it.n.y = cy + rx * Math.sin(angle)
        it.n.vx = 0
        it.n.vy = 0
        it.n.fx = it.n.x
        it.n.fy = it.n.y
      })
    }
    // 功能点绕所属项目星成圆：按子环分布（每环至多 PER_FEAT_RING 个），环内角度均匀分配
    // （半格偏移，避免多条环的星排成同一射线）；环半径按该环实际数量与星径放大 ——
    // 提前修整轨道避开，运行时即使重合也直接穿过、不做碰撞推开。
    // 父星分配与 buildOrbit 完全一致（同 id 前缀、同图节点顺序）。
    const projByPrefix = new Map()
    for (const n of projects) {
      const m = String(n.id).match(/^p\d+:/)
      if (m) projByPrefix.set(m[0], n)
    }
    const fallback = projects[0]
    const featByParent = new Map()
    for (const n of nodes) {
      if (n.type === 'Project') continue
      const m = String(n.id).match(/^p\d+:/)
      const parent = (m && projByPrefix.get(m[0])) || fallback
      if (!featByParent.has(parent)) featByParent.set(parent, [])
      featByParent.get(parent).push(n)
    }
    for (const [parent, list] of featByParent) {
      const ringCounts = [0, 0, 0, 0]
      const ringMaxR = [0, 0, 0, 0]
      list.forEach((n, k) => {
        const ring = featureSubRing(k)
        ringCounts[ring]++
        const cr = n.r || 4
        if (cr > ringMaxR[ring]) ringMaxR[ring] = cr
      })
      const ringUsed = [0, 0, 0, 0]
      list.forEach((n, k) => {
        const ring = featureSubRing(k)
        const frx = featureSubR(parent.r || 8, ringMaxR[ring], ring, ringCounts[ring])
        const angle = ((ringUsed[ring] + 0.5) / ringCounts[ring] + (ring * 0.5) / PER_FEAT_RING) * 2 * Math.PI
        ringUsed[ring]++
        n.x = parent.x + frx * Math.cos(angle)
        n.y = parent.y + frx * Math.sin(angle)
        n.vx = 0
        n.vy = 0
        n.fx = n.x
        n.fy = n.y
      })
    }
  }

  function buildOrbit(nodes) {
    const projects = nodes.filter((n) => n.type === 'Project' && Number.isFinite(n.x) && Number.isFinite(n.y))
    if (!projects.length) return null
    // 星系中心固定为画布原点：placeStarsOnOrbits 已把星星按同心圆放在原位，
    // 不再取位置平均值，保证 baseAngle 与初始位置严格一致。
    const cx = 0
    const cy = 0
    // 最终星系尺寸按视口生成，正好铺满画布
    const w = $('#graph').clientWidth || 1600
    const h = $('#graph').clientHeight || 1000
    const z = Math.max(G.zoom(), 0.1)
    const outerRx = galaxyOuterRx(w, h, z, nodes.length)
    // 项目星按 id 哈希稳定分配到各轨道环（与 API 返回顺序无关，重渲染不换环）；
    // 同环星各自速度不同 → 星与星逐渐错开，轨迹覆盖更均匀
    const projOrbit = projects.map((n) => {
      const dx = n.x - cx
      const dy = n.y - cy
      const h = String(n.id).split('').reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7)
      const ringIdx = h % RING_RATIOS.length
      const rx = outerRx * RING_RATIOS[ringIdx]
      const ry = rx
      return {
        node: n,
        ringIdx,
        rx,
        ry,
        tilt: (RING_TILTS[ringIdx] * Math.PI) / 180,
        baseAngle: Math.atan2(dy / ry, dx / rx),
        speed: ((2 * Math.PI) / 36000) * (0.72 + ((h >> 3) % 9) * 0.06),
      }
    })
    const projByPrefix = new Map()
    for (const p of projOrbit) {
      const m = String(p.node.id).match(/^p\d+:/)
      if (m) projByPrefix.set(m[0], p)
    }
    const fallback = projOrbit[0]
    const features = []
    let fi = 0
    const featByParent = new Map()
    for (const n of nodes) {
      if (n.type === 'Project') continue
      const m = String(n.id).match(/^p\d+:/)
      const parent = (m && projByPrefix.get(m[0])) || fallback
      const pn = parent.node
      n.__parentId = pn.id
      if (!featByParent.has(parent)) featByParent.set(parent, [])
      featByParent.get(parent).push(n)
    }
    for (const [parent, list] of featByParent) {
      const pn = parent.node
      const ringCounts = [0, 0, 0, 0]
      const ringMaxR = [0, 0, 0, 0]
      list.forEach((n, k) => {
        const ring = featureSubRing(k)
        ringCounts[ring]++
        const cr = n.r || 4
        if (cr > ringMaxR[ring]) ringMaxR[ring] = cr
      })
      const ringUsed = [0, 0, 0, 0]
      list.forEach((n, k) => {
        const ring = featureSubRing(k)
        const frx = featureSubR(pn.r || 8, ringMaxR[ring], ring, ringCounts[ring])
        const fry = frx
        const dx = n.x - pn.x
        const dy = n.y - pn.y
        const evenAngle = ((ringUsed[ring] + 0.5) / ringCounts[ring] + (ring * 0.5) / PER_FEAT_RING) * 2 * Math.PI
        ringUsed[ring]++
        features.push({
          node: n,
          parent,
          rx: frx,
          ry: fry,
          tilt: parent.tilt,
          baseAngle: Math.hypot(dx, dy) > 0.01 ? Math.atan2(dy / fry, dx / frx) : evenAngle,
          speed: ((2 * Math.PI) / 48000) * (0.9 + (fi % 7) * 0.05),
        })
        fi++
      })
    }
    // 每个项目的标签外延距离：挂在功能点星云外侧（远离星系中心），避免与自家功能点重合
    const featMaxByParent = new Map()
    for (const f of features) {
      const pid = f.parent.node.id
      featMaxByParent.set(pid, Math.max(featMaxByParent.get(pid) || 0, f.rx))
    }
    for (const p of projOrbit) {
      p.__labelD = (featMaxByParent.get(p.node.id) || 0) + (p.node.r || 8) + 8 + 6
    }
    // 背景星空随星系中心生成（世界坐标，随地图平移/缩放）
    bgStars = buildStars({ x: cx, y: cy }, outerRx)
    // 记录初始坐标（与轨道原位一致，ease 恒为 1，无聚拢动画）
    const gatherFrom = new Map()
    for (const p of projOrbit) gatherFrom.set(p.node.id, { x: p.node.x, y: p.node.y })
    for (const f of features) gatherFrom.set(f.node.id, { x: f.node.x, y: f.node.y })
    return {
      center: { x: cx, y: cy },
      outerRx,
      startTime: 0,
      gatherDuration: 1,
      backdropAlways: true,
      gatherFrom,
      projects: projOrbit,
      features,
    }
  }

  // 聚合进度：恒为 1（星星已在轨道原位，无需聚拢动画）
  function gatherEase(o, now) {
    const gp = Math.min(1, Math.max(0, (now - o.startTime) / o.gatherDuration))
    return 1 - Math.pow(1 - gp, 3)
  }

  // 星系背景（星云/闪烁星/核心光晕）的显示强度：
  // 页面打开时背景立即完整呈现，与星星聚拢进度无关。
  function backdropAlpha(o, now) {
    if (!o) return 0
    if (o.backdropAlways) return 1
    return gatherEase(o, now)
  }

  function advanceOrbit(o, now) {
    const dt = now - o.startTime
    const ease = gatherEase(o, now)
    const dtFrame = o._lastNow == null ? 16 : Math.min(50, Math.max(0, now - o._lastNow))
    o._lastNow = now
    // 选中/拖拽中的功能点会连带冻结其所属项目星，避免从轨道上漂离
    const heldParents = new Set()
    for (const f of o.features) {
      if (Boolean(f.node.__dragged) || f.node.id === current) heldParents.add(f.parent.node.id)
    }
    for (const p of o.projects) {
      const n = p.node
      const ang = Math.atan2(n.y - o.center.y, n.x - o.center.x)
      n.__labelDX = Math.cos(ang) * (p.__labelD || 0)
      n.__labelDY = Math.sin(ang) * (p.__labelD || 0)
      const isHeld = Boolean(n.__dragged) || n.id === current || heldParents.has(n.id)
      if (isHeld) {
        n.__holdPrev = true
        n.fx = n.x
        n.fy = n.y
        n.vx = 0
        n.vy = 0
        continue
      }
      const a = p.baseAngle + p.speed * dt
      // 平行圆轨道：直接取圆上坐标（tilt=0），绕星系中心旋转
      const lx = p.rx * Math.cos(a)
      const ly = p.ry * Math.sin(a)
      const cosT = Math.cos(p.tilt)
      const sinT = Math.sin(p.tilt)
      const tx = o.center.x + lx * cosT - ly * sinT
      const ty = o.center.y + lx * sinT + ly * cosT
      const from = o.gatherFrom.get(n.id)
      const bx = from ? from.x + (tx - from.x) * ease : tx
      const by = from ? from.y + (ty - from.y) * ease : ty
      if (n.__holdPrev) {
        n.__holdPrev = false
        // 松手/取消选中：记录拖拽位置相对轨道位置的偏移，之后缓慢滑回轨道
        n.__holdReturn = { x: n.x - bx, y: n.y - by }
      }
      let ox = 0
      let oy = 0
      if (n.__holdReturn) {
        const decay = Math.exp(-dtFrame / 750)
        n.__holdReturn.x *= decay
        n.__holdReturn.y *= decay
        ox = n.__holdReturn.x
        oy = n.__holdReturn.y
        if (Math.hypot(ox, oy) < 0.05) n.__holdReturn = null
      }
      n.x = bx + ox
      n.y = by + oy
      n.vx = 0
      n.vy = 0
      n.fx = n.x
      n.fy = n.y
    }
    for (const f of o.features) {
      const n = f.node
      const isHeld = Boolean(n.__dragged) || n.id === current
      if (isHeld) {
        n.__holdPrev = true
        n.fx = n.x
        n.fy = n.y
        n.vx = 0
        n.vy = 0
        continue
      }
      const pn = f.parent.node
      const b = f.baseAngle + f.speed * dt
      const lx = f.rx * Math.cos(b)
      const ly = f.ry * Math.sin(b)
      const cosT = Math.cos(f.tilt)
      const sinT = Math.sin(f.tilt)
      const tx = pn.x + lx * cosT - ly * sinT
      const ty = pn.y + lx * sinT + ly * cosT
      const from = o.gatherFrom.get(n.id)
      const bx = from ? from.x + (tx - from.x) * ease : tx
      const by = from ? from.y + (ty - from.y) * ease : ty
      if (n.__holdPrev) {
        n.__holdPrev = false
        // 功能点松手后同样缓慢滑回父星周围的轨道
        n.__holdReturn = { x: n.x - bx, y: n.y - by }
      }
      let ox = 0
      let oy = 0
      if (n.__holdReturn) {
        const decay = Math.exp(-dtFrame / 750)
        n.__holdReturn.x *= decay
        n.__holdReturn.y *= decay
        ox = n.__holdReturn.x
        oy = n.__holdReturn.y
        if (Math.hypot(ox, oy) < 0.05) n.__holdReturn = null
      }
      n.x = bx + ox
      n.y = by + oy
      n.vx = 0
      n.vy = 0
      n.fx = n.x
      n.fy = n.y
    }
  }

  // 背景星空：世界坐标生成（随地图平移/缩放），闪烁小星 + 柔光星云亮斑
  function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
      a |= 0
      a = (a + 0x6D2B79F5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const STAR_COLORS = [
    { c: [255, 255, 255], w: 5 },
    { c: [182, 214, 255], w: 3 },
    { c: [217, 119, 87], w: 1.4 },
    { c: [199, 142, 173], w: 1.2 },
  ]

  function buildStars(center, outerRx) {
    const rand = mulberry32(0x51AB5EED)
    const R = Math.max(180, outerRx * 2.6)
    const stars = []
    const count = 80
    for (let i = 0; i < count; i++) {
      const r = R * Math.sqrt(rand())
      const a = rand() * Math.PI * 2
      const pick = STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)]
      stars.push({
        x: center.x + r * Math.cos(a),
        y: center.y + r * Math.sin(a),
        r: 0.55 + rand() * 1.7,
        color: pick.c,
        alpha: 0.3 + rand() * 0.6,
        speed: 0.35 + rand() * 1.1,
        phase: rand() * Math.PI * 2,
      })
    }
    const glows = []
    for (let i = 0; i < 6; i++) {
      const r = outerRx * (0.35 + rand() * 1.7)
      const a = rand() * Math.PI * 2
      const pick = STAR_COLORS[Math.floor(rand() * 4)]
      glows.push({
        x: center.x + r * Math.cos(a),
        y: center.y + r * Math.sin(a),
        r: outerRx * (0.10 + rand() * 0.24),
        color: pick.c,
        alpha: 0.12 + rand() * 0.16,
      })
    }
    return { stars, glows }
  }

  // 当前帧的扩散波状态（屏幕半径沿扩散动画同款 easing 推进；结束即清空）
  // 半径做低通平滑：抹平 easeOut 起步的骤变，行星/星星随波起伏更丝滑
  function waveState(now) {
    if (!themeWave) return null
    const p = Math.min(1, Math.max(0, (now - themeWave.t0) / themeWave.duration))
    // 主波扫完后进入退潮尾段：半径保持外沿、波幅缓慢归零，星系平滑回正
    if (p >= 1) {
      if (!themeWave.tailStart) themeWave.tailStart = now
      const tailP = Math.min(1, Math.max(0, (now - themeWave.tailStart) / themeWave.tailDur))
      if (tailP >= 1) {
        themeWave = null
        return null
      }
      const dt = themeWave._last === undefined ? 16 : Math.max(0, now - themeWave._last)
      themeWave._last = now
      const blend = 1 - Math.exp(-dt / 45)
      if (themeWave.smoothR === undefined) themeWave.smoothR = 0
      themeWave.smoothR += (themeWave.maxR - themeWave.smoothR) * blend
      const amp = 1 - (1 - Math.pow(1 - tailP, 3))
      if (themeWave.smoothAmp === undefined) themeWave.smoothAmp = 1
      const ampBlend = 1 - Math.exp(-dt / 70)
      themeWave.smoothAmp += (amp - themeWave.smoothAmp) * ampBlend
      return { x: themeWave.x, y: themeWave.y, radius: themeWave.smoothR, amp: themeWave.smoothAmp, phase: 'tail' }
    }
    const target = themeWave.maxR * cubicBezier(p, 0.16, 1, 0.3, 1)
    const dt = themeWave._last === undefined ? 16 : Math.max(0, now - themeWave._last)
    themeWave._last = now
    if (themeWave.smoothR === undefined) themeWave.smoothR = 0
    const blend = 1 - Math.exp(-dt / 45)
    themeWave.smoothR += (target - themeWave.smoothR) * blend
    return { x: themeWave.x, y: themeWave.y, radius: themeWave.smoothR, amp: 1, phase: 'expand' }
  }

  function drawStars(ctx, k, now) {
    if (!bgStars) return
    const kSafe = k > 0 ? k : 1
    const light = isLightTheme()
    const cm = light ? 0.34 : 1
    // 星系背景始终完整显示（页面打开即有星云），与星星聚拢进度无关；
    // 聚焦子星系时略微压暗背景，突出父星与其子星
    let gather = backdropAlpha(orbit, now)
    if (focusParentId) gather *= 0.55
    // 主题扩散波浪：主波峰 + 长余波，像大水波一样滚过星系
    const wave = frameWave
    // 柔光星云亮斑（径向渐变，世界坐标 → 随地图缩放）
    for (const g of bgStars.glows) {
      const gr = Math.max(g.r, 1)
      let alpha = g.alpha
      let px = g.x
      let py = g.y
      if (wave) {
        const dxw = g.x - wave.x
        const dyw = g.y - wave.y
        const dist = Math.hypot(dxw, dyw) || 1
        const diff = dist * kSafe - wave.radius
        const ripple = (0.65 * Math.sin(diff * 0.012) + 0.35 * Math.sin(diff * 0.006 + 0.7)) * Math.exp(-Math.abs(diff) / 260)
        px += (dxw / dist) * (34 / kSafe) * ripple * wave.amp
        py += (dyw / dist) * (34 / kSafe) * ripple * wave.amp
        alpha = Math.min(1, alpha + 0.28 * Math.exp(-Math.abs(diff) / 180) * wave.amp)
      }
      alpha = Math.min(1, alpha * gather)
      const grad = ctx.createRadialGradient(px, py, 0, px, py, gr)
      grad.addColorStop(0, `rgba(${Math.round(g.color[0] * cm)},${Math.round(g.color[1] * cm)},${Math.round(g.color[2] * cm)},${alpha})`)
      grad.addColorStop(1, `rgba(${Math.round(g.color[0] * cm)},${Math.round(g.color[1] * cm)},${Math.round(g.color[2] * cm)},0)`)
      ctx.beginPath()
      ctx.arc(px, py, gr, 0, 2 * Math.PI)
      ctx.fillStyle = grad
      ctx.fill()
    }
    // 闪烁小星（世界坐标，大小随缩放同步）
    ctx.save()
    for (const st of bgStars.stars) {
      const alpha = Math.min(1, Math.max(0.06, st.alpha))
      const r = Math.max(st.r / kSafe, 0.35 / kSafe)
      let px = st.x
      let py = st.y
      let bright = alpha
      if (wave) {
        const dxw = st.x - wave.x
        const dyw = st.y - wave.y
        const dist = Math.hypot(dxw, dyw) || 1
        const diff = dist * kSafe - wave.radius
        const ripple = (0.7 * Math.sin(diff * 0.014) + 0.3 * Math.sin(diff * 0.007 + 0.7)) * Math.exp(-Math.abs(diff) / 220)
        px += (dxw / dist) * (60 / kSafe) * ripple * wave.amp
        py += (dyw / dist) * (60 / kSafe) * ripple * wave.amp
        bright = Math.min(1, alpha + 0.45 * Math.exp(-Math.abs(diff) / 140) * wave.amp)
      }
      bright = Math.min(1, bright * gather)
      ctx.beginPath()
      ctx.arc(px, py, r, 0, 2 * Math.PI)
      ctx.fillStyle = `rgba(${Math.round(st.color[0] * cm)},${Math.round(st.color[1] * cm)},${Math.round(st.color[2] * cm)},${bright})`
      ctx.fill()
    }
    ctx.restore()
  }

  // 在画布世界坐标绘制星系核心光晕（父星轨迹环已移除；与节点同一 canvas，随缩放/平移同步）
  function drawRings(ctx, k, now) {
    if (!orbit) return
    const cx = orbit.center.x
    const cy = orbit.center.y
    const R = orbit.outerRx
    // 核心光晕属于星系背景，从第一帧就存在（背景星云随页面打开即有）
    const bg = backdropAlpha(orbit, now)
    // 星系核心光晕（父星的轨迹环已按需求移除，父星轨道只保留彗尾星轨）
    const glowR = R * 0.55
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
    const ringRGB = isLightTheme() ? '52,116,190' : '127,200,255'
    glow.addColorStop(0, `rgba(${ringRGB},${0.22 * bg})`)
    glow.addColorStop(0.55, `rgba(${ringRGB},${0.07 * bg})`)
    glow.addColorStop(1, `rgba(${ringRGB},0)`)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, 2 * Math.PI)
    ctx.fillStyle = glow
    ctx.fill()
    ctx.restore()
  }

  // 父星沿轨道运动的「彗尾」：从父星当前位置向后收窄到尖端（从粗到细到尖），
  // 由外/中/内三层锥形拖尾叠加：外层宽而淡、内层窄而亮，更接近真实彗尾；
  // 尾部始终位于运动反方向。子星（功能点）只围绕父星旋转，不绘制任何轨迹/星环。
  function drawStarTrails(ctx, k, now) {
    if (!orbit || !G) return
    const o = orbit
    const kSafe = k > 0 ? k : 1
    // 三层锥尾：len=尾长（世界px，随轨道半径换算成角度）、halfW=星端半宽、alpha=填充透明度
    const tails = [
      { len: 64, cap: 1.1, halfW: 3.6, alpha: 0.09 },
      { len: 38, cap: 0.72, halfW: 2.0, alpha: 0.20 },
      { len: 20, cap: 0.46, halfW: 1.0, alpha: 0.38 },
    ]
    const SEG = 14 // 每条尾轮廓采样段数（足够平滑，成本极低）
    // 拖拽/选中中的功能点会连带冻结其项目星：与 advanceOrbit 的暂停逻辑一致
    const heldParents = new Set()
    for (const f of o.features) {
      if (Boolean(f.node.__dragged) || f.node.id === current) heldParents.add(f.parent.node.id)
    }
    ctx.save()
    ctx.lineJoin = 'round'
    for (const p of o.projects) {
      const n = p.node
      if (Boolean(n.__dragged) || n.id === current || heldParents.has(n.id) || n.__holdReturn) continue
      if (p.rx <= 0.01) continue
      const angle = Math.atan2(n.y - o.center.y, n.x - o.center.x)
      // 尾在运动反方向：speed>0 逆时针 → 尾在角度减小一侧
      const dir = p.speed >= 0 ? -1 : 1
      const color = n.color || '#7FC8FF'
      for (let t = 0; t < tails.length; t++) {
        const span = Math.min(tails[t].cap, Math.max(0.04, tails[t].len / p.rx))
        const halfW = tails[t].halfW / kSafe
        const cx = o.center.x
        const cy = o.center.y
        ctx.beginPath()
        // 外缘：星端（宽）→ 尖端（半宽收窄到 0）
        for (let i = 0; i <= SEG; i++) {
          const u = i / SEG
          const a = angle + dir * span * u
          const w = halfW * (1 - u)
          const dx = Math.cos(a)
          const dy = Math.sin(a)
          const px = cx + p.rx * dx + w * dx
          const py = cy + p.rx * dy + w * dy
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        // 内缘：尖端 → 星端（闭合锥形，含尖端收成一点）
        for (let i = SEG; i >= 0; i--) {
          const u = i / SEG
          const a = angle + dir * span * u
          const w = halfW * (1 - u)
          const dx = Math.cos(a)
          const dy = Math.sin(a)
          ctx.lineTo(cx + p.rx * dx - w * dx, cy + p.rx * dy - w * dy)
        }
        ctx.closePath()
        ctx.fillStyle = hexA(color, tails[t].alpha)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  // 星系核心恒星：Wiki 功能的可视化锚点 + 功能介绍
  // 恒星固定在星系中心（世界坐标），暖白光芒作为星系视觉锚点；
  // 标题/说明文字随缩放保持可读，与星星标签同款描边光晕。
  function drawCoreStar(ctx, k, now) {
    if (!orbit) return
    const kSafe = k > 0 ? k : 1
    const cx = orbit.center.x
    const cy = orbit.center.y
    const R = orbit.outerRx
    // 恒星柔光：固定大小与亮度（去除呼吸闪光）
    const pulse = 0.5
    const haloR = R * (0.15 + 0.018 * pulse)
    const glowR = R * 0.075
    const coreR = Math.max(13 / kSafe, 5)
    // 外层暖色光晕
    const halo = ctx.createRadialGradient(cx, cy, coreR * 0.4, cx, cy, haloR)
    halo.addColorStop(0, `rgba(255,228,180,${0.30 + 0.10 * pulse})`)
    halo.addColorStop(0.55, `rgba(255,214,150,${0.10 + 0.05 * pulse})`)
    halo.addColorStop(1, 'rgba(255,214,150,0)')
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, haloR, 0, 2 * Math.PI)
    ctx.fillStyle = halo
    ctx.fill()
    // 内层亮核
    const glow = ctx.createRadialGradient(cx, cy, coreR * 0.35, cx, cy, glowR)
    glow.addColorStop(0, 'rgba(255,255,255,0.95)')
    glow.addColorStop(0.55, 'rgba(255,244,214,0.55)')
    glow.addColorStop(1, 'rgba(255,230,180,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, 2 * Math.PI)
    ctx.fillStyle = glow
    ctx.fill()
    // 恒星实心核
    ctx.beginPath()
    ctx.arc(cx, cy, coreR, 0, 2 * Math.PI)
    ctx.fillStyle = '#FFF6E8'
    ctx.fill()
    ctx.restore()
    // 功能介绍：标题在恒星上方（底部说明文字已按产品要求移除），避开内环轨道
    const titleFs = Math.max(21 / kSafe, 8.5)
    const haloAlpha = Math.min(0.9, parseFloat(cssVar('--label-halo-alpha')) || 0.9)
    const gap = coreR * 1.7
    ctx.save()
    ctx.textAlign = 'center'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.font = `700 ${titleFs}px Inter, "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.lineWidth = Math.max(3.2 / kSafe, 1.4)
    ctx.strokeStyle = hexA(graphBg(), haloAlpha)
    ctx.strokeText('Wiki 知识图', cx, cy - gap - titleFs)
    ctx.fillStyle = isLightTheme() ? '#10263E' : '#FFFFFF'
    ctx.fillText('Wiki 知识图', cx, cy - gap - titleFs)
    ctx.restore()
  }

  // 每帧回调：布局稳定后接管坐标（轨道），并先绘制星系核心光晕
  function galaxyFrame(ctx, k) {
    try {
      if (disposed || !G) return
      const nodes = G.graphData().nodes
      if (!nodes || !nodes.length) return
      const now = performance.now()
      frameWave = waveState(now)
      if (!orbit) {
        orbit = buildOrbit(nodes)
        if (orbit) orbit.startTime = 0
      }
      drawStars(ctx, k, now)
      if (orbit) {
        advanceOrbit(orbit, now)
      }
      applyNodeWave(now)
      if (searchLockId) followSearchLock(now)
      if (focusParentId) followFocus(now)
      if (orbit) drawRings(ctx, k, now)
      if (orbit) drawStarTrails(ctx, k, now)
      if (orbit) drawCoreStar(ctx, k, now)
    } catch (e) {
      // 单帧异常不打断 force-graph 的 rAF 链，否则整页动画永久停死
      console.error('[wiki-galaxy] frame error', e)
    }
  }

  // 让星系里的星跟着波浪推出并缓缓回正：波前扫过时沿径向推出一段距离，
  // 之后按指数衰减慢慢回到轨道环（连边/标签跟随，不累积偏移）
  let lastWaveFrame = null
  function applyNodeWave(now) {
    if (!G) return
    const wave = frameWave
    const kSafe = Math.max(G.zoom(), 0.01)
    const dt = lastWaveFrame === null ? 16 : Math.min(50, Math.max(0, now - lastWaveFrame))
    lastWaveFrame = now
    const decay = Math.exp(-dt / 650)
    for (const n of G.graphData().nodes) {
      if (n.x === undefined || n.y === undefined || n.__dragged || n.__holdPrev) continue
      // 已推出的位移逐帧衰减 → 缓缓回正
      if (n.__wavePush) {
        n.__wavePush.x *= decay
        n.__wavePush.y *= decay
        if (Math.hypot(n.__wavePush.x, n.__wavePush.y) < 0.05) n.__wavePush = null
      }
      if (wave) {
        const dxw = n.x - wave.x
        const dyw = n.y - wave.y
        const dist = Math.hypot(dxw, dyw) || 1
        const diff = dist * kSafe - wave.radius
        // 波前刚扫过该星：只沿径向推出一段距离（每波仅一次，无涟漪抖动），
        // 之后靠上方衰减缓缓回正
        if (wave.phase === 'expand' && !n.__wavePushed && Math.abs(diff) < 8) {
          n.__wavePushed = true
          const mag = 150 / kSafe
          n.__wavePush = { x: (dxw / dist) * mag, y: (dyw / dist) * mag }
        }
      }
      if (n.__wavePush) {
        n.x += n.__wavePush.x
        n.y += n.__wavePush.y
      }
      n.fx = n.x
      n.fy = n.y
    }
  }


  // Obsidian 风格节点：柔光晕 + 实心核 + 清晰标签（原版绘制逻辑）
  function paintNode(n, ctx, scale) {
    if (n.x === undefined || n.y === undefined) return
    let waveGlow = 0
    const wave = frameWave
    if (wave) {
      const dxw = n.x - wave.x
      const dyw = n.y - wave.y
      const dist = Math.hypot(dxw, dyw) || 1
      const diff = dist * scale - wave.radius
      waveGlow = 0.20 * Math.exp(-Math.abs(diff) / 150) * wave.amp
    }
    const dim = !passesFilter(n)
    const sel = n.id === current
    const hot = highlightNodes.has(n)
    let r = n.r
    // 聚焦子星系时把父星按屏幕尺寸封顶：放大后父星仍是恒星大小，
    // 不会占满视野把子星吞进父星实心盘里
    if (focusParentId && n.id === focusParentId) r = Math.min(n.r, 26 / scale)
    const base = dim ? 0.12 : 1
    // 子星不绘制外层柔光：只保留内层实心核（点击/悬停时的白描边保留，作为选中反馈）
    if (!dim && isParentNode(n)) {
      const gr = r * (sel ? 3.4 : hot ? 2.8 : 1.7)
      const glow = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, gr)
      glow.addColorStop(0, hexA(n.color, Math.min(0.85, (sel ? 0.5 : hot ? 0.38 : 0.18) + waveGlow)))
      glow.addColorStop(1, hexA(n.color, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(n.x, n.y, gr, 0, 2 * Math.PI)
      ctx.fill()
    }
    ctx.globalAlpha = base
    ctx.beginPath()
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = sel ? brighten(n.color) : n.color
    ctx.fill()
    if (sel || hot) {
      ctx.lineWidth = 1.6 / scale
      ctx.strokeStyle = hexA(isLightTheme() ? '#0A2A4A' : '#FFFFFF', 0.92)
      ctx.stroke()
    }
    // 星系模式：默认只显示项目（父星）名称；功能点名称仅在聚焦其所属项目星时显示
    const showLabel = !isGalaxy || isParentNode(n) || (focusParentId && n.__parentId === focusParentId)
    if (showLabel && (scale > 0.5 || sel || hot || n.anchor)) {
      const fs = Math.max(10 / scale, 3.2)
      ctx.font = `${sel || n.anchor ? 700 : 600} ${fs}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = isGalaxy ? 'middle' : 'top'
      const y = n.y + r + 2.5 / scale
      // 星系模式标签挂在恒星外侧（远离星系中心），树状图模式为 0
      const lx = n.x + (isGalaxy ? (n.__labelDX || 0) : 0)
      const ly = isGalaxy ? n.y + (n.__labelDY || 0) : y
      ctx.globalAlpha = dim ? 0.25 : 1
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      const haloAlpha = Math.min(0.9, parseFloat(cssVar('--label-halo-alpha')) || 0.9)
      ctx.lineWidth = 2.8 / scale
      ctx.strokeStyle = hexA(graphBg(), haloAlpha)
      ctx.strokeText(n.title, lx, ly)
      ctx.fillStyle = sel ? (isLightTheme() ? '#0A2A4A' : '#FFFFFF') : labelColor()
      ctx.fillText(n.title, lx, ly)
    }
    ctx.globalAlpha = 1
  }

  function neighborsOf(node) {
    highlightNodes.clear()
    highlightLinks.clear()
    if (!node || !G) return
    highlightNodes.add(node)
    G.graphData().links.forEach((l) => {
      if (l.source === node || l.target === node) {
        highlightLinks.add(l)
        highlightNodes.add(l.source)
        highlightNodes.add(l.target)
      }
    })
  }

  function hoverHighlight(node) {
    if (current) return
    neighborsOf(node ?? undefined)
    $('#graph').style.cursor = node ? 'pointer' : ''
  }

  // --- 选择与阅读面板 ---
    // --- Selection & reader panel ---
  // Empty-state markup captured once at mount (provided by JSX).
  const EMPTY_HTML = (() => {
    const body = $('#detail-body')
    return body ? body.innerHTML : ''
  })()

  // 星系模式点击节点：把整个星系+星环让位到抽屉左侧可见区域，
  // 不再 centerAt+zoom(2.4) 放大到单个星星（那样会把星环推出视口/盖住）
  function fitGalaxyForDetail() {
    if (!G || !orbit) return
    const w = G.width()
    const h = G.height()
    const drawerW = Math.min(440, Math.round(w * 0.48))
    const margin = 36
    const visW = Math.max(200, w - drawerW - margin * 2)
    const visH = Math.max(160, h - margin * 2)
    const fit = Math.min(visW / 2 / orbit.outerRx, visH / 2 / orbit.outerRx)
    const z = Math.min(Math.max(G.zoom(), 0.65), Math.max(0.7, fit))
    // 让星系中心落在「画布总宽 − 抽屉宽」的可见区域正中
    const targetX = (w - drawerW) / 2
    const camX = orbit.center.x + (w / 2 - targetX) / z
    G.centerAt(camX, orbit.center.y, 600)
    G.zoom(z, 600)
  }

  // 子星系聚焦：点击父星/子星后，相机放大到该父星及其子星组成的迷你星系；
  // 聚焦期间隐藏父星轨迹环（drawRings 跳过），并持续跟随父星。
  function focusSubGalaxy(id) {
    if (!G || !orbit) return
    const fo = nodeById.get(id)
    if (!fo || !Number.isFinite(fo.x)) return
    let parentId = fo.type === 'Project' ? id : null
    if (!parentId) {
      const f = orbit.features.find((x) => x.node.id === id)
      if (f) parentId = f.parent.node.id
    }
    if (!parentId) parentId = id
    const parent = nodeById.get(parentId)
    if (!parent) return
    focusParentId = parentId
    const feats = orbit.features.filter((f) => f.parent.node.id === parentId)
    const maxR = feats.length ? Math.max(...feats.map((f) => f.rx)) : 24
    const extent = Math.max(30, maxR + (parent.r || 8) + 16)
    const w = G.width() || 1600
    const h = G.height() || 1000
    const drawerW = Math.min(440, Math.round(w * 0.48))
    const margin = 36
    const visW = Math.max(200, w - drawerW - margin * 2)
    const visH = Math.max(160, h - margin * 2)
    const z = Math.min(5, Math.max(1.2, Math.min(visW / 2 / extent, visH / 2 / extent)))
    // 让子星系中心落在「画布总宽 − 抽屉宽」的可见区域正中
    const targetX = (w - drawerW) / 2
    const camX = parent.x + (w / 2 - targetX) / z
    focusAt = performance.now()
    G.zoom(z, 600)
    G.centerAt(camX, parent.y, 600)
  }

  // 子星系聚焦跟随：父星沿轨道缓速移动时相机跟上；用户拖拽/滚轮后 1.2s 内暂停
  function followFocus(now) {
    if (!focusParentId || !G) return
    if (now - lastPointer < 1200) return
    if (now - focusAt < 600) return
    const parent = nodeById.get(focusParentId)
    if (!parent || !Number.isFinite(parent.x) || !Number.isFinite(parent.y)) return
    if (Boolean(parent.__dragged) || Boolean(parent.__holdReturn)) return
    const z = Math.max(G.zoom() || 1, 0.01)
    const w = G.width()
    const h = G.height()
    if (!w || !h) return
    const drawerW = Math.min(440, Math.round(w * 0.48))
    const targetX = (w - drawerW) / 2
    const camX = parent.x + (w / 2 - targetX) / z
    focusAt = now
    G.centerAt(camX, parent.y, 700)
  }

  // 把指针事件坐标转成画布世界坐标（与主题波浪同一套换算）
  function pointerWorld(e) {
    if (!G || typeof G.screen2GraphCoords !== 'function') return null
    const rect = $('#graph').getBoundingClientRect()
    const x = (Number(e.clientX) || e.pageX || 0) - rect.left
    const y = (Number(e.clientY) || e.pageY || 0) - rect.top
    const pt = G.screen2GraphCoords(x, y)
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null
    return pt
  }

  // 中心恒星 → Wiki 功能介绍：渲染静态介绍到阅读面板并打开
  
  function openWikiIntro() {
    const body = $('#detail-body')
    if (!body) return
    if (isGalaxy && orbit) fitGalaxyForDetail()
    focusParentId = null
    body.innerHTML =
      `<div class="eyebrow">Wiki 知识图</div>` +
      `<h1 class="doc-title">欢迎来到 Wiki 知识星系</h1>` +
      `<hr class="rule" />` +
      `<div class="md">` +
      `<p>这里汇聚了所有已生成 Wiki 的项目：每个项目是一颗恒星，功能点是围绕恒星运行的行星。</p>` +
      `<ul>` +
      `<li><strong>阅读文档</strong>：点击任意星星，右侧面板打开对应 Wiki 页面。</li>` +
      `<li><strong>定位知识</strong>：使用搜索框，直接跳到匹配的星星。</li>` +
      `<li><strong>探索结构</strong>：星环是项目轨道，行星展示项目内的功能点。</li>` +
      `</ul>` +
      `</div>`
    const d = $('#detail')
    if (d) d.classList.add('open')
  }

  function selectNode(id) {
    if (searchLockId && searchLockId !== id) searchLockId = null
    current = id
    neighborsOf(nodeById.get(id))
    const fo = nodeById.get(id)
    if (fo && G && Number.isFinite(fo.x)) {
      if (isGalaxy && orbit) focusSubGalaxy(id)
      else {
        G.centerAt(fo.x, fo.y, 500)
        G.zoom(Math.max(G.zoom(), 2.4), 500)
      }
    }
    renderReader(id)
  }

  function closeDetail() {
    current = null
    highlightNodes.clear()
    highlightLinks.clear()
    const body = $('#detail-body')
    if (body) body.innerHTML = EMPTY_HTML
    const d = $('#detail')
    if (d) d.classList.remove('open')
    // 关闭阅读面板：退出子星系聚焦，恢复全景星系视图（外圆环重新显示）
    if (focusParentId) {
      focusParentId = null
      if (G && orbit) {
        const w = G.width() || 1600
        const h = G.height() || 1000
        const fit = Math.min(w / 2 / orbit.outerRx, h / 2 / orbit.outerRx)
        G.centerAt(orbit.center.x, orbit.center.y, 600)
        G.zoom(Math.min(Math.max(G.zoom(), 0.65), Math.max(0.7, fit)), 600)
      }
    }
  }

  function clearSelection() {
    searchLockId = null
    closeDetail()
  }

  // Render the reading panel (ported from client.ts renderReader, DOM scoped to root).
  function renderReader(id) {
    const n = byId(id)
    if (!n) return
    const body = $('#detail-body')
    if (!body) return
    const tags = (n.tags && n.tags.length)
      ? `<div class="tags">${n.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : ''
    const desc = n.description
      ? `<p class="desc">${escapeHtml(n.description)}</p>`
      : ''
    const backEls = (n.backlinks || [])
      .map((b) => {
        const t = byId(b)
        return t
          ? `<span class="chip" data-id="${escapeHtml(b)}">${escapeHtml(t.title)}</span>`
          : ''
      })
      .join('')
    const back = (n.backlinks && n.backlinks.length)
      ? `<div class="backlinks"><span class="eyebrow">Referenced by</span>${backEls}</div>`
      : ''
    // Defense in depth: marked passes raw HTML through, so sanitize first.
    const html = DOMPurify.sanitize(marked.parse(stripFrontmatter(n.body || '')))
    body.innerHTML =
      `<div class="eyebrow">${escapeHtml(n.type || '')}</div>` +
      `<h1 class="doc-title">${escapeHtml(n.title)}</h1>` +
      desc +
      tags +
      `<hr class="rule" />` +
      `<div class="md">${html}</div>` +
      back
    rewriteLinks(n)
    renderMermaid()
    const d = $('#detail')
    if (d) d.scrollTop = 0
    body.querySelectorAll('.chip').forEach((c) => {
      c.addEventListener('click', () => {
        const id = c.dataset.id
        if (id) selectNode(id)
      })
    })
    if (d) d.classList.add('open')
  }

  // Turn markdown links that resolve to a node into in-app navigation.
  function rewriteLinks(node) {
    const dir = node.id.includes('/')
      ? node.id.slice(0, node.id.lastIndexOf('/'))
      : ''
    const body = $('#detail-body')
    if (!body) return
    body.querySelectorAll('.md a').forEach((a) => {
      const href = a.getAttribute('href') ?? ''
      if (!href.endsWith('.md') && !href.includes('.md#')) return
      const clean = href.split('#')[0]
      const target = normalize(dir, clean).replace(/\.md$/, '')
      if (byId(target)) {
        a.classList.add('wikilink')
        a.addEventListener('click', (e) => {
          e.preventDefault()
          selectNode(target)
        })
      }
    })
  }

  // Upgrade fenced mermaid blocks into rendered diagrams.
  function renderMermaid() {
    const body = $('#detail-body')
    if (!body) return
    const blocks = body.querySelectorAll('code.language-mermaid')
    let i = 0
    blocks.forEach((code) => {
      const pre = document.createElement('pre')
      pre.className = 'mermaid'
      pre.textContent = code.textContent
      code.closest('pre')?.replaceWith(pre)
      i++
    })
    if (i > 0) {
      try {
        mermaid.run({ nodes: body.querySelectorAll('.mermaid') })
      } catch {
        // non-fatal
      }
    }
  }

  function appTheme() {
    // 星图固定黑夜主题：根节点 data-theme 恒为 dark，CSS 不再套用白昼星图配色
    return 'dark'
  }

  function applyTheme() {
    root.setAttribute('data-theme', appTheme())
    mermaid.initialize({ startOnLoad: false, theme: 'dark' })
    if (G) G.backgroundColor('rgba(0,0,0,0)')
  }

  const themeObserver = new MutationObserver(() => applyTheme())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  // 初始即强制黑夜星图（不依赖宿主主题触发）
  applyTheme()
  // 星空右上角搜索框（星系模式）
  createSearchBox()
  // 阅读面板关闭按钮
  const closeBtn = $('#detail-close')
  if (closeBtn) closeBtn.addEventListener('click', closeDetail)

  // 主题扩散波浪：App 在扩散动画起点派发 dd:theme-wave；
  // 把按钮点击的屏幕坐标转成画布世界坐标，保证涟漪与扩散圆同圆心、同步推进
  const onThemeWave = (e) => {
    const d = e.detail || {}
    if (!isGalaxy || !G || typeof G.screen2GraphCoords !== 'function') return
    const rect = $('#graph').getBoundingClientRect()
    const pt = G.screen2GraphCoords((Number(d.x) || 0) - rect.left, (Number(d.y) || 0) - rect.top)
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return
    themeWave = {
      x: pt.x,
      y: pt.y,
      maxR: Math.max(1, Number(d.maxR) || 1),
      duration: Math.max(120, Number(d.duration) || 1100),
      tailDur: 900,
      t0: performance.now(),
    }
    if (G && G.graphData) {
      for (const n of G.graphData().nodes) n.__wavePushed = false
    }
  }
  window.addEventListener('dd:theme-wave', onThemeWave)

  // TEMP-DEBUG: 仅用于自动化验证，验证后删除
  // --- 数据加载与轮询刷新 ---
  const authHeaders = () => {
    try {
      const t = localStorage.getItem('dd-token') || ''
      return t ? { Authorization: 'Bearer ' + t } : {}
    } catch {
      return {}
    }
  }
  // 应用一份图谱 payload：初始化画布 / 拓扑变化才重渲染（load 与缓存数据共用）
  function applyPayload(payload) {
    if (!payload || payload.ok !== true) throw new Error(payload?.error || '图谱加载失败')
    graph = payload.graph
    const entry =
      graph.nodes.find((n) => n.type === 'Project') ??
      graph.nodes.find((n) => /quickstart/i.test(n.id)) ??
      graph.nodes.find((n) => /(^|\/)(index|overview|home)$/i.test(n.id)) ??
      graph.nodes[0]
    anchorId = entry ? entry.id : null
    assignColors()
    const sig = signature(graph)
    // 首次成功加载（含初次失败后的重试）才初始化画布；拓扑变化才重渲染
    if (!G) {
      initGraph()
      if (G) {
        G.graphData(buildGraphData())
        G.zoom((4 / Math.cbrt(graph.nodes.length || 1)) * 1.35)
        // 星系模式星星直接落在轨道原位；项目模式保留原散落布局
        if (isGalaxy) placeStarsOnOrbits()
        else scatterStars()
        // 立即建立轨道：星星从第一帧就在原位并开始旋转
        orbit = buildOrbit(G.graphData().nodes)
        if (orbit) orbit.startTime = 0
        freezeAt = null
      }
      lastSig = sig
      ready = true
      if (onReadyCb) onReadyCb()
    } else if (sig !== lastSig) {
      if (G) {
        G.graphData(buildGraphData())
        if (isGalaxy) placeStarsOnOrbits()
        else scatterStars()
        orbit = buildOrbit(G.graphData().nodes)
        if (orbit) orbit.startTime = 0
        freezeAt = null
      }
      lastSig = sig
    }
    return sig
  }

  async function load() {
    // 宿主已缓存的数据（登录后预取 / Wiki 页缓存）：立即应用，点开即成形；
    // 网络请求在后台静默刷新，拓扑变化时无缝更新
    if (initialData && !graph) {
      const seed = initialData
      initialData = null
      try {
        applyPayload(seed)
      } catch (e) {
        console.warn('[wiki] 缓存图谱不可用，改走网络加载', e)
      }
    }
    if (disposed || suspended) return
    const url = isGalaxy
      ? `/api/projects/wiki-galaxy`
      : `/api/projects/${projectId}/wiki-graph`
    try {
      const res = await fetch(url, { headers: authHeaders() })
      const payload = await res.json()
      // 组件可能已在请求期间卸载（StrictMode 双挂载 / 快速切页）：
      // 此时必须放弃后续初始化，否则会在卸载后创建 force-graph 实例并泄漏 rAF 循环
      if (disposed || suspended) return
      applyPayload(payload)
    } catch (e) {
      // 已有星系（缓存/上次成功数据）时静默保留，等下一轮轮询重试
      if (!graph) throw e
      console.warn('[wiki] 图谱刷新失败，保留当前星系', e)
    }
    return signature(graph)
  }

  function buildGraphData() {
    const ids = new Set(graph.nodes.map((n) => n.id))
    for (const id of [...nodeById.keys()]) if (!ids.has(id)) nodeById.delete(id)
    const nodes = graph.nodes.map((n) => {
      let o = nodeById.get(n.id)
      if (!o) {
        o = { id: n.id, title: n.title, type: n.type, size: n.size, tags: n.tags, description: n.description, color: '#7FC8FF', anchor: false, r: 4 }
        nodeById.set(n.id, o)
      }
      o.title = n.title
      o.type = n.type
      o.size = n.size
      o.tags = n.tags
      o.description = n.description
      o.color = n.color || colorForType[n.type] || '#7FC8FF'
      o.anchor = isAnchor(n)
      o.r = nodeRadius(n.size, isParentNode(n), isAnchor(n))
      return o
    })
    // 星系 API 边是成对返回（A→B 与 B→A），只保留一条关联线
    const seen = new Set()
    const links = []
    for (const e of graph.edges) {
      const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ source: e.source, target: e.target })
    }
    return { nodes, links }
  }

  function toast(msg) {
    const t = $('#toast')
    t.textContent = msg
    t.classList.add('show')
    setTimeout(() => { if (!disposed) t.classList.remove('show') }, 1800)
  }

  // --- 搜索定位：匹配节点 → 高亮全部匹配 + 居中缩放 + 锁定跟随 ---
  // 搜索只做高亮与相机锁定，不打开阅读抽屉（避免抽屉盖住搜索框与星空）；
  // 点击高亮星星后才会打开对应 Wiki 阅读面板。
  function locateNode(query) {
    const q = String(query || '').trim().toLowerCase()
    if (!G) return 0
    if (!q) {
      clearSelection()
      return 0
    }
    const matches = graph.nodes.filter((n) => matchesFilter(n, q, ''))
    highlightNodes.clear()
    highlightLinks.clear()
    if (!matches.length) {
      // 无匹配：释放锁定，保留当前阅读面板不动
      searchLockId = null
      return 0
    }
    const first = matches[0]
    current = null
    focusParentId = null
    const d = $('#detail')
    if (d) d.classList.remove('open')
    for (const m of matches) {
      const o = nodeById.get(m.id)
      if (o) highlightNodes.add(o)
    }
    // 同时高亮匹配节点之间的父星↔子星关联线
    const matchIds = new Set(matches.map((m) => m.id))
    G.graphData().links.forEach((l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source
      const t = typeof l.target === 'object' ? l.target.id : l.target
      if (matchIds.has(s) && matchIds.has(t)) highlightLinks.add(l)
    })
    searchLockId = first.id
    searchLockAt = 0
    const fo = nodeById.get(first.id)
    if (fo && Number.isFinite(fo.x)) {
      G.centerAt(fo.x, fo.y, 600)
      if (isGalaxy) G.zoom(2.2, 600)
      else G.zoom(3.4, 600)
    } else if (G) {
      G.centerAt(0, 0, 600)
    }
    return matches.length
  }

  // 解除搜索锁定：保留当前选中/阅读面板，只停止相机跟随
  function clearSearchLock() {
    searchLockId = null
  }

  // 搜索锁定跟随：目标星沿轨道移动时相机缓速跟上；用户拖拽/滚轮后 1.2s 内暂停，
  // 松开后自动恢复锁定。节流 900ms 避免 centerAt 每帧打断 force-graph 的过渡。
  function followSearchLock(now) {
    if (!G) return
    if (now - lastPointer < 1200) return
    if (now - searchLockAt < 900) return
    const fo = nodeById.get(searchLockId)
    if (!fo || !Number.isFinite(fo.x) || !Number.isFinite(fo.y)) return
    const z = Math.max(G.zoom() || 1, 0.01)
    const w = G.width()
    const h = G.height()
    if (!w || !h) return
    const sx = (fo.x - G.state?.zoom?.x ?? 0) * z + w / 2
    const sy = (fo.y - G.state?.zoom?.y ?? 0) * z + h / 2
    const m = 0.25 * w
    if (Math.abs(sx - w / 2) > m || Math.abs(sy - h / 2) > m) {
      searchLockAt = now
      G.centerAt(fo.x, fo.y, 850)
    }
  }

  // 星空右上角搜索框（仅星系模式）：输入即搜索父星/子星，
  // 匹配后高亮 + 居中缩放 + 锁定相机跟随；Enter 立即定位，Esc 清空并释放锁定。
  function createSearchBox() {
    if (!isGalaxy) return
    const main = root.querySelector('.main')
    if (!main || main.querySelector('.ow-search')) return
    const wrap = document.createElement('div')
    wrap.className = 'ow-search'
    wrap.setAttribute('role', 'search')
    wrap.innerHTML =
      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>` +
      `<input type="search" placeholder="搜索父星 / 子星…" aria-label="搜索星星" autocomplete="off" spellcheck="false" />` +
      `<span class="ow-search-count"></span>`
    const input = wrap.querySelector('input')
    const countEl = wrap.querySelector('.ow-search-count')
    const run = () => {
      const q = input.value.trim()
      if (!q) {
        countEl.textContent = ''
        clearSelection()
        return
      }
      const n = locateNode(q)
      countEl.textContent = n > 0 ? `匹配 ${n}` : '无匹配'
    }
    input.addEventListener('input', () => {
      clearTimeout(searchDebounce)
      searchDebounce = setTimeout(run, 220)
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        clearTimeout(searchDebounce)
        run()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        input.value = ''
        countEl.textContent = ''
        clearTimeout(searchDebounce)
        clearSelection()
        input.blur()
      }
    })
    main.appendChild(wrap)
  }

  let pollTimer = null
  let loadFailed = false
  const startPolling = () => {
    if (pollTimer || disposed) return
    pollTimer = setInterval(async () => {
      if (disposed || suspended) return
      try {
        const sig = await load()
        if (loadFailed) {
          loadFailed = false
          toast("项目读取成功")
        } else if (sig !== lastSig) {
          toast("Wiki updated")
        }
      } catch { /* 静默，下轮重试 */ }
    }, 4000)
  }
  const stopPolling = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }
  load()
    .catch((e) => {
      loadFailed = true
      console.error("[wiki] load failed:", e)
      if (!disposed && !suspended) toast("图谱加载失败，正在自动重试…")
    })
  startPolling()

  // 挂起/恢复：离开 wiki 页时暂停渲染与轮询，返回时无缝续跑（不销毁、不重新加载）
  const suspend = () => {
    if (disposed) return
    suspended = true
    stopPolling()
    if (fitTimer) { clearTimeout(fitTimer); fitTimer = null }
    if (fitCommitTimer) { clearTimeout(fitCommitTimer); fitCommitTimer = null }
    try { G?.pauseAnimation?.() } catch {}
  }
  const resume = () => {
    if (disposed) return
    suspended = false
    try { G?.resumeAnimation?.() } catch {}
    if (!ready) load().catch(() => {})
    startPolling()
    if (fitSizeRef) fitSizeRef()
  }
  const setActive = (a) => { if (a) resume(); else suspend() }
  const isReady = () => ready
  const ctrl = {
    _setOnReady: (cb) => { onReadyCb = cb || null },
    cleanup: () => {
      disposed = true
      suspended = false
      vizCache.delete(key)
      if (fitTimer) { clearTimeout(fitTimer); fitTimer = null }
      clearInterval(pollTimer)
      if (searchDebounce) clearTimeout(searchDebounce)
      themeObserver.disconnect()
      if (resizeObserver) resizeObserver.disconnect()
      try {
        // 停止 force-graph 的渲染循环并清空图数据（_destructor 内部即
        // pauseAnimation + graphData 清空）。与 load() 中的 disposed 检查配合，
        // 确保卸载后不再残留 rAF 循环，反复进出 wiki 页也不会累积卡顿
        G?.pauseAnimation?.()
        G?._destructor?.()
      } catch {}
      orbit = null
      bgStars = null
      freezeAt = null
      themeWave = null
      focusParentId = null
      window.removeEventListener('dd:theme-wave', onThemeWave)
      const c = $('#graph')
      if (c) {
        c.removeEventListener('pointerdown', markPointer)
        c.removeEventListener('wheel', markPointer)
      }
      const searchEl = root.querySelector('.ow-search')
      if (searchEl) searchEl.remove()
      try {
        // 清理画布，避免切换项目时叠加旧内容
        $('#graph').innerHTML = ''
      } catch {}
    },
    locateNode,
    clearSearchLock,
    selectNode,
    closeDetail,
    suspend,
    resume,
    setActive,
    isReady,
  }
  vizCache.set(key, { root, ctrl, destroyed: false })
  return ctrl
}
