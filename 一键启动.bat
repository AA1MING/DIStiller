@echo off
rem ============================================================
rem  Demand-Distiller 一键启动脚本
rem  - 自动检测 Node.js / npm 环境（要求 Node.js v20.19+）
rem  - 依赖缺失或损坏时自动安装（可用 --no-install 跳过）
rem  - 启动 scripts/dev.mjs（自动避开 Windows 保留端口段）
rem
rem  用法:
rem    一键启动.bat                正常启动
rem    一键启动.bat --no-install   跳过依赖安装
rem    一键启动.bat --reinstall    强制重新安装依赖
rem    一键启动.bat --help         显示帮助
rem ============================================================
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title Demand-Distiller 一键启动

set "DD_OK=0"
set "SKIP_INSTALL=0"
set "FORCE_INSTALL=0"

rem ---------- 解析命令行参数 ----------
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--help" goto usage
if /i "%~1"=="-h" goto usage
if /i "%~1"=="--no-install" set "SKIP_INSTALL=1"
if /i "%~1"=="--reinstall" set "FORCE_INSTALL=1"
shift
goto parse_args
:args_done

echo ==================================================
echo   Demand-Distiller 一键启动脚本
echo   自动检测可用端口，启动前端 + 后端
echo ==================================================
echo.

rem ---------- 1. 检查 Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js v20.19 或更高版本
    echo        下载地址: https://nodejs.org/
    goto fail
)

for /f "tokens=1-3 delims=.v" %%a in ('node -v') do (
    set "NODE_MAJOR=%%a"
    set "NODE_MINOR=%%b"
    set "NODE_PATCH=%%c"
)

rem Vite 7 要求 Node.js v20.19+（或 v22.12+）
set "NODE_VERSION_OK=0"
if defined NODE_MAJOR (
    if %NODE_MAJOR% GTR 20 set "NODE_VERSION_OK=1"
    if %NODE_MAJOR% EQU 20 if %NODE_MINOR% GEQ 19 set "NODE_VERSION_OK=1"
)
if "%NODE_VERSION_OK%"=="0" (
    echo [错误] Node.js 版本过低：当前 v%NODE_MAJOR%.%NODE_MINOR%.%NODE_PATCH%，需要 v20.19 或更高版本
    echo        请到 https://nodejs.org/ 下载最新 LTS 版本后重试
    goto fail
)

rem ---------- 2. 检查 npm ----------
where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 npm，请确认 Node.js 安装完整后重试
    goto fail
)

rem ---------- 3. 依赖安装 ----------
set "NEED_INSTALL=0"
if "%FORCE_INSTALL%"=="1" set "NEED_INSTALL=1"
if "%SKIP_INSTALL%"=="1" set "NEED_INSTALL=0"
if not exist "node_modules\.package-lock.json" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" (
    if "%SKIP_INSTALL%"=="1" (
        echo [警告] 已跳过依赖安装，但未检测到 node_modules，启动可能失败
    ) else (
        echo [环境] Node.js v%NODE_MAJOR%.%NODE_MINOR%.%NODE_PATCH%
        echo 正在安装依赖，请稍候...
        call npm install
        if errorlevel 1 (
            echo [错误] 依赖安装失败，请检查网络后重试
            echo        国内网络可尝试镜像源: npm config set registry https://registry.npmmirror.com
            goto fail
        )
    )
) else (
    echo [环境] Node.js v%NODE_MAJOR%.%NODE_MINOR%.%NODE_PATCH%，依赖已就绪
)

rem ---------- 4. 检查启动脚本 ----------
if not exist "scripts\dev.mjs" (
    echo [错误] 未找到 scripts\dev.mjs，请确认项目文件完整
    goto fail
)

rem ---------- 5. 启动开发服务器 ----------
rem scripts/dev.mjs 会自动避开 Windows 保留端口段（如 8787 被系统保留时）
rem 自动挑选可用端口，等待前后端就绪后打开浏览器。
echo 正在启动开发服务器（前端 + 后端），端口将自动检测...
echo 按 Ctrl+C 或直接关闭本窗口即可停止服务。
echo.
node scripts\dev.mjs
set "EXIT_CODE=%errorlevel%"
echo.
if "%EXIT_CODE%"=="0" (
    echo 开发服务器已停止。
    set "DD_OK=1"
) else (
    echo [提示] 开发服务器已退出（错误码 %EXIT_CODE%）。
    set "DD_OK=0"
)
goto end

:usage
echo 用法: %~nx0 [选项]
echo.
echo   无参数       正常启动（依赖缺失时自动 npm install）
echo   --no-install 跳过依赖安装
echo   --reinstall  强制重新安装依赖
echo   --help       显示帮助
echo.
set "DD_OK=1"
goto end

:fail
echo.
echo 启动失败，请根据上方提示处理后重试。
set "DD_OK=0"
goto end

:end
if "%DD_OK%"=="0" (
    pause
    endlocal & exit /b 1
)
endlocal & exit /b 0
