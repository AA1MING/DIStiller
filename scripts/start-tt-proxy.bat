@echo off
rem ============================================================
rem  TokenTracker 本机数据代理 一键启动
rem  - 只监听 127.0.0.1:18788（默认），不对外暴露
rem  - 云端部署的 Web 端会优先读取本机实时 Claude/Codex 数据
rem  - 关闭本窗口即停止代理
rem  用法:
rem    start-tt-proxy.bat           默认端口 18788
rem    start-tt-proxy.bat 9999      自定义端口（需同时改 Web 端 LOCAL_PROXY_ORIGIN）
rem ============================================================
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0\.."

set "PORT=18788"
if not "%~1"=="" set "PORT=%~1"

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js v20.19 或更高版本
    echo        下载地址: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "scripts\tt-local-proxy.mjs" (
    echo [错误] 未找到 scripts\tt-local-proxy.mjs，请确认项目文件完整
    pause
    exit /b 1
)

echo 正在启动 TokenTracker 本机数据代理（端口 %PORT%）...
echo 按 Ctrl+C 或直接关闭本窗口即可停止服务。
echo.
set "TT_PROXY_PORT=%PORT%"
node scripts\tt-local-proxy.mjs
set "EXIT_CODE=%errorlevel%"
echo.
if "%EXIT_CODE%"=="0" (
    echo 代理已停止。
) else (
    echo [提示] 代理已退出（错误码 %EXIT_CODE%）。
    pause
)
endlocal

