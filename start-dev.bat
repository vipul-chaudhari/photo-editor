@echo off
rem Development server with instant reload at http://localhost:5173.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install || exit /b 1
)
call npm run dev -- --open
