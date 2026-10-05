@echo off
rem SellHub: local start on Windows (needs Node.js 22 or newer from https://nodejs.org)
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22 LTS or newer from https://nodejs.org and run this file again. & pause & exit /b 1)
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (echo Node.js 22 or newer is required. & pause & exit /b 1)

rem Install dependencies if they are missing or a previous install did not finish.
set NEED_INSTALL=0
if not exist server\node_modules\better-sqlite3\build\Release\better_sqlite3.node set NEED_INSTALL=1
if not exist web\node_modules\vite\package.json set NEED_INSTALL=1
if %NEED_INSTALL%==1 (
  echo Installing dependencies...
  if exist server\node_modules rmdir /s /q server\node_modules
  if exist web\node_modules rmdir /s /q web\node_modules
  call npm run install:all || (echo. & echo Installation failed - send the text above to support. & pause & exit /b 1)
)
if not exist server\dist\index.js goto build
if not exist web\dist\index.html goto build
goto run
:build
echo Building...
call npm run build || (echo. & echo Build failed - send the text above to support. & pause & exit /b 1)

:run
echo.
echo SellHub: http://localhost:3001   (support panel: http://localhost:3001/admin)
echo Close this window to stop the server.
start "" http://localhost:3001
set ADMIN_EMAIL=admin@localhost.pl
if not defined ADMIN_PASSWORD set ADMIN_PASSWORD=Lokalny-Panel-2026
node server\dist\index.js
pause
