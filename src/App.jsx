/** 应用入口：导航注册、登录态、主题与页面分发。各功能页见 src/pages/，通用组件见 src/components/。 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { api } from './api.js'
import TtShell from './components/tt/TtShell.jsx'
import LocalProxyPill from './components/LocalProxyPill.jsx'
import { cachedFetch, clearPageDataCache } from './utils/cache.js'
import ReviewPanel from './components/ReviewPanel.jsx'
import UsersPanel from './components/UsersPanel.jsx'
import AdminMarketPanel from './components/AdminMarketPanel.jsx'
import AdminPointsPanel from './components/AdminPointsPanel.jsx'
import ChatWorkspace from './pages/ChatWorkspace.jsx'
import DistilleryPage from './pages/DistilleryPage.jsx'
import FeaturesPage from './pages/FeaturesPage.jsx'
import ProjectsPage from './pages/ProjectsPage.jsx'
import WikiPage from './pages/WikiPage.jsx'
import AnalysisPage from './pages/AnalysisPage.jsx'
import DeliverablesPage from './pages/DeliverablesPage.jsx'
import PromptsPage from './pages/PromptsPage.jsx'
import PointsPage from './pages/PointsPage.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import AuthScreen from './pages/AuthScreen.jsx'

const baseNav = [
  { id: 'chat', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>, title: '项目对话', desc: '每个对话即一个项目，与 AI 项目经理聊需求' },
  { id: 'distillery', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2v5.5L4.6 17.8A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.8-3.2L14 7.5V2"/><path d="M7.5 15h9"/><path d="M9 2h6"/></svg>, title: '需求蒸馏', desc: '把对话或素材蒸馏为功能点，自动生成项目' },
  { id: 'features', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>, title: '功能点库', desc: '管理功能点：收藏、保留、舍弃、整合' },
  { id: 'projects', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>, title: '项目管理', desc: '调整项目功能结构，托管实体项目' },
  { id: 'analysis', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M8 17v-6"/><path d="M13 17V7"/><path d="M18 17v-9"/></svg>, title: '产品分析', desc: '市场分析、PRD 与 HTML 交互原型' },
  { id: 'deliverables', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>, title: '文档生成', desc: '按模板生成 Word / PDF / LaTeX 文档' },
  { id: 'prompts', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>, title: 'AI 提示词', desc: '为 AI 编程 Agent 生成项目开发提示词' },
  { id: 'points', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l2.9 6.26 6.6.57-5 4.4 1.5 6.47L12 16.9 5.99 19.7l1.5-6.47-5-4.4 6.6-.57z"/></svg>, title: '积分激励', desc: '提交作品赚积分，管理员审核通过后自动发放' },
  { id: 'leaderboard', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a2 2 0 0 0 2 2h1"/><path d="M17 6h3v2a2 2 0 0 1-2 2h-1"/></svg>, title: '创作积分', desc: '按创作激励积分排名' },
  { id: 'wiki', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><circle cx="5" cy="5.5" r="2.5"/><circle cx="19" cy="5.5" r="2.5"/><circle cx="5" cy="18.5" r="2.5"/><circle cx="19" cy="18.5" r="2.5"/><path d="M9.7 10.3 7.2 7.4M14.3 10.3l2.5-2.9M9.7 13.7l-2.5 2.9M14.3 13.7l2.5 2.9"/></svg>, title: '知识图谱', desc: '导入 OpenWiki 生成项目知识图谱' },
  { id: 'usage', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>, title: '用量统计', desc: '原版 TokenTracker 仪表盘' },
  { id: 'sessions', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>, title: '会话明细', desc: '原版 TokenTracker 会话页' },
  { id: 'settings', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>, title: '模型配置', desc: '统一配置 AI 接口与每日用量' },
  { id: 'profile', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>, title: '个人中心', desc: '修改个人资料、密码，充值积分' },
]

/** 管理端导航项：仅管理员账号可见，作为独立功能放在菜单末尾。 */
const ADMIN_NAV_ITEMS = [
  { id: 'admin-users', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, title: '用户管理', desc: '查看所有用户、作品数与积分情况' },
  { id: 'admin-works', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/></svg>, title: '作品审核', desc: '审核用户提交的作品，通过后发放积分' },
  { id: 'admin-market', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9 5 3h14l2 6"/><path d="M3 9h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M9 21h6"/><path d="M12 16v5"/></svg>, title: '模板市场', desc: '设置价格上架模板，或将审核作品导入为模板' },
  { id: 'admin-points', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>, title: '模型管理', desc: '管理积分模型、接口与 Key，查看各接口使用人数' },
]

/** 登录 / 注册界面：首次进入需注册，之后登录；每人数据独立。 */

export default function App() {
  const [tab, setTab] = useState('chat')
  // 登录态：null=检查中 / false=未登录（渲染登录界面）/ true=已登录
  const [authed, setAuthed] = useState(null)
  const [authUser, setAuthUser] = useState(api.currentUser())
  // 管理员登录后菜单只保留管理功能（用户管理 / 作品审核）；普通用户见完整功能菜单
  const NAV = useMemo(() => (authUser?.role === 'admin' ? ADMIN_NAV_ITEMS : baseNav), [authUser])
  // 管理员登录后自动落在第一个管理页（默认 tab=chat 不在管理菜单里）
  useEffect(() => {
    if (authed && NAV.length && !NAV.some((n) => n.id === tab)) setTab(NAV[0].id)
  }, [authed, NAV, tab])
  useEffect(() => {
    const onUnauth = () => { setAuthed(false); setAuthUser(null) }
    window.addEventListener('dd-unauthorized', onUnauth)
    let hasToken = false
    try { hasToken = !!localStorage.getItem('dd-token') } catch {}
    if (hasToken) {
      api.authMe()
        .then((r) => { setAuthUser(r.user); setAuthed(true) })
        .catch(() => setAuthed(false))
    } else setAuthed(false)
    return () => window.removeEventListener('dd-unauthorized', onUnauth)
  }, [])
  // 登录后预取全部功能页数据：点开菜单时数据已在，无需等待加载
  useEffect(() => {
    if (!authed) return
    if (authUser?.role === 'admin') {
      // 管理端只预取管理数据
      const adminPreloads = [
        ['adminUsers', () => api.adminListUsers()],
        ['adminWorks', () => api.adminListWorks('pending')],
        ['market', () => api.marketTemplates()],
        ['pointsModels', () => api.adminGetPointsModels()],
      ]
      for (const [key, loader] of adminPreloads) cachedFetch(key, loader).catch(() => {})
      return
    }
    const preloads = [
      ['projects', () => api.listProjects()],
      ['features', () => api.listFeatures()],
      ['chatSessions', () => api.listChatSessions()],
      ['templates', () => api.listTemplates()],
      ['promptTemplates', () => api.listPromptTemplates()],
      ['changelog', () => api.listChangelog()],
      ['distilleryOverview', () => api.distilleryOverview()],
      ['wikiGalaxy', () => api.wikiGalaxy()],
      ['points', () => api.pointsMe()],
      ['leaderboard', () => api.pointsLeaderboard()],
      ['market', () => api.marketTemplates()],
    ]
    for (const [key, loader] of preloads) cachedFetch(key, loader).catch(() => {})
  }, [authed, authUser])
  const logout = async () => {
    try { await api.authLogout() } catch {}
    api.clearAuth()
    clearPageDataCache()
    setAuthed(false); setAuthUser(null); setTab('chat')
  }
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 主题：黑夜 / 日间（localStorage 持久化）
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [theme, setTheme] = useState(() => {
    try {
      const t = localStorage.getItem('dd-theme')
      if (t === 'dark' || t === 'light') return t
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('dd-theme', theme) } catch {}
  }, [theme])
  // 扩散式切换：圆形从按钮中心扩散覆盖全屏（View Transitions API）
  const toggleTheme = (ev) => {
    const next = theme === 'dark' ? 'light' : 'dark'
    const rect = ev.currentTarget.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const maxR = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const apply = () => {
      // 快照捕获瞬间禁用 CSS 过渡：带 transition 的元素（TT 页按钮/输入框/分段控件等）
      // 颜色切换会被浏览器排到下一帧才执行，导致新快照里文字仍以旧（暗色）值渲染，
      // 圆形扩散时就会出现“字闪黑框”。禁用后颜色即时到位，快照即为最终配色。
      document.documentElement.classList.add('dd-theme-freeze')
      document.documentElement.dataset.theme = next
      flushSync(() => setTheme(next))
    }
    const release = () => document.documentElement.classList.remove('dd-theme-freeze')
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (typeof document.startViewTransition === 'function' && !reduceMotion) {
      const vt = document.startViewTransition(apply)
      vt.ready.then(() => {
        // 与扩散圆同圆心、同步推进：Wiki 星系图监听后让星星随波涟漪
        window.dispatchEvent(new CustomEvent('dd:theme-wave', { detail: { x, y, maxR, duration: 1100 } }))
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxR}px at ${x}px ${y}px)`] },
          { duration: 1100, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
        )
      }).catch(() => {})
      // 扩散动画结束后恢复 CSS 过渡（快照与扩散期间保持无过渡）
      vt.finished.then(release, release)
    } else {
      apply()
      release()
    }
  }
  const [deliverableProjectId, setDeliverableProjectId] = useState(null)
  const [analysisProjectId, setAnalysisProjectId] = useState(null)
  // 全局后台任务：跳转页面不中断，右上角显示状态圈；完成后短暂显示「完成」提示
  const [pendingTask, setPendingTask] = useState(null)
  const [taskDone, setTaskDone] = useState(null)
  const taskLabelRef = useRef(null)
  const taskTimer = useRef(null)
  // 耗时操作结果全局保留：跳走再回来不丢失（文档生成 / 分析 / 提示词）
  const [deliverableResult, setDeliverableResult] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [promptResult, setPromptResult] = useState(null)

  const applyTab = (t) => {
    setTab(t)
    setSidebarOpen(false)
  }
  const changeTab = (t) => applyTab(t)
  // Switching tabs from the nav menu is a plain swap: no circular reveal here.
  // (The night/day toggle keeps its own circular reveal animation.)
  const navClick = (ev, t) => applyTab(t)
  const startTask = (label) => { taskLabelRef.current = label; setTaskDone(null); setPendingTask(label) }
  const endTask = () => {
    setPendingTask(null)
    const label = taskLabelRef.current
    taskLabelRef.current = null
    if (label) {
      // 「文档生成中…」→「文档生成完成」
      const done = label.replace(/中…(（[^）]*）)?$/, '') + '完成'
      setTaskDone(done)
      clearTimeout(taskTimer.current)
      taskTimer.current = setTimeout(() => setTaskDone(null), 3000)
    }
  }
  // 蒸馏完成后展示提醒，引导用户前往项目页
  const gotoProjects = () => changeTab('projects')
  // 从分析页跳文档/从项目页跳分析，并预选项目
  const gotoDeliverables = (pid) => { setDeliverableProjectId(pid); changeTab('deliverables') }
  const gotoAnalysis = (pid) => { setAnalysisProjectId(pid); changeTab('analysis') }
  const active = NAV.find((n) => n.id === tab) || (tab === 'profile' ? { id: 'profile', title: '个人中心', desc: '修改个人资料、密码，充值积分' } : NAV[0])
  const contentRef = useRef(null)
  const firstEnter = useRef(true)
  useEffect(() => {
    if (firstEnter.current) { firstEnter.current = false; return }
    const el = contentRef.current
    if (!el) return
    if (tab === 'wiki') return
    el.classList.remove('page-enter')
    void el.offsetWidth
    el.classList.add('page-enter')
  }, [tab])

  if (authed === null) return <div className="auth-screen"><span className="spin" /></div>
  if (!authed) return <AuthScreen onAuthed={(u) => { setAuthUser(u); setAuthed(true); setTab('chat') }} />

  return <div className={sidebarCollapsed ? 'shell sidebar-collapsed' : 'shell'}>
    {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'} aria-label={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}>
      <span className="theme-toggle-icon">
        {theme === 'dark'
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>}
      </span>
    </button>
    <aside className={'sidebar' + (sidebarOpen ? ' open' : '') + (sidebarCollapsed ? ' collapsed' : '')}>
      <div className="top-brand">
        <span className="brand-word"><span className="brand-dis">DIS</span>tiller</span>
        <button
          className="sidebar-collapse-btn"
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={sidebarCollapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
          </svg>
        </button>
      </div>
      <nav className="nav">{NAV.map((it) => <button key={it.id} className={tab === it.id ? 'nav-item active' : 'nav-item'} onClick={(ev) => { navClick(ev, it.id) }} aria-label={it.title} title={it.title}><span className="nav-icon">{it.icon}</span><span className="nav-label">{it.title}</span></button>)}</nav>
    </aside>
    <main className="main">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="menu-btn" onClick={() => setSidebarOpen(true)} title="菜单" aria-label="菜单"><span className="menu-dot" /><span className="menu-dot" /><span className="menu-dot" /></button>
          <div><h1 key={active.id} className="page-title" style={{ display: 'inline-block', marginRight: 12 }}>{active.title}</h1>{active.desc && <span className="header-desc">{active.desc}</span>}</div>
        </div>
        <div className="header-actions">
          {pendingTask && <span className="pill task-pill"><span className="spin" />{pendingTask}</span>}
          {taskDone && !pendingTask && <span className="pill task-done-pill"><span className="task-done-mark">✓</span>{taskDone}</span>}
          <LocalProxyPill />
          {authUser && <button className="pill user-pill" onClick={() => changeTab('profile')} title="个人中心"><span>{authUser.nickname || authUser.username}</span></button>}
          <button className="logout-btn" onClick={logout} title="退出登录">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            退出
          </button>
        </div>
      </header>
      <section className={'content' + (tab === 'wiki' ? '' : ' page-enter') + (tab === 'wiki' || tab === 'usage' || tab === 'sessions' ? ' fullbleed' : '')} ref={contentRef}>
        {tab === 'chat' && <ChatWorkspace onGotoDistillery={() => changeTab('distillery')} />}
        {tab === 'distillery' && <DistilleryPage onGotoProjects={gotoProjects} startTask={startTask} endTask={endTask} />}
        {tab === 'features' && <FeaturesPage />}
        {tab === 'projects' && <ProjectsPage onGotoAnalysis={gotoAnalysis} startTask={startTask} endTask={endTask} />}
        <WikiPage active={tab === "wiki"} startTask={startTask} endTask={endTask} />
        {tab === 'usage' && <TtShell page="dashboard" mainTheme={theme} />}
        {tab === 'sessions' && <TtShell page="sessions" mainTheme={theme} />}
        {tab === 'analysis' && <AnalysisPage initialProjectId={analysisProjectId} onGotoDeliverables={gotoDeliverables} startTask={startTask} endTask={endTask} savedResult={analysisResult} onResult={setAnalysisResult} />}
        {tab === 'deliverables' && <DeliverablesPage initialProjectId={deliverableProjectId} startTask={startTask} endTask={endTask} savedResult={deliverableResult} onResult={setDeliverableResult} onGotoPrompts={() => changeTab('prompts')} />}
        {tab === 'prompts' && <PromptsPage startTask={startTask} endTask={endTask} savedResult={promptResult} onResult={setPromptResult} />}
        {tab === 'points' && <PointsPage />}
        {tab === 'leaderboard' && <LeaderboardPage />}
        {tab === 'admin-users' && authUser?.role === 'admin' && <UsersPanel meId={authUser?.id} />}
        {tab === 'admin-works' && authUser?.role === 'admin' && <ReviewPanel />}
        {tab === 'admin-market' && authUser?.role === 'admin' && <AdminMarketPanel />}
        {tab === 'admin-points' && authUser?.role === 'admin' && <AdminPointsPanel />}
        {tab === 'settings' && <SettingsPage />}
        {tab === 'profile' && <ProfilePage user={authUser} onUserChange={(u) => { setAuthUser(u); try { api.saveAuth(u, localStorage.getItem('dd-token') || '') } catch {} }} />}
      </section>
    </main>
  </div>
}
