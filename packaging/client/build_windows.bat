@echo off
setlocal
cd /d "%~dp0..\..\app"
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
call npm install
call npm run tauri:build
if errorlevel 1 exit /b 1
echo.
echo NSIS installer (if bundled):
dir /s /b src-tauri\target\release\bundle\nsis\*.exe 2>nul
echo Portable exe:
dir /b src-tauri\target\release\lanmsg.exe 2>nul
if exist src-tauri\target\release\lanmsg.exe (
  mkdir ..\dist\windows 2>nul
  copy /Y src-tauri\target\release\lanmsg.exe ..\dist\windows\LanMsg.exe
  echo Copied to dist\windows\LanMsg.exe
)
endlocal
