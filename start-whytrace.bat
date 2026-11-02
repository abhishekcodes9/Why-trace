@echo off
setlocal
cd /d "%~dp0"
node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)" >nul 2>&1
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install Node.js from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting WhyTrace at http://127.0.0.1:3000
echo Press Ctrl+C to stop the server.
node server.js
pause
