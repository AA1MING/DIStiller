// 顶栏「本机数据」状态胶囊（仅云端部署时显示）：
// - 自动探测本机数据代理（scripts/tt-local-proxy.mjs，127.0.0.1:18788）是否在线；
// - 离线时通过自定义协议 tt-proxy:// 自动拉起代理（浏览器弹一次确认框），并轮询直到上线；
// - 上线后派发 dd:local-proxy-online 事件，TT 页面据此重新拉取本机实时数据；
// - 拉起失败（协议未注册 / 代理未启动）时给出可操作指引，避免「点了没反应」。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  isLocalhostHost,
  probeLocalProxy,
  startLocalProxyFromWeb,
  notifyLocalProxyOnline,
} from '../lib/tt/api.ts'

const AUTO_ATTEMPT_KEY = 'dd:tt-proxy-auto-attempted'
const PROBE_MS = 1200
const RETRY_MS = 1500
const MAX_TRIES = 16 // 约 24s；超时后给出明确指引
const FAILED_TITLE =
  '未检测到本机数据服务，请在本机（存放 Claude/Codex 数据的电脑）操作：\n' +
  '1) 进入 DIStiller\\scripts 目录，双击 register-tt-proxy.bat（注册 tt-proxy:// 协议，只需一次）；\n' +
  '2) 回到本页再次点击「重试」，浏览器询问时选择「打开」。\n' +
  '或直接双击 scripts\\start-tt-proxy.bat 启动本机服务后刷新本页。'

export default function LocalProxyPill() {
  const [status, setStatus] = useState('checking') // checking | online | offline | starting | failed
  const mountedRef = useRef(true)
  const pollTimerRef = useRef(null)
  const launchedRef = useRef(false) // 当前轮询周期内是否尝试过拉起代理

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const startPolling = useCallback(
    (launched) => {
      if (pollTimerRef.current) return
      launchedRef.current = launched
      let tries = 0
      const tick = async () => {
        const ok = await probeLocalProxy(PROBE_MS)
        if (!mountedRef.current) return
        if (ok) {
          setStatus('online')
          notifyLocalProxyOnline()
          stopPolling()
          return
        }
        tries += 1
        if (tries >= MAX_TRIES) {
          setStatus(launchedRef.current ? 'failed' : 'offline')
          stopPolling()
          return
        }
        pollTimerRef.current = setTimeout(tick, RETRY_MS)
      }
      pollTimerRef.current = setTimeout(tick, RETRY_MS)
    },
    [stopPolling],
  )

  const probe = useCallback(async () => {
    const ok = await probeLocalProxy(PROBE_MS)
    if (mountedRef.current) setStatus(ok ? 'online' : 'offline')
    return ok
  }, [])

  const launch = useCallback(() => {
    try {
      sessionStorage.setItem(AUTO_ATTEMPT_KEY, '1')
    } catch {
      /* ignore */
    }
    setStatus('starting')
    startLocalProxyFromWeb()
    startPolling(true)
  }, [startPolling])

  useEffect(() => {
    if (isLocalhostHost()) return undefined
    mountedRef.current = true
    let cancelled = false

    probe()

    // 会话内自动触发一次：浏览器会弹「允许打开 tt-proxy://？」确认框
    let autoTimer = null
    try {
      if (!sessionStorage.getItem(AUTO_ATTEMPT_KEY)) {
        autoTimer = setTimeout(() => {
          if (cancelled) return
          probe().then((ok) => {
            if (ok || cancelled) return
            launch()
          })
        }, 1200)
      }
    } catch {
      /* ignore */
    }

    // 用户从浏览器确认框返回后自动复检（代理可能刚被拉起）
    const onWake = () => {
      if (cancelled) return
      probe().then((ok) => {
        if (ok) stopPolling()
      })
    }
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)

    return () => {
      cancelled = true
      mountedRef.current = false
      clearTimeout(autoTimer)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
      stopPolling()
    }
  }, [probe, launch, stopPolling])

  if (isLocalhostHost()) return null

  const handleStart = async () => {
    // 先快速探测：代理可能已在运行，直接在线即可
    if (mountedRef.current) setStatus('checking')
    const ok = await probeLocalProxy(PROBE_MS)
    if (!mountedRef.current) return
    if (ok) {
      setStatus('online')
      notifyLocalProxyOnline()
      return
    }
    launch()
  }

  if (status === 'online') {
    return (
      <span className="pill proxy-pill proxy-online" title="本机实时数据已连接（127.0.0.1:18788）">
        <span className="proxy-dot" />
        本机数据
      </span>
    )
  }
  if (status === 'starting') {
    return (
      <span className="pill proxy-pill proxy-starting" title="正在启动本机数据服务…">
        <span className="spin" />
        正在启动本机数据…
      </span>
    )
  }
  if (status === 'checking') {
    return (
      <span className="pill proxy-pill" title="正在检测本机数据服务…">
        <span className="spin" />
        检测本机数据…
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <button className="pill proxy-pill proxy-offline proxy-failed" onClick={handleStart} title={FAILED_TITLE}>
        <span className="proxy-dot offline" />
        本机数据未连接
      </button>
    )
  }
  return (
    <button
      className="pill proxy-pill proxy-offline"
      onClick={handleStart}
      title="启动本机数据服务后，页面将自动读取本机实时 Claude/Codex 数据"
    >
      <span className="proxy-dot offline" />
      启动本机数据
    </button>
  )
}
