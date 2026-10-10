@echo off
setlocal
cd /d "%~dp0"
title PeerTalk Setup
echo.
echo  PeerTalk installer
echo  ------------------
if exist "VERSION.txt" (
  set /p VER=<VERSION.txt
  echo  Package version: %VER%
) else (
  echo  Package version: (see app after install^)
)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_peertalk.ps1" -SourceExe "%~dp0PeerTalk.exe"
if errorlevel 1 (
  echo.
  echo Install failed. If PowerShell is blocked, copy PeerTalk.exe to a folder and run it,
  echo or ask IT to allow: powershell -ExecutionPolicy Bypass -File install_peertalk.ps1
  pause
  exit /b 1
)
endlocal
