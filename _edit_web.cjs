const fs = require('fs');
const path = require('path');
function read(p){ return fs.readFileSync(path.join(process.cwd(), p), 'utf8'); }
function write(p, s){ fs.writeFileSync(path.join(process.cwd(), p), s); }
function apply(p, pairs){
  let s = read(p);
  const orig = s;
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n === 0) { console.error('!! NOT FOUND in ' + p + ': ' + JSON.stringify(from.slice(0,70))); process.exitCode = 1; }
    else if (n > 1) { console.error('!! MULTIPLE(' + n + ') in ' + p + ': ' + JSON.stringify(from.slice(0,70))); }
    s = s.split(from).join(to);
  }
  if (s !== orig) { write(p, s); console.log('edited: ' + p); }
  else console.log('no change: ' + p);
}

// ---------- App.jsx ----------
apply('src/App.jsx', [
[`      const done = label.replace(/中…$/, '') + '完成'`,
 `      const done = label.replace(/中…(（[^）]*）)?$/, '') + '完成'`],
[`        <div className="header-actions">
          {authUser && <button className="pill user-pill" onClick={() => changeTab('profile')} title="个人中心"><span>{authUser.nickname || authUser.username}</span></button>}
          <button className="logout-btn" onClick={logout} title="退出登录">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            退出
          </button>
          {pendingTask && <span className="pill task-pill"><span className="spin" />{pendingTask}</span>}
          {taskDone && !pendingTask && <span className="pill task-done-pill"><span className="task-done-mark">✓</span>{taskDone}</span>}
        </div>`,
 `        <div className="header-actions">
          {pendingTask && <span className="pill task-pill"><span className="spin" />{pendingTask}</span>}
          {taskDone && !pendingTask && <span className="pill task-done-pill"><span className="task-done-mark">✓</span>{taskDone}</span>}
          {authUser && <button className="pill user-pill" onClick={() => changeTab('profile')} title="个人中心"><span>{authUser.nickname || authUser.username}</span></button>}
          <button className="logout-btn" onClick={logout} title="退出登录">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            退出
          </button>
        </div>`],
[`        <WikiPage active={tab === "wiki"} />`,
 `        <WikiPage active={tab === "wiki"} startTask={startTask} endTask={endTask} />`]
]);

// ---------- WikiPage.jsx ----------
apply('src/pages/WikiPage.jsx', [
[`function WikiPage({ active = true }) {`,
 `function WikiPage({ active = true, startTask, endTask }) {`],
[`  const [taskLabel, setTaskLabel] = useState('')
  const [error, setError] = useState(null)`,
 `  const [error, setError] = useState(null)`],
[`    setBusy(true); setError(null)
    try {
      for (let i = 0; i < missing.length; i++) {
        const p = missing[i]
        setTaskLabel(\`正在为「\${p.title}」生成 Wiki 知识库…（\${i + 1}/\${missing.length}）\`)
        await api.generateProjectWiki(p.id)
      }
      setTaskLabel('')
      loadGalaxy(true)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false); setTaskLabel('')
    }`,
 `    setBusy(true); setError(null)
    try {
      for (let i = 0; i < missing.length; i++) {
        const p = missing[i]
        startTask?.(\`生成 Wiki 中…（\${i + 1}/\${missing.length}）\`)
        await api.generateProjectWiki(p.id)
      }
      loadGalaxy(true)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false); endTask?.()
    }`],
[`      {taskLabel && <div className="wiki-task-label wiki-task-overlay"><span className="spin" />{taskLabel}</div>}
`, ``]
]);

// ---------- ProjectsPage.jsx ----------
apply('src/pages/ProjectsPage.jsx', [
[`    setBusyAction('regenerate'); setErr(null); setAnalysisMsg(null)
    try { const r = await api.regenerateAnalysis(pid); setAnalysisMsg(\`「\${r.title}」需求分析已更新\`); await load() } catch (e) { setErr(e.message) } finally { setBusyAction(null) }`,
 `    setBusyAction('regenerate'); setErr(null); setAnalysisMsg(null)
    startTask?.('重新分析中…')
    try { const r = await api.regenerateAnalysis(pid); setAnalysisMsg(\`「\${r.title}」需求分析已更新\`); await load() } catch (e) { setErr(e.message) } finally { endTask?.(); setBusyAction(null) }`]
]);

console.log('DONE');
