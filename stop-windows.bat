@echo off
REM AI Production AP - stop the background server (port 3001)
set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":3001 .*LISTENING"') do (
  taskkill /PID %%a /T /F >nul 2>nul
  set FOUND=1
)
if "%FOUND%"=="1" (echo  AI Production AP stopped.) else (echo  AI Production AP was not running.)
timeout /t 3 >nul
