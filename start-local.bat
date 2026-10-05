@echo off
rem SellHub: local start on Windows (needs Node.js 22+ from https://nodejs.org)
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22 LTS from https://nodejs.org and run this file again. & pause & exit /b 1)
if not exist server\node_modules call npm run install:all || (pause & exit /b 1)
if not exist server\dist\index.js call npm run build || (pause & exit /b 1)
echo.
echo SellHub: http://localhost:3001   (support panel: http://localhost:3001/admin)
echo Close this window to stop the server.
start "" http://localhost:3001
set ADMIN_EMAIL=admin@localhost.pl
if not defined ADMIN_PASSWORD set ADMIN_PASSWORD=Lokalny-Panel-2026
node server\dist\index.js
pause
