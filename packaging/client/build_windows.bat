@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0..\..\app"
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

set APPVER=0.4.2
for /f "usebackq tokens=2 delims=:," %%V in (`findstr /C:"\"version\"" package.json`) do (
  set APPVER=%%~V
  set APPVER=!APPVER: =!
  set APPVER=!APPVER:"=!
  goto :gotver
)
:gotver
echo Building PeerChat !APPVER! ...

call npm install
if errorlevel 1 exit /b 1

rem App binary. Full NSIS wizard needs GitHub (binary-releases); skip when blocked.
call npm run tauri:build -- --no-bundle
if errorlevel 1 exit /b 1
call npm run tauri:build -- --bundles nsis 2>nul


mkdir ..\dist\windows 2>nul
taskkill /IM PeerChat.exe /F >nul 2>&1
taskkill /IM peerchat.exe /F >nul 2>&1
taskkill /IM lanmsg.exe /F >nul 2>&1
if exist "src-tauri\target\release\peerchat.exe" (
  copy /Y src-tauri\target\release\peerchat.exe ..\dist\windows\PeerChat.exe
) else if exist "src-tauri\target\release\lanmsg.exe" (
  copy /Y src-tauri\target\release\lanmsg.exe ..\dist\windows\PeerChat.exe
) else (
  echo ERROR: peerchat.exe not found under src-tauri\target\release\
  exit /b 1
)
if errorlevel 1 (
  echo ERROR: Could not copy PeerChat.exe — close PeerChat and rebuild.
  exit /b 1
)

rem Shareable install pack (Start Menu + in-place updates, no admin).
set STAGE=..\dist\windows\PeerChat-Setup-!APPVER!
if exist "!STAGE!" rmdir /s /q "!STAGE!"
mkdir "!STAGE!"
copy /Y ..\dist\windows\PeerChat.exe "!STAGE!\PeerChat.exe"
if errorlevel 1 (
  echo ERROR: Could not stage PeerChat.exe — close PeerChat and rebuild.
  exit /b 1
)
> "!STAGE!\VERSION.txt" echo !APPVER!
copy /Y ..\packaging\client\Install-PeerChat.ps1 "!STAGE!\" >nul
copy /Y ..\packaging\client\Install-PeerChat.bat "!STAGE!\" >nul
copy /Y ..\packaging\client\Force-Uninstall-PeerChat.ps1 "!STAGE!\" >nul
copy /Y ..\packaging\client\SETUP_README.txt "!STAGE!\README.txt" >nul
if exist "src-tauri\icons\peerchat-nsis.ico" copy /Y "src-tauri\icons\peerchat-nsis.ico" "!STAGE!\PeerChat.ico" >nul
if exist "src-tauri\icons\icon.ico" if not exist "!STAGE!\PeerChat.ico" copy /Y "src-tauri\icons\icon.ico" "!STAGE!\PeerChat.ico" >nul

for %%F in (src-tauri\target\release\bundle\nsis\*.exe) do (
  copy /Y "%%F" "..\dist\windows\PeerChat_!APPVER!_x64-setup.exe" >nul
  copy /Y "%%F" "!STAGE!\" >nul
  echo NSIS installer: dist\windows\PeerChat_!APPVER!_x64-setup.exe
)

echo.
echo Portable:       dist\windows\PeerChat.exe
echo Install pack:   dist\windows\PeerChat-Setup-!APPVER!\
echo Share that folder (zip OK). Recipients run Install-PeerChat.bat
echo Newer packs update the same install; check Settings for version.
endlocal
