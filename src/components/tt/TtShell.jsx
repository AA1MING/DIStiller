// TT 页面外壳：原版 TokenTracker 页面（src/tt/pages，源码抄录）所需的完整 Provider 栈
// + 主题桥接（dark 类只作用于 .tt-shell 容器，跟随主应用 data-theme，深浅色适配）。
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { LocaleProvider } from "./ui/foundation/LocaleProvider.jsx";
import { CurrencyProvider } from "./ui/foundation/CurrencyProvider.jsx";
import { TokenFormatProvider } from "./ui/foundation/TokenFormatProvider.jsx";
import { InsforgeAuthProvider } from "../../contexts/tt/InsforgeAuthContext.jsx";
import { AccountViewProvider } from "../../contexts/tt/AccountViewContext.jsx";
import { ThemeContext } from "./ui/foundation/ThemeProvider.jsx";
import { ToastProvider } from "./ui/components/Toast.jsx";
import { LoginModalProvider } from "../../contexts/tt/LoginModalContext.jsx";
import { DashboardPage } from "../../pages/tt/DashboardPage.jsx";
import { LOCAL_PROXY_ONLINE_EVENT } from "../../lib/tt/api.ts";
import { SessionsPage } from "../../pages/tt/SessionsPage.jsx";

const THEME_STORAGE_KEY = "tokentracker-theme";

/** 首次进入：读原版存储；没有则跟随主应用 data-theme；再没有则跟随系统。 */
function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    const main = document.documentElement?.dataset?.theme;
    if (main === "dark" || main === "light") return main;
  }
  return "system";
}

function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 作用域化主题 Provider：行为与原版一致（同一存储键、system 跟随），dark 类加在 .tt-shell 上。 */
export function TtThemeProvider({ children, mainTheme }) {
  const [theme, setThemeState] = useState(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    theme === "system" ? getSystemTheme() : theme,
  );
  const shellRef = React.useRef(null);

  // 桥接主应用主题：mainTheme（主应用 data-theme 的 React 状态）变化时，
  // 同步 TT 的 resolvedTheme / theme / 存储，并立刻切换 .dark 类，
  // 确保 View Transition 的“新快照”已带上 TT 页的新配色（圆形扩散动画覆盖全屏）。
  useLayoutEffect(() => {
    if (!mainTheme) return;
    shellRef.current?.classList.toggle("dark", mainTheme === "dark");
    setResolvedTheme(mainTheme);
    setThemeState(mainTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mainTheme);
    } catch {
      /* ignore */
    }
  }, [mainTheme]);

  useLayoutEffect(() => {
    shellRef.current?.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    if (theme !== "system") {
      setResolvedTheme(theme);
      return undefined;
    }
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e) => setResolvedTheme(e.matches ? "dark" : "light");
    if (mq.addEventListener) {
      mq.addEventListener("change", handleChange);
      return () => mq.removeEventListener("change", handleChange);
    }
    mq.addListener(handleChange);
    return () => mq.removeListener(handleChange);
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, resolvedTheme }),
    [theme, setTheme, toggleTheme, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div ref={shellRef} className="tt-shell" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * @param {{ page: "dashboard" | "sessions", mainTheme?: "light" | "dark" }} props
 */
export default function TtShell({ page, mainTheme }) {
  // 本机数据代理上线（LocalProxyPill 派发 dd:local-proxy-online）时重新挂载页面，
  // 让 usage/sessions 从「云端快照」切到「本机实时数据」。
  const [dataEpoch, setDataEpoch] = useState(0);
  useEffect(() => {
    const handler = () => setDataEpoch((value) => value + 1);
    window.addEventListener(LOCAL_PROXY_ONLINE_EVENT, handler);
    return () => window.removeEventListener(LOCAL_PROXY_ONLINE_EVENT, handler);
  }, []);
  const content =
    page === "sessions" ? (
      <SessionsPage key={"sessions-" + dataEpoch} />
    ) : (
      <DashboardPage key={"dashboard-" + dataEpoch}
        baseUrl=""
        auth={null}
        signedIn
        sessionSoftExpired={false}
        signOut={() => {}}
      />
    );

  return (
    <TtThemeProvider mainTheme={mainTheme}>
      <LocaleProvider>
        <TokenFormatProvider>
          <CurrencyProvider>
            <InsforgeAuthProvider>
              <AccountViewProvider>
                <ToastProvider>
                  <LoginModalProvider>
                    <MemoryRouter>{content}</MemoryRouter>
                  </LoginModalProvider>
                </ToastProvider>
              </AccountViewProvider>
            </InsforgeAuthProvider>
          </CurrencyProvider>
        </TokenFormatProvider>
      </LocaleProvider>
    </TtThemeProvider>
  );
}
