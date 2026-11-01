@echo off
rem Builds Lightbox and serves the production build at http://localhost:8000.
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
if not exist public\models\local.json (
  echo First run: downloading the AI models. Only needed once, and the editor still works if this fails.
  call npm run fetch-models
)
call npm run build || (echo Build failed. & pause & exit /b 1)
echo Lightbox is running at http://localhost:8000
echo Keep this window open. Close it to stop.
start "" "http://localhost:8000/"
call npm run preview -- --port 8000 --strictPort
