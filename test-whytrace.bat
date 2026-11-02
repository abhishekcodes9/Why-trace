@echo off
setlocal
cd /d "%~dp0"
node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)" >nul 2>&1
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)
npm test
pause
