@echo off
title InvoiceOn live preview
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages, this happens only once...
  call npm install
)
echo.
echo Starting the live preview. Your browser will open at http://localhost:5173
echo Leave this window open while you work. Press Ctrl+C to stop.
echo.
start "" http://localhost:5173
node scripts/dev-web.mjs
pause
