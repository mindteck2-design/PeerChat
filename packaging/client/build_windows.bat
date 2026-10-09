@echo off
setlocal
cd /d "%~dp0..\..\app"
call npm install
call npm run tauri:build
echo.
echo Installers under app\src-tauri\target\release\bundle\
endlocal
