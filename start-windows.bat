@echo off
REM AI Production AP - double-click to install (first time), build and start.
cd /d "%~dp0"
title AI Production AP

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Opening https://nodejs.org - install the LTS version, then run this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

node scripts\check-node.mjs
if errorlevel 1 ( pause & exit /b 1 )

if not exist node_modules (
  echo  Installing dependencies - first run only, may take a minute...
  call npm install
  if errorlevel 1 ( echo  npm install failed - see the error above. & pause & exit /b 1 )
)

if not exist .env (
  copy .env.example .env >nul
  echo  Created .env - add your OPENAI_API_KEY there to enable AI script writing.
)

echo  Building the web interface...
call npm run build
if errorlevel 1 ( echo  Build failed - see the error above. & pause & exit /b 1 )

REM open the browser after the server has had a few seconds to start
start "" cmd /c "timeout /t 5 >nul & start http://127.0.0.1:3001"

echo.
echo  Starting server. Keep this window open while you work. Close it to stop.
echo.
call npm start
pause
