@echo off
setlocal
cd /d "%~dp0..\..\app"
echo PATH has cargo:
where cargo
where node
echo.
echo Building LanMsg (NSIS + deb if supported)...
call npm run tauri:build
echo EXIT=%ERRORLEVEL%
echo.
echo Looking for installers:
dir /s /b "src-tauri\target\release\bundle\nsis\*.exe" 2>nul
dir /s /b "src-tauri\target\release\bundle\deb\*.deb" 2>nul
dir /s /b "src-tauri\target\release\bundle\msi\*.msi" 2>nul
endlocal
