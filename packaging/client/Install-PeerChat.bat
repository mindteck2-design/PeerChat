@echo off
setlocal
cd /d "%~dp0"
title PeerChat Setup

echo.
echo  ====================================
echo       PeerChat  Installer
echo    Secure P2P LAN messenger
echo  ====================================
echo.

if exist "VERSION.txt" (
    set /p VER=<VERSION.txt
    echo  Version: %VER%
) else (
    echo  Version: see Help / About after install
)
echo.
echo  Installing for current user only - no administrator rights required.
echo  Existing chat data will NOT be touched.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-PeerChat.ps1" -SourceExe "%~dp0PeerChat.exe"
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
    echo.
    echo  *** Installation failed ***
    echo.
    echo  If PowerShell is blocked by your organisation, copy PeerChat.exe to any
    echo  folder and double-click it - the app runs without installation.
    echo.
    echo  To install manually with PowerShell:
    echo    powershell -ExecutionPolicy Bypass -File Install-PeerChat.ps1
    echo.
    pause
    exit /b 1
)

endlocal
