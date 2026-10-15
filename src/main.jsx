import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './styles/mascots.css'
// TokenTracker 嵌入页样式：作用域化到 .tt-shell，不影响主应用
import './styles/tt/tt.css'
// 与原版 TokenTracker 一致的 Geist Mono（仪表盘数字字体）
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/geist-mono/700.css'
import '@fontsource/geist-mono/900.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
