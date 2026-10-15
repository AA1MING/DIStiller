@echo off
setlocal
set "DIR=%~dp0"
set "VBS=%DIR%tt-proxy-handler.vbs"
set "PROTO=tt-proxy"
set "RUNKEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"

echo ============================================================
echo   TT local data proxy - protocol ^& auto-start registration
echo ============================================================
echo.

if /i "%~1"=="-unregister" goto unregister

if not exist "%VBS%" (
  echo [ERROR] %VBS% not found.
  echo Run this script from the scripts folder.
  goto done
)

reg add "HKCU\Software\Classes\%PROTO%" /ve /d "URL:%PROTO% Protocol" /f >nul
reg add "HKCU\Software\Classes\%PROTO%" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\%PROTO%\shell\open\command" /ve /d "\"wscript.exe\" \"%VBS%\" \"%%1\"" /f >nul
echo [OK] Protocol tt-proxy:// registered. The cloud web page can now
echo      start the local proxy automatically (browser asks once).

echo.
set /p AUTO=Register auto-start at Windows login? [Y/N]:
if /i not "%AUTO%"=="Y" goto done
reg add "%RUNKEY%" /v "tt-local-proxy" /d "\"wscript.exe\" \"%VBS%\"" /f >nul
echo [OK] Auto-start at Windows login registered (hidden, no console window).
goto done

:unregister
reg delete "HKCU\Software\Classes\%PROTO%" /f >nul 2>&1
reg delete "%RUNKEY%" /v "tt-local-proxy" /f >nul 2>&1
echo [OK] Unregistered tt-proxy:// protocol and auto-start entry.
goto done

:done
echo.
echo Done. To undo later, run:  %~nx0 -unregister
pause