import { useEffect, useRef, useState } from 'react'
import { initWikiVisualizer } from '../../lib/wiki/visualizer.js'
import '../../styles/wiki/visualizer.css'

/**
 * OpenWiki 可视化器 React 封装：原版 DOM 骨架（page.ts 原样抄录，仅保留图谱区）。
 * mode="project"：渲染单个项目图谱（需 projectId）；mode="galaxy"：自动读取所有项目生成星系图。
 * 已按产品要求去除顶栏（品牌/搜索/主题按钮）与右侧阅读面板，只保留图谱铺满；
 * 深浅主题跟随主应用 document.documentElement 的 data-theme（项目顶栏切换按钮）。
 *
 * 缓存与保活：初始化后的实例在模块级缓存中复用；active=false 时挂起（暂停渲染与轮询），
 * active=true 时无缝恢复并播放淡入过渡 —— 进入/离开 wiki 页不再重新加载、不再卡顿。
 */
export default function WikiVisualizer({ mode = 'project', projectId, active = true, graph }) {
  const rootRef = useRef(null)
  const ctrlRef = useRef(null)
  const [ready, setReady] = useState(false)
  const isGalaxy = mode === 'galaxy'

  // 首次激活时初始化；若实例已缓存则直接恢复（不重建画布/轨道/背景）
  useEffect(() => {
    const root = rootRef.current
    if (!root || !active) return
    if (!isGalaxy && !projectId) return
    let ctrl
    try {
      ctrl = initWikiVisualizer(root, { projectId, galaxy: isGalaxy, initialData: graph, onReady: () => setReady(true) })
      ctrlRef.current = ctrl
      if (ctrl.isReady()) setReady(true)
    } catch (e) {
      console.error('[wiki-visualizer]', e)
    }
    return () => ctrl?.suspend?.()
  }, [isGalaxy, projectId, active])

  // 激活/隐藏切换：挂起或恢复 + 播放进入过渡动画
  useEffect(() => {
    ctrlRef.current?.setActive?.(active)
    const root = rootRef.current
    if (root && active) {
      root.classList.remove('wiki-enter')
      void root.offsetWidth
      root.classList.add('wiki-enter')
    }
  }, [active])

  return (
    <div className="ow-viz" ref={rootRef}>
      <div className="main">
        {isGalaxy && <div className="galaxy-bg" aria-hidden="true"></div>}
        <div id="graph" className={isGalaxy ? 'galaxy-mode' : ''}></div>
      </div>
      {isGalaxy && (
        <div className={'ow-loading-overlay' + (ready ? ' hide' : '')} aria-hidden={ready ? 'true' : undefined}>
          <span className="ow-spinner" />
          <span>正在点亮星系…</span>
        </div>
      )}
      <div className="detail" id="detail" aria-hidden="true">
        <div className="detail-toolbar">
          <button type="button" className="detail-close" id="detail-close" aria-label="Close reader" title="Close">&#10005;</button>
        </div>
        <div className="detail-body" id="detail-body">
          <div className="empty">
            <div className="eyebrow">Wiki Galaxy</div>
            <h1 className="doc-title">Click a star to read</h1>
            <p className="desc">Every project and feature is a node in the galaxy. Click any star to open its Wiki page in the reader.</p>
          </div>
        </div>
      </div>
      <div className="toast" id="toast">Wiki updated</div>
    </div>
  )
}
