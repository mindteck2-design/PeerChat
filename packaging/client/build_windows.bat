@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0..\..\app"
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

set APPVER=0.3.0
for /f "usebackq tokens=2 delims=:," %%V in (`findstr /C:"\"version\"" package.json`) do (
  set APPVER=%%~V
  set APPVER=!APPVER: =!
  set APPVER=!APPVER:"=!
  goto :gotver
)
:gotver
echo Building PeerTalk !APPVER! ...

call npm install
if errorlevel 1 exit /b 1

rem App binary. Full NSIS wizard needs GitHub (binary-releases); skip when blocked.
call npm run tauri:build -- --no-bundle
if errorlevel 1 exit /b 1
call npm run tauri:build -- --bundles nsis 2>nul


mkdir ..\dist\windows 2>nul
copy /Y src-tauri\target\release\lanmsg.exe ..\dist\windows\PeerTalk.exe >nul

rem Shareable install pack (Start Menu + in-place updates, no admin).
set STAGE=..\dist\windows\PeerTalk-Setup-!APPVER!
if exist "!STAGE!" rmdir /s /q "!STAGE!"
mkdir "!STAGE!"
copy /Y ..\dist\windows\PeerTalk.exe "!STAGE!\PeerTalk.exe" >nul
> "!STAGE!\VERSION.txt" echo !APPVER!
copy /Y ..\packaging\client\install_peertalk.ps1 "!STAGE!\" >nul
copy /Y ..\packaging\client\Install-PeerTalk.bat "!STAGE!\" >nul
copy /Y ..\packaging\client\SETUP_README.txt "!STAGE!\README.txt" >nul

for %%F in (src-tauri\target\release\bundle\nsis\*.exe) do (
  copy /Y "%%F" "..\dist\windows\PeerTalk_!APPVER!_x64-setup.exe" >nul
  copy /Y "%%F" "!STAGE!\" >nul
  echo NSIS installer: dist\windows\PeerTalk_!APPVER!_x64-setup.exe
)

echo.
echo Portable:       dist\windows\PeerTalk.exe
echo Install pack:   dist\windows\PeerTalk-Setup-!APPVER!\
echo Share that folder (zip OK). Recipients run Install-PeerTalk.bat
echo Newer packs update the same install; check Settings for version.
endlocal
